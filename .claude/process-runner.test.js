import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { runProcess } from './process-runner.js';

const node = (source, options = {}, args = []) =>
  runProcess(process.execPath, ['--eval', source, ...args], {
    timeout: 3000,
    ...options,
  });

function directory(t, writer = false) {
  const dir = fs.mkdtempSync(path.resolve('.claude/process-runner-fixture-'));
  t.after(async () => {
    // Failed cleanup assertions must not leave fixtures writing into a removed dir.
    if (writer) await delay(2600);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

async function waitFor(predicate, timeout = 2000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, 'fixture did not become ready');
    await delay(10);
  }
}

const WRITER = `
const fs = require('node:fs');
process.on('SIGTERM', () => {});
fs.writeFileSync(process.argv[1] + '.ready', String(process.pid));
const interval = setInterval(() => fs.appendFileSync(process.argv[1], 'x'), 10);
setTimeout(() => { clearInterval(interval); process.exit(); }, 2500);
`;

test('captures UTF-8 output, nonzero status, cwd, env and literal arguments', async (t) => {
  const cwd = directory(t);
  const result = await node(
    `process.stdout.write(JSON.stringify({
      cwd: process.cwd(), value: process.env.VALUE, arg: process.argv[1]
    })); process.stderr.write('échec'); process.exitCode = 7;`,
    { cwd, env: { VALUE: 'test' } },
    ['$(not-a-shell); *'],
  );
  assert.deepEqual(JSON.parse(result.stdout), {
    cwd,
    value: 'test',
    arg: '$(not-a-shell); *',
  });
  assert.equal(result.stderr, 'échec');
  assert.equal(result.status, 7);
  assert.equal(result.signal, null);
  assert.equal(result.error, undefined);
});

test('preserves command signals instead of the supervisor cleanup signal', async () => {
  const result = await node(`process.kill(process.pid, 'SIGTERM');`);
  assert.equal(result.status, null);
  assert.equal(result.signal, 'SIGTERM');
  assert.equal(result.error, undefined);
});

test('returns launch failures and rejects invalid options without launching', async (t) => {
  const dir = directory(t);
  const denied = path.join(dir, 'not-executable');
  fs.writeFileSync(denied, 'not executable', { mode: 0o600 });
  for (const [command, code] of [
    [path.join(dir, 'missing'), 'ENOENT'],
    [denied, 'EACCES'],
  ]) {
    const result = await runProcess(command, [], { timeout: 2000 });
    assert.equal(result.error?.code, code);
    assert.equal(result.status, null);
    assert.equal(result.signal, null);
  }
  for (const options of [
    {},
    { timeout: 0 },
    { timeout: -1 },
    { timeout: Infinity },
    { timeout: 2 ** 31 },
    { timeout: 100, maxBuffer: -1 },
    { timeout: 100, stdio: ['pipe', 'pipe', 'pipe'] },
  ]) {
    const result = await runProcess(
      process.execPath,
      ['--eval', 'throw 1'],
      options,
    );
    assert.equal(result.error?.code, 'EINVAL');
    assert.equal(result.status, null);
  }
});

test('supports piped stdout with inherited stderr and inherited output', async () => {
  for (const stdio of [['ignore', 'pipe', 'inherit'], 'inherit']) {
    const result = await node('', { stdio });
    assert.equal(result.status, 0);
    assert.equal(result.error, undefined);
    assert.equal(result.stdout, stdio === 'inherit' ? null : '');
    assert.equal(result.stderr, null);
  }
});

test('drains output at exit and enforces byte limits on both captured streams', async () => {
  for (const stream of ['stdout', 'stderr']) {
    const source = `process.${stream}.write('é'.repeat(100000));`;
    const exact = await node(source, { maxBuffer: 200000 });
    assert.equal(exact.error, undefined);
    assert.equal(exact.status, 0);
    assert.equal(exact[stream], 'é'.repeat(100000));
    const overflow = await node(source, { maxBuffer: 1024 });
    assert.equal(overflow.error?.code, 'ENOBUFS');
    assert.equal(Buffer.byteLength(overflow[stream]), 1024);
  }
});

test('SIGKILL deadline bounds a TERM-ignoring command and its descendants', async (t) => {
  const dir = directory(t, true);
  const output = path.join(dir, 'writes');
  const source = `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    spawn(process.execPath, ['--eval', ${JSON.stringify(WRITER)}, ${JSON.stringify(output)}],
      { stdio: 'inherit' });
    setTimeout(() => process.exit(), 2500);
  `;
  const started = Date.now();
  const result = await node(source, { timeout: 700 });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.equal(result.status, null);
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 1800);
  assert.ok(fs.existsSync(output), 'descendant ran before the deadline');
  const before = fs.readFileSync(output, 'utf8');
  await delay(120);
  assert.equal(fs.readFileSync(output, 'utf8'), before);
});

test('kills background writers on parent exit even when they inherit captured pipes', async (t) => {
  const dir = directory(t, true);
  const output = path.join(dir, 'writes');
  const source = `
    const { spawn } = require('node:child_process');
    const fs = require('node:fs');
    spawn(process.execPath, ['--eval', ${JSON.stringify(WRITER)}, ${JSON.stringify(output)}],
      { stdio: 'inherit' });
    const ready = setInterval(() => {
      if (fs.existsSync(${JSON.stringify(output + '.ready')})) process.exit(0);
    }, 10);
    setTimeout(() => process.exit(8), 2000);
  `;
  const started = Date.now();
  const result = await node(source);
  assert.equal(result.status, 0);
  assert.equal(result.error, undefined);
  assert.ok(
    Date.now() - started < 1800,
    'did not wait for descendant pipe EOF',
  );
  const before = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '';
  await delay(120);
  assert.equal(
    fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : '',
    before,
  );
});

test('an escaped pipe holder does not turn a complete large result into a timeout', async (t) => {
  t.after(() => delay(2600));
  const escaped = `setTimeout(() => process.exit(0), 2500); process.send('ready'); process.disconnect();`;
  const source = `
    const { spawn } = require('node:child_process');
    const child = spawn(process.execPath, ['--eval', ${JSON.stringify(escaped)}],
      { detached: true, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    child.once('message', () => process.stdout.write(
      JSON.stringify({ result: 'x'.repeat(2 * 1024 * 1024) }), () => process.exit(0)));
  `;
  const started = Date.now();
  const result = await node(source, { timeout: 5000 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.signal, null);
  assert.equal(JSON.parse(result.stdout).result.length, 2 * 1024 * 1024);
  assert.ok(Date.now() - started < 2000, 'waited for escaped pipe EOF');
});

test('timeout does not signal the caller or an unrelated process', async (t) => {
  let unrelated;
  let closed;
  t.after(async () => {
    if (!unrelated) return;
    if (unrelated.exitCode === null && unrelated.signalCode === null) {
      unrelated.kill('SIGKILL');
    }
    await closed;
  });
  const dir = directory(t);
  const output = path.join(dir, 'unrelated');
  unrelated = spawn(process.execPath, ['--eval', WRITER, output], {
    stdio: 'ignore',
  });
  closed = new Promise((resolve) => unrelated.once('close', resolve));
  await waitFor(() => fs.existsSync(output));
  const result = await node('setTimeout(() => {}, 2500)', { timeout: 100 });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  const before = fs.readFileSync(output, 'utf8').length;
  await delay(100);
  assert.ok(fs.readFileSync(output, 'utf8').length > before);
});

test('surfaces non-ESRCH cleanup failures without losing the timeout error', async (t) => {
  const kill = process.kill.bind(process);
  t.mock.method(process, 'kill', (pid, signal) => {
    assert.ok(pid < 0);
    assert.equal(signal, 'SIGKILL');
    kill(pid, signal);
    throw Object.assign(new Error('injected cleanup failure'), {
      code: 'EPERM',
    });
  });
  const result = await node('setTimeout(() => {}, 1000)', { timeout: 100 });
  assert.equal(result.error?.code, 'ETIMEDOUT');
  assert.ok(result.error instanceof AggregateError);
  assert.equal(result.error.errors[1].code, 'EPERM');
  assert.equal(result.status, null);
  assert.equal(result.signal, 'SIGKILL');
});
