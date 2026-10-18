import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseApproval, runPilot, verifyPilot } from './control-pilot.js';
import { hash } from './control-tasks.js';

const FLAGS = [
  '--model',
  'claude-test-fixture',
  '--max-budget-usd',
  '1',
  '--max-turns',
  '10',
  '--timeout-ms',
  '10000',
  '--allow-model',
];

function fixture(t, behavior = 'success') {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'package.json'), '{"type":"commonjs"}');
  const control = path.join(bin, 'control.json');
  fs.writeFileSync(control, JSON.stringify({ behavior, calls: 0 }));
  fs.writeFileSync(
    path.join(bin, 'claude'),
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const file = path.join(__dirname, 'control.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const args = process.argv.slice(2);
const value = flag => args[args.indexOf(flag) + 1];
assert.equal(value('--tools'), 'Read,Edit');
assert.equal(value('--permission-mode'), 'dontAsk');
assert.equal(value('--setting-sources'), '');
assert.equal(value('--settings'), '{"disableAllHooks":true}');
assert.equal(value('--mcp-config'), '{"mcpServers":{}}');
assert.ok(args.includes('--strict-mcp-config'));
assert.ok(args.includes('--disable-slash-commands'));
assert.ok(args.includes('Read(./**)'));
assert.ok(args.includes('Edit(./apps/api/src/main.ts)'));
assert.equal(value('--model'), 'claude-test-fixture');
assert.equal(value('--max-budget-usd'), '1');
assert.equal(process.env.GITHUB_TOKEN, undefined);
state.calls++;
state.args = args;
fs.writeFileSync(file, JSON.stringify(state));
const source = 'apps/api/src/main.ts';
let code = fs.readFileSync(source, 'utf8');
if (state.behavior === 'red') code += '\\n// unfinished candidate\\n';
else code = code.replace('credentials: true,', "credentials: true,\\n    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],");
fs.writeFileSync(source, code);
if (state.behavior === 'protected') fs.appendFileSync('package.json', '\\n');
if (state.behavior === 'invalid') console.log('lost JSON');
else {
  const failed = state.behavior === 'failed';
  console.log(JSON.stringify({
    type: 'result', session_id: value('--session-id'),
    subtype: failed ? 'error_max_turns' : 'success', is_error: failed,
    total_cost_usd: 0.12, num_turns: 2,
    usage: { input_tokens: 10, output_tokens: 5 },
  }));
}
`,
    { mode: 0o755 },
  );
  return {
    directory,
    store: path.join(directory, 'reports'),
    options: {
      store: path.join(directory, 'reports'),
      env: {
        ...process.env,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        GITHUB_TOKEN: 'not-for-the-model',
      },
    },
    read: () => JSON.parse(fs.readFileSync(control, 'utf8')),
    journal: () => {
      const store = path.join(directory, 'reports');
      const name = fs
        .readdirSync(store)
        .find((file) => /^pilot-.*\.json$/.test(file));
      return {
        file: path.join(store, name),
        state: JSON.parse(fs.readFileSync(path.join(store, name), 'utf8')),
      };
    },
  };
}

test('pilot requires separate explicit limits and refuses aliases or implicit approval', () => {
  const valid = parseApproval(FLAGS);
  assert.equal(valid.maxBudgetUsd, 1);
  for (const flags of [
    FLAGS.slice(0, -1),
    [...FLAGS, '--allow-model'],
    FLAGS.map((flag) => (flag === 'claude-test-fixture' ? 'sonnet' : flag)),
    FLAGS.map((flag) => (flag === '1' ? '0' : flag)),
    FLAGS.map((flag) => (flag === '10' ? 'NaN' : flag)),
    FLAGS.slice(0, 6).concat('--allow-model'),
  ])
    assert.throws(() => parseApproval(flags));
});

test('pilot verifies a real patch, records spend and never retries the model', async (t) => {
  const f = fixture(t);
  const destination = path.join(f.directory, 'candidate');
  const result = await runPilot(
    'cors-methods',
    destination,
    parseApproval(FLAGS),
    f.options,
  );
  assert.equal(result.stage, 'verified_locally');
  assert.equal(result.outcome.costUsd, 0.12);
  assert.equal(result.outcome.errorCode, null);
  assert.equal(result.outcome.usage.turns, 2);
  assert.equal(result.verifications[0].result.tasks[0].outcomes[0].failed, 0);
  const modelFile = result.file.replace(/\.json$/, '.model.patch');
  const candidateFile = result.file.replace(/\.json$/, '.patch');
  const modelPatch = fs.readFileSync(modelFile);
  assert.equal(result.modelPatchSha256, hash(modelPatch));
  assert.equal(result.patchSha256, result.modelPatchSha256);
  assert.deepEqual(fs.readFileSync(candidateFile), modelPatch);
  assert.equal(f.read().calls, 1);
  await assert.rejects(
    runPilot('cors-methods', destination, parseApproval(FLAGS), f.options),
    /new directory/,
  );
  const resumed = await verifyPilot(result.file);
  assert.equal(resumed.verifications.length, 2);
  assert.equal(f.read().calls, 1);
  fs.appendFileSync(path.join(destination, 'repo/apps/api/src/main.ts'), '\n');
  await assert.rejects(verifyPilot(result.file), /confirm-candidate/);
  const confirmed = await verifyPilot(result.file, true);
  assert.equal(confirmed.verifications.length, 3);
  assert.deepEqual(confirmed.verifications.slice(0, 2), resumed.verifications);
  assert.equal(confirmed.modelPatchSha256, result.modelPatchSha256);
  assert.deepEqual(fs.readFileSync(modelFile), modelPatch);
  assert.notEqual(confirmed.patchSha256, confirmed.modelPatchSha256);
  assert.equal(hash(fs.readFileSync(candidateFile)), confirmed.patchSha256);
  assert.equal(confirmed.approvedPatchSha256, confirmed.patchSha256);

  const legacy = f.journal().state;
  delete legacy.modelPatchSha256;
  fs.writeFileSync(result.file, JSON.stringify(legacy));
  fs.renameSync(
    modelFile,
    result.file.replace(/\.json$/, '.manual-backup.patch'),
  );
  const rechecked = await verifyPilot(result.file, true);
  assert.equal(rechecked.modelPatchSha256, undefined);
  assert.equal(fs.existsSync(modelFile), false);
  assert.equal(rechecked.patchSha256, confirmed.patchSha256);
  assert.equal(f.read().calls, 1);
});

test('a damaged spending journal blocks the model before preflight', async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.store);
  fs.writeFileSync(
    path.join(f.store, 'pilot-damaged.json'),
    JSON.stringify({
      kind: 'control-pilot',
      version: 1,
      outcome: null,
    }),
  );
  await assert.rejects(
    runPilot(
      'cors-methods',
      path.join(f.directory, 'candidate'),
      parseApproval(FLAGS),
      f.options,
    ),
    /Invalid pilot journal/,
  );
  assert.equal(f.read().calls, 0);
});

test('failed or lost CLI results preserve the patch until explicit free confirmation', async (t) => {
  for (const behavior of ['failed', 'invalid']) {
    const f = fixture(t, behavior);
    const destination = path.join(f.directory, 'candidate');
    await assert.rejects(
      runPilot('cors-methods', destination, parseApproval(FLAGS), f.options),
      /Model failed/,
    );
    const { file, state } = f.journal();
    assert.equal(state.stage, 'model_failed');
    assert.equal(state.verifications.length, 0);
    const modelFile = file.replace(/\.json$/, '.model.patch');
    const modelPatch = fs.readFileSync(modelFile);
    assert.equal(state.modelPatchSha256, hash(modelPatch));
    assert.ok(fs.statSync(file.replace(/\.json$/, '.patch')).size > 0);
    await assert.rejects(verifyPilot(file), /confirm-candidate/);
    fs.appendFileSync(
      path.join(destination, 'repo/apps/api/src/main.ts'),
      '\n',
    );
    const verified = await verifyPilot(file, true);
    assert.equal(verified.stage, 'verified_locally');
    assert.equal(verified.outcome.status, 'failed');
    assert.deepEqual(verified.outcome, state.outcome);
    assert.deepEqual(verified.stops, state.stops);
    assert.equal(verified.modelPatchSha256, state.modelPatchSha256);
    assert.deepEqual(fs.readFileSync(modelFile), modelPatch);
    assert.notEqual(verified.patchSha256, state.modelPatchSha256);
    assert.equal(verified.approvedPatchSha256, verified.patchSha256);
    assert.equal(f.read().calls, 1);
    if (behavior === 'invalid') {
      assert.equal(verified.outcome.costUsd, null);
      await assert.rejects(
        runPilot(
          'cors-methods',
          path.join(f.directory, 'next'),
          parseApproval(FLAGS),
          f.options,
        ),
        /Unaccounted model spend/,
      );
      assert.equal(f.read().calls, 1);
    }
  }
});

test('red acceptance and attempts to change its machinery cannot pass', async (t) => {
  for (const behavior of ['red', 'protected']) {
    const f = fixture(t, behavior);
    await assert.rejects(
      runPilot(
        'cors-methods',
        path.join(f.directory, 'candidate'),
        parseApproval(FLAGS),
        f.options,
      ),
    );
    const { state } = f.journal();
    assert.equal(
      state.stage,
      behavior === 'red' ? 'verification_failed' : 'candidate',
    );
    assert.equal(state.verifications.length, behavior === 'red' ? 1 : 0);
    assert.equal(f.read().calls, 1);
    assert.equal(state.outcome.costUsd, 0.12);
  }
});
