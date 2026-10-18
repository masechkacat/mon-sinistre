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
      if (state.protectedFile) {
        fs.mkdirSync(path.dirname(state.protectedFile), { recursive: true });
        fs.appendFileSync(state.protectedFile, '// altered acceptance\n');
        execFileSync('git', ['add', state.protectedFile]);
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
  for (const name of [
    'ralph.js',
    'ralph-state.js',
    'process-runner.js',
    'metrics.js',
    'run-report.js',
  ])
    fs.copyFileSync(
      path.join(import.meta.dirname, name),
      path.join(root, '.claude', name),
    );
  for (const name of ['gh', 'claude'])
    fs.writeFileSync(path.join(bin, name), COMMAND, { mode: 0o755 });
  if (options.launchError) {
    const gitPath = env.PATH.split(path.delimiter)
      .map((directory) => path.join(directory, 'git'))
      .find((file) => fs.existsSync(file));
    fs.symlinkSync(gitPath, path.join(bin, 'git'));
    fs.symlinkSync(process.execPath, path.join(bin, 'node'));
    env.PATH = bin;
    if (options.launchError === 'ENOENT')
      fs.unlinkSync(path.join(bin, 'claude'));
    else fs.chmodSync(path.join(bin, 'claude'), 0o644);
  }
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
      maxIterations: options.maxIterations ?? 1,
      stallLimit: options.stallLimit ?? 2,
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
    metrics: (...args) =>
      spawnSync(process.execPath, ['.claude/metrics.js', ...args], {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 10000,
      }),
    journal: () => JSON.parse(fs.readFileSync(journalFile(), 'utf8')),
  };
}

function expectExit(result, code) {
  assert.equal(result.error, undefined);
  assert.equal(result.status, code, result.stdout + result.stderr);
}

test('ошибка запуска Claude сохраняется и останавливает цикл без повторов', (t) => {
  for (const code of ['ENOENT', 'EACCES']) {
    const f = fixture(t, { launchError: code, maxIterations: 3 });
    const result = f.run();
    expectExit(result, 1);
    assert.match(result.stderr, /Ошибка процесса Claude/);
    assert.equal(f.journal().attempts.length, 1);
    const attempt = f.journal().attempts[0];
    assert.equal(attempt.outcome.errorCode, code);
    assert.equal(attempt.outcome.costUsd, null);
    assert.equal(attempt.stops.at(-1).kind, 'process_error');
    assert.equal(f.read().agentCalls, undefined);
    assert.equal(f.read().checks, undefined);
    assert.equal(f.read().done, undefined);
  }
});

function advanceMain(f, change) {
  f.git('checkout', 'main');
  fs.writeFileSync(path.join(f.root, 'main.txt'), 'new main\n');
  fs.appendFileSync(path.join(f.root, '.claude/metrics.js'), '\n');
  change?.();
  f.git('add', '.');
  f.git('commit', '-m', 'advance main');
  f.git('push', 'origin', 'main');
  f.git('checkout', 'fixture/phase-1');
}

function preparePhase(f) {
  f.git('checkout', '-b', 'fixture/phase-1');
  const file = path.join(f.root, 'package.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  manifest.dependencies = { 'human-approved-fixture': '1.0.0' };
  fs.writeFileSync(file, JSON.stringify(manifest));
  f.git('add', 'package.json');
  f.git('commit', '-m', 'human phase preparation');
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
  const report = f.metrics('--runs', 'all', '--json');
  expectExit(report, 0);
  const data = JSON.parse(report.stdout).current;
  assert.deepEqual(data.stops, { verification: 1, push: 1, board: 1 });
  assert.equal(data.tasks.accepted, 1);
  assert.equal(data.costUsd.perAcceptedTask, 0.25);
  assert.equal(data.timeMs.verification.total, 3);
  assert.equal(data.timeMs.verification.known, 3);
  assert.ok(data.timeMs.toAcceptance.median >= data.timeMs.agent.value);
  assert.equal(data.coverage.stopHistory.known, 1);
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
  for (const options of [
    { agent: 'change-manifest' },
    { protectedFile: '.claude/metrics.test.js' },
    { protectedFile: '.claude/control-tasks/oracle.spec.ts' },
    { protectedFile: '.jscpd-baseline.json' },
    { protectedFile: 'knip.jsonc' },
    { protectedFile: 'apps/api/vitest.config.ts' },
    { protectedFile: 'apps/web/playwright.e2e.config.ts' },
    { protectedFile: 'package-lock.json' },
    { protectedFile: '.npmrc' },
  ]) {
    const f = fixture(t, options);
    const result = f.run();
    expectExit(result, 1);
    assert.match(result.stderr, /собственной приёмки/);
    assert.equal(f.read().checks, undefined);
    assert.equal(f.read().done, undefined);
    assert.equal(
      f.git('ls-remote', '--heads', 'origin', 'fixture/phase-1'),
      '',
    );
  }
});

test('опубликованный кандидат восстанавливается после мержа main, а PR получает проверенный HEAD', (t) => {
  const f = fixture(t, { failBoard: true });
  preparePhase(f);
  expectExit(f.run(), 1);
  const original = f.journal().attempts[0];
  assert.equal(original.stage, 'published');
  advanceMain(f);
  f.git('merge', 'origin/main', '-m', 'merge newer main');
  const merged = f.git('rev-parse', 'HEAD');
  expectExit(f.run(), 1);
  assert.equal(f.read().checks, 1);
  f.update({ failBoard: false, failVerification: true });
  expectExit(f.run('--verify-candidate'), 1);
  assert.equal(f.journal().attempts[0].stage, 'published');
  assert.equal(f.read().done, undefined);
  f.update({ failVerification: false });
  expectExit(f.run('--verify-candidate'), 0);
  assert.equal(f.journal().attempts[0].head, original.head);
  assert.equal(f.journal().attempts[0].stage, 'complete');
  assert.deepEqual(f.journal().attempts[0].outcome, original.outcome);
  assert.deepEqual(
    f.journal().attempts[0].verifications.map((check) => check.status),
    ['passed', 'failed', 'passed'],
  );
  assert.equal(f.read().checks, 3);
  assert.equal(f.git('rev-parse', 'origin/fixture/phase-1'), original.head);
  expectExit(f.run(), 0);
  assert.equal(f.read().checks, 3);
  assert.equal(f.git('rev-parse', 'origin/fixture/phase-1'), merged);
  assert.equal(f.read().agentCalls, 1);
});

test('неопубликованный кандидат после сбоя приёмки или push принимает мерж main только с подтверждением', (t) => {
  for (const failVerification of [true, false]) {
    const f = fixture(t, { failVerification });
    preparePhase(f);
    const hook = path.join(f.remote, 'hooks/pre-receive');
    if (!failVerification)
      fs.writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    expectExit(f.run(), 1);
    const original = f.journal().attempts[0];
    assert.equal(original.stage, 'candidate');
    if (failVerification) {
      const legacy = f.journal();
      delete legacy.attempts[0].commitHead;
      writeState(f.journalFile(), legacy);
    }
    if (!failVerification) fs.unlinkSync(hook);
    advanceMain(f);
    expectExit(f.run(), 1);
    f.git('merge', 'origin/main', '-m', 'merge newer main');
    const merged = f.git('rev-parse', 'HEAD');
    expectExit(f.run(), 1);
    assert.equal(f.read().checks, 1);
    assert.equal(f.read().done, undefined);
    f.update({ failVerification: true });
    expectExit(f.run('--verify-candidate'), 1);
    assert.equal(f.read().checks, 2);
    assert.equal(f.read().done, undefined);
    f.update({ failVerification: false });
    expectExit(f.run(), 0);
    const recovered = f.journal().attempts[0];
    assert.equal(recovered.stage, 'complete');
    assert.equal(recovered.commitHead, original.head);
    assert.equal(recovered.head, merged);
    assert.deepEqual(recovered.outcome, original.outcome);
    assert.equal(f.git('rev-parse', 'origin/fixture/phase-1'), merged);
    assert.equal(f.read().checks, 3);
    assert.equal(f.read().agentCalls, 1);
  }
});

test('подтверждение интеграции main не разрешает лишний коммит или подмену приёмки в мерже', (t) => {
  for (const published of [false, true]) {
    for (const tamperMerge of [false, true]) {
      const f = fixture(t, {
        failVerification: !published,
        failBoard: published,
      });
      expectExit(f.run(), 1);
      if (tamperMerge) {
        advanceMain(f);
        f.git('merge', '--no-commit', 'origin/main');
        fs.appendFileSync(path.join(f.root, '.claude/metrics.js'), '\n');
        f.git('add', '.claude/metrics.js');
      } else {
        fs.appendFileSync(path.join(f.root, 'feature.txt'), 'extra change\n');
        f.git('add', 'feature.txt');
      }
      f.git('commit', '-m', 'unexpected candidate change');
      const result = f.run('--verify-candidate');
      expectExit(result, 1);
      assert.match(
        result.stderr,
        tamperMerge ? /собственной приёмки/ : /только мерж/,
      );
      assert.equal(f.read().checks, 1);
      assert.equal(f.read().done, undefined);
      assert.equal(f.read().agentCalls, 1);
    }
  }
});

test('ручное разрешение конфликта допускается только вне механизма приёмки', (t) => {
  for (const protectedConflict of [false, true]) {
    const f = fixture(t, { failVerification: true });
    preparePhase(f);
    expectExit(f.run(), 1);
    const file = path.join(
      f.root,
      protectedConflict ? 'package.json' : 'feature.txt',
    );
    const phaseContents = fs.readFileSync(file, 'utf8');
    advanceMain(f, () => {
      fs.writeFileSync(
        file,
        protectedConflict
          ? JSON.stringify({
              ...JSON.parse(fs.readFileSync(file, 'utf8')),
              description: 'main',
            })
          : 'different main implementation\n',
      );
    });
    assert.throws(() => f.git('merge', 'origin/main'));
    fs.writeFileSync(file, phaseContents);
    f.git('add', '.');
    f.git('commit', '-m', 'resolve main integration');
    f.update({ failVerification: false });
    const result = f.run('--verify-candidate');
    expectExit(result, protectedConflict ? 1 : 0);
    if (protectedConflict)
      assert.match(result.stderr, /Конфликт в механизме приёмки/);
    assert.equal(f.read().done, protectedConflict ? undefined : true);
    assert.equal(f.read().agentCalls, 1);
  }
});

test('опубликованный кандидат нельзя завершить после потери коммита в ветке или origin', (t) => {
  for (const rewindLocal of [false, true]) {
    const f = fixture(t, { failBoard: true });
    expectExit(f.run(), 1);
    const original = f.journal().attempts[0];
    f.git(
      '--git-dir',
      f.remote,
      'update-ref',
      'refs/heads/fixture/phase-1',
      original.before,
    );
    if (rewindLocal) {
      f.git('checkout', 'main');
      f.git('update-ref', 'refs/heads/fixture/phase-1', original.before);
      f.git('checkout', 'fixture/phase-1');
    }
    f.update({ failBoard: false });
    const result = f.run('--verify-candidate');
    expectExit(result, 1);
    assert.match(result.stderr, /Опубликованный кандидат отсутствует/);
    assert.equal(f.read().done, undefined);
    assert.equal(f.read().agentCalls, 1);
    assert.equal(f.journal().attempts[0].head, original.head);
  }
});

test('закрытая фаза без новых коммитов не запускает приёмку или ревью', (t) => {
  const f = fixture(t, { done: true, failVerification: true });
  const result = f.run();
  expectExit(result, 0);
  assert.match(result.stdout, /открывать нечего/);
  assert.equal(f.read().checks, undefined);
  assert.equal(f.read().reviews, undefined);
  assert.equal(f.read().agentCalls, undefined);
  assert.equal(fs.existsSync(path.join(f.root, '.git/ralph')), false);
});

test('восстановленный no_commit не расходует лимиты новых сессий запуска', (t) => {
  const f = fixture(t, { agent: 'no-commit', stallLimit: 1 });
  expectExit(f.run(), 1);
  const state = f.journal();
  state.attempts[0].stage = 'running';
  writeState(f.journalFile(), state);
  expectExit(f.run(), 1);
  assert.equal(f.read().agentCalls, 2);
  assert.deepEqual(
    f.journal().attempts.map((a) => a.stage),
    ['no_commit', 'no_commit'],
  );
});

test('dry-run не пишет журнал; lock и повреждённый журнал останавливают запуск', (t) => {
  const f = fixture(t);
  expectExit(f.run('--dry-run'), 0);
  assert.equal(f.git('branch', '--show-current'), 'main');
  assert.equal(fs.existsSync(path.join(f.root, '.git/ralph')), false);
  const empty = f.metrics('--list-runs', '--json');
  expectExit(empty, 0);
  assert.deepEqual(JSON.parse(empty.stdout), { version: 1, runs: [] });
  expectExit(f.metrics('--runs', 'all'), 1);
  expectExit(f.metrics('--runs', 'missing/phase-1'), 1);
  assert.equal(fs.existsSync(path.join(f.root, '.git/ralph')), false);
  const lock = path.join(f.root, '.git/ralph.lock');
  const release = acquireLock(lock);
  try {
    const result = f.run();
    expectExit(result, 1);
    assert.match(result.stderr, /уже запущен/);
    assert.doesNotMatch(result.stderr, /Непредвиденная ошибка/);
    assert.equal(f.read().agentCalls, undefined);
  } finally {
    release();
  }
  for (const damaged of ['', 'null', '{"pid":1}']) {
    fs.writeFileSync(lock, damaged);
    const result = f.run();
    expectExit(result, 1);
    assert.match(result.stderr, /Повреждён lock Ralph/);
    assert.doesNotMatch(
      result.stderr,
      /Непредвиденная ошибка|SyntaxError|TypeError/,
    );
    assert.equal(fs.readFileSync(lock, 'utf8'), damaged);
    assert.equal(f.read().agentCalls, undefined);
  }
  fs.unlinkSync(lock);
  const file = path.join(f.root, '.git/test-state.json');
  const state = readState(file, 'fixture/phase-1');
  writeState(file, state);
  assert.deepEqual(readState(file, state.branch), state);
  assert.throws(() => readState(file, 'another-branch'), /журнал/);
  fs.writeFileSync(file, '{');
  assert.throws(() => readState(file, state.branch), SyntaxError);
});

test('захват устаревшего lock сериализован, а освобождение привязано к владельцу', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ralph-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'lock');
  const dead = spawnSync(process.execPath, ['-e', '']).pid;
  fs.writeFileSync(file, JSON.stringify({ pid: dead, host: os.hostname() }));
  const kill = process.kill.bind(process);
  let contender;
  t.mock.method(process, 'kill', (pid, signal) => {
    if (pid === dead && !contender) {
      contender = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { acquireLock } from ${JSON.stringify(new URL('./ralph-state.js', import.meta.url).href)};
         try { acquireLock(${JSON.stringify(file)}); }
         catch (error) { console.error(error.message); process.exitCode = 1; }`,
        ],
        { encoding: 'utf8' },
      );
    }
    return kill(pid, signal);
  });
  const release = acquireLock(file);
  expectExit(contender, 1);
  assert.match(contender.stderr, /Захват lock уже выполняется/);
  release();
  const next = acquireLock(file);
  const owner = fs.readFileSync(file, 'utf8');
  release();
  assert.equal(fs.readFileSync(file, 'utf8'), owner);
  fs.writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, host: os.hostname() }),
  );
  assert.throws(next, /владелец lock изменился/);
  assert.ok(fs.existsSync(file));
  fs.mkdirSync(`${file}.guard`);
  assert.throws(() => acquireLock(file), /Захват lock уже выполняется/);
  assert.ok(fs.existsSync(`${file}.guard`));
});
