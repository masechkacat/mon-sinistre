import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { acquireLock, readState, writeState } from './ralph-state.js';

const COMMAND = String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const file = process.env.RALPH_TEST_CONTROL;
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const save = () => fs.writeFileSync(file, JSON.stringify(state));
const args = process.argv.slice(2);
const role = path.basename(process.argv[1]);
const value = (flag) => args[args.indexOf(flag) + 1];
const output = (data) => console.log(JSON.stringify(data));
if (role === 'verify.cjs') {
  state.checks = (state.checks || 0) + 1;
  save();
  if (state.failVerification) process.exitCode = 1;
} else if (role === 'claude') {
  const session = args.includes('--session-id') && value('--session-id');
  if (!session) {
    state.reviews = (state.reviews || 0) + 1;
    save();
    console.log('No duplicates.');
  } else {
    state.agentCalls = (state.agentCalls || 0) + 1;
    save();
    if (state.agent !== 'no-commit') {
      fs.appendFileSync('feature.txt', 'implemented\n');
      execFileSync('git', ['add', 'feature.txt']);
      if (state.agent === 'change-manifest') {
        const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
        manifest.scripts.verify = 'echo skipped';
        fs.writeFileSync('package.json', JSON.stringify(manifest));
        execFileSync('git', ['add', 'package.json']);
      }
      execFileSync('git', ['commit', '-m', 'feat: fixture\n\nCloses #1']);
    }
    if (state.agent === 'dirty') fs.writeFileSync('unfinished.txt', 'keep me');
    if (state.agent === 'timeout') {
      setTimeout(() => {}, 10000);
    } else if (state.agent === 'invalid-json') {
      console.log('not JSON');
    } else {
      const failed = state.agent === 'failure';
      output({
        type: 'result', subtype: failed ? 'error_max_turns' : 'success',
        is_error: failed, session_id: session, num_turns: 2, total_cost_usd: 0.25,
        usage: { input_tokens: 10, cache_read_input_tokens: 20,
          cache_creation_input_tokens: 5, output_tokens: 8 }
      });
      if (failed || state.agent === 'exit-error') process.exitCode = 1;
    }
  }
} else if (role === 'gh') {
  const command = args.slice(0, 2).join(' ');
  if (command === 'auth status') {}
  else if (command === 'repo view') console.log('test/repo');
  else if (args[0] === 'api') output([{title: '[fixture] Фаза 1: Result'}]);
  else if (command === 'project item-list') output({items: [{
    id: 'item', content: {number: 1}, status: state.done ? 'In Review' : 'Todo'
  }]});
  else if (command === 'project view') output({id: 'project'});
  else if (command === 'project field-list') output({fields: [{
    id: 'status', name: 'Status', options: [
      {id: 'review', name: 'In Review'}, {id: 'done', name: 'Done'}
    ]
  }]});
  else if (command === 'project item-edit') {
    if (state.failBoard) process.exitCode = 1;
    else { state.done = true; save(); }
  }
  else if (command === 'issue list') output([{number: 1, title: 'Result'}]);
  else if (command === 'pr list') output([{url: 'https://github.com/test/repo/pull/1'}]);
  else if (command === 'pr view') output(state.comments || []);
  else if (command === 'pr comment') {
    state.comments = [...(state.comments || []), {body: value('--body')}]; save();
  }
  else { console.error('Unexpected gh call', args); process.exitCode = 2; }
}
`;

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-integration-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const root = path.join(dir, 'repo');
  const remote = path.join(dir, 'origin.git');
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(root);
  fs.mkdirSync(bin);
  const control = path.join(dir, 'control.json');
  fs.writeFileSync(control, JSON.stringify(options));
  const env = { ...process.env };
  for (const key of Object.keys(env))
    if (key.startsWith('GIT_')) delete env[key];
  Object.assign(env, {
    PATH: `${bin}${path.delimiter}${env.PATH}`,
    RALPH_TEST_CONTROL: control,
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_PAGER: 'cat',
  });
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  git('init', '--bare', remote);
  git('init', '-b', 'main');
  git('config', 'user.name', 'Ralph test');
  git('config', 'user.email', 'ralph@example.invalid');
  git('config', 'core.hooksPath', '/dev/null');
  fs.mkdirSync(path.join(root, '.claude'));
  for (const name of ['ralph.js', 'ralph-state.js', 'metrics.js'])
    fs.copyFileSync(
      path.join(import.meta.dirname, name),
      path.join(root, '.claude', name),
    );
  for (const name of ['gh', 'claude'])
    fs.writeFileSync(path.join(bin, name), COMMAND, { mode: 0o755 });
  fs.writeFileSync(path.join(root, 'verify.cjs'), COMMAND);
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module', scripts: { verify: 'node verify.cjs' } }),
  );
  fs.writeFileSync(
    path.join(root, '.claude/ralph.config.json'),
    JSON.stringify({
      feature: 'fixture',
      phases: [1],
      maxIterations: 1,
      iterationTimeoutMs: options.agent === 'timeout' ? 1000 : 10000,
      verificationCommands: [['npm', 'run', 'verify']],
      project: {
        number: 1,
        owner: 'test',
        statusField: 'Status',
        inReviewOption: 'In Review',
        doneOption: 'Done',
      },
    }),
  );
  for (const kind of ['prd', 'plan', 'research']) {
    fs.mkdirSync(path.join(root, 'docs', kind), { recursive: true });
    fs.writeFileSync(
      path.join(root, 'docs', kind, 'fixture.md'),
      '# Fixture\n',
    );
  }
  git('add', '.');
  git('commit', '-m', 'initial');
  git('remote', 'add', 'origin', remote);
  git('push', 'origin', 'main');
  const read = () => JSON.parse(fs.readFileSync(control, 'utf8'));
  const journalFile = () => {
    const folder = path.join(root, '.git', 'ralph');
    return path.join(folder, fs.readdirSync(folder)[0]);
  };
  return {
    root,
    remote,
    git,
    read,
    journalFile,
    update: (changes) =>
      fs.writeFileSync(control, JSON.stringify({ ...read(), ...changes })),
    run: (...args) =>
      spawnSync(process.execPath, ['.claude/ralph.js', ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 30000,
      }),
    journal: () => JSON.parse(fs.readFileSync(journalFile(), 'utf8')),
  };
}

function expectExit(result, code) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, code, result.stdout + result.stderr);
}

test('ошибка, повреждённый result и timeout сохраняют кандидат до подтверждения', (t) => {
  for (const agent of ['failure', 'exit-error', 'invalid-json', 'timeout']) {
    const f = fixture(t, { agent });
    expectExit(f.run(), 1);
    assert.equal(f.journal().attempts[0].stage, 'candidate');
    assert.equal(f.read().checks, undefined);
    assert.equal(f.read().done, undefined);
    assert.equal(
      f.git('ls-remote', '--heads', 'origin', 'fixture/phase-1'),
      '',
    );
    expectExit(f.run(), 1);
    assert.equal(f.read().agentCalls, 1);
    expectExit(f.run('--verify-candidate'), 0);
    assert.equal(f.journal().attempts[0].stage, 'complete');
    assert.equal(f.read().agentCalls, 1);
    assert.equal(f.read().checks, 1);
    assert.equal(f.read().done, true);
  }
});

test('красная приёмка, сбои push и доски возобновляются без повторной реализации', (t) => {
  const f = fixture(t, { failVerification: true });
  expectExit(f.run(), 1);
  assert.equal(f.journal().attempts[0].stage, 'candidate');
  assert.equal(f.read().done, undefined);
  assert.equal(f.git('ls-remote', '--heads', 'origin', 'fixture/phase-1'), '');
  f.update({ failVerification: false });
  const hook = path.join(f.remote, 'hooks/pre-receive');
  fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  expectExit(f.run(), 1);
  assert.equal(f.journal().attempts[0].stage, 'candidate');
  fs.unlinkSync(hook);
  f.update({ failBoard: true });
  expectExit(f.run(), 1);
  assert.equal(f.journal().attempts[0].stage, 'published');
  const checks = f.read().checks;
  f.update({ failBoard: false });
  expectExit(f.run(), 0);
  assert.equal(f.journal().attempts[0].stage, 'complete');
  assert.equal(f.read().checks, checks);
  assert.equal(f.read().agentCalls, 1);
  assert.equal(f.read().done, true);
  expectExit(f.run(), 0);
  assert.equal(f.read().reviews, 1);
});

test('незавершённые файлы сохраняются, а все попытки остаются в журнале', (t) => {
  const f = fixture(t, { agent: 'no-commit' });
  expectExit(f.run(), 0);
  assert.equal(f.journal().attempts[0].stage, 'no_commit');
  const completed = f.journal();
  const interrupted = structuredClone(completed);
  Object.assign(interrupted.attempts[0], { stage: 'running', outcome: null });
  writeState(f.journalFile(), interrupted);
  const result = f.run();
  expectExit(result, 1);
  assert.match(result.stderr, /состояние агента неизвестно/);
  assert.equal(f.read().agentCalls, 1);
  writeState(f.journalFile(), completed);
  f.update({ agent: 'dirty' });
  expectExit(f.run(), 1);
  assert.equal(
    fs.readFileSync(path.join(f.root, 'unfinished.txt'), 'utf8'),
    'keep me',
  );
  assert.equal(f.read().checks, undefined);
  fs.unlinkSync(path.join(f.root, 'unfinished.txt'));
  expectExit(f.run(), 0);
  const attempts = f.journal().attempts;
  assert.equal(attempts.length, 2);
  assert.equal(attempts[1].stage, 'complete');
  assert.equal(f.read().agentCalls, 2);
  assert.deepEqual(
    attempts.map((a) => a.outcome.costUsd),
    [0.25, 0.25],
  );
});

test('кандидат не может подменить скрипт собственной приёмки', (t) => {
  const f = fixture(t, { agent: 'change-manifest' });
  const result = f.run();
  expectExit(result, 1);
  assert.match(result.stderr, /собственной приёмки/);
  assert.equal(f.read().checks, undefined);
  assert.equal(f.read().done, undefined);
});

test('dry-run не пишет журнал; lock и повреждённый журнал останавливают запуск', (t) => {
  const f = fixture(t);
  expectExit(f.run('--dry-run'), 0);
  assert.equal(f.git('branch', '--show-current'), 'main');
  assert.equal(fs.existsSync(path.join(f.root, '.git/ralph')), false);
  const lock = path.join(f.root, '.git/ralph.lock');
  const release = acquireLock(lock);
  try {
    const result = f.run();
    expectExit(result, 1);
    assert.match(result.stderr, /уже запущен/);
    assert.equal(f.read().agentCalls, undefined);
  } finally {
    release();
  }
  const file = path.join(f.root, '.git/test-state.json');
  const state = readState(file, 'fixture/phase-1');
  writeState(file, state);
  assert.deepEqual(readState(file, state.branch), state);
  assert.throws(() => readState(file, 'another-branch'), /журнал/);
  fs.writeFileSync(file, '{');
  assert.throws(() => readState(file, state.branch), SyntaxError);
});
