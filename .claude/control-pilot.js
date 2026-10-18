import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { runIteration } from './ralph.js';
import { acquireLock, writeState } from './ralph-state.js';
import {
  checkControls,
  controlDirectory,
  gitEnvironment,
  hash,
  prepare,
  suiteSha256,
  taskById,
} from './control-tasks.js';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const git = (repo, ...args) =>
  execFileSync('git', args, {
    cwd: repo,
    encoding: 'utf8',
    env: gitEnvironment,
  }).trim();

function parseApproval(args) {
  const approval = {};
  const options = new Map([
    ['--model', 'model'],
    ['--max-budget-usd', 'maxBudgetUsd'],
    ['--max-turns', 'maxTurns'],
    ['--timeout-ms', 'iterationTimeoutMs'],
    ['--allow-model', 'allowModel'],
  ]);
  for (let index = 0; index < args.length; index++) {
    const key = options.get(args[index]);
    if (!key || Object.hasOwn(approval, key))
      throw new Error(`Unknown or duplicate pilot option: ${args[index]}`);
    approval[key] = key === 'allowModel' ? true : args[++index];
  }
  validateApproval(approval);
  return approval;
}

function validateApproval(approval) {
  if (approval.allowModel !== true)
    throw new Error('Model calls require explicit --allow-model approval');
  if (
    typeof approval.model !== 'string' ||
    !/^claude-[a-zA-Z0-9._-]+$/.test(approval.model)
  )
    throw new Error(
      'Specify a full Claude model ID, not an alias such as sonnet',
    );
  for (const key of ['maxBudgetUsd', 'maxTurns', 'iterationTimeoutMs']) {
    const value = Number(approval[key]);
    if (
      !Number.isFinite(value) ||
      value <= 0 ||
      (key !== 'maxBudgetUsd' && !Number.isSafeInteger(value))
    )
      throw new Error(`An explicit positive ${key} is required`);
    approval[key] = value;
  }
}

function requireAccountedRuns(store) {
  for (const name of fs
    .readdirSync(store)
    .filter((name) => /^pilot-.*\.json$/.test(name))) {
    const state = read(path.join(store, name));
    if (
      state.kind !== 'control-pilot' ||
      state.version !== 1 ||
      typeof state.startedAt !== 'string' ||
      !Number.isFinite(Date.parse(state.startedAt)) ||
      (state.outcome !== null &&
        !['success', 'failed'].includes(state.outcome?.status))
    )
      throw new Error(`Invalid pilot journal: ${name}`);
    if (
      state.startedAt &&
      (!Number.isFinite(state.outcome?.costUsd) || state.outcome.costUsd < 0)
    )
      throw new Error(
        `Unaccounted model spend in ${name}; reconcile it before another paid call`,
      );
  }
}

function candidate(state) {
  const repo = path.join(state.directory, 'repo');
  assert.equal(
    git(repo, 'rev-parse', 'HEAD'),
    state.initialHead,
    'The model must not change Git history',
  );
  assert.equal(
    git(repo, 'branch', '--show-current'),
    `control/${state.task}`,
    'Unexpected branch',
  );
  assert.equal(
    git(repo, 'remote'),
    '',
    'Control repositories must have no remotes',
  );
  assert.equal(
    git(repo, 'ls-files', '--others', '--exclude-standard'),
    '',
    'Unexpected untracked files',
  );
  assert.equal(
    git(repo, 'diff', '--summary', state.initialHead),
    '',
    'File modes must not change',
  );
  const files = git(repo, 'diff', '--name-only', state.initialHead)
    .split('\n')
    .filter(Boolean);
  assert.ok(files.length, 'The model left no candidate');
  const task = taskById(state.task);
  for (const file of files) {
    assert.ok(
      task.paths.includes(file),
      `The model changed a protected file: ${file}`,
    );
    assert.ok(
      fs.lstatSync(path.join(repo, file)).isFile(),
      `Not a regular source file: ${file}`,
    );
  }
  return execFileSync(
    'git',
    ['diff', '--binary', state.initialHead, '--', ...task.paths],
    {
      cwd: repo,
      env: gitEnvironment,
    },
  );
}

function modelEnvironment(env) {
  return Object.fromEntries(
    [
      'PATH',
      'HOME',
      'LANG',
      'TERM',
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
      'ANTHROPIC_BASE_URL',
    ]
      .filter((key) => env[key] !== undefined)
      .map((key) => [key, env[key]]),
  );
}

function saveCandidatePatch(state, file, patch) {
  state.patchSha256 = hash(patch);
  fs.writeFileSync(file.replace(/\.json$/, '.patch'), patch, { mode: 0o600 });
}

async function verify(state, file, confirm) {
  assert.equal(state.version, 1);
  assert.equal(state.kind, 'control-pilot');
  assert.equal(state.suiteSha256, suiteSha256, 'The control suite changed');
  const patch = candidate(state);
  const patchSha256 = hash(patch);
  if (
    state.outcome?.status !== 'success' ||
    state.patchSha256 !== patchSha256
  ) {
    if (!confirm && state.approvedPatchSha256 !== patchSha256)
      throw new Error(
        'This candidate needs explicit --confirm-candidate after checking the former model process has ended',
      );
    if (confirm) state.approvedPatchSha256 = patchSha256;
  }
  saveCandidatePatch(state, file, patch);
  const check = {
    patchSha256,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  state.verifications.push(check);
  state.stage = 'verifying';
  writeState(file, state);
  try {
    const result = await checkControls([taskById(state.task)], patch);
    assert.equal(
      result.tasks[0].initialHead,
      state.initialHead,
      'The acceptance fixture changed',
    );
    assert.equal(
      hash(candidate(state)),
      patchSha256,
      'Candidate changed during verification',
    );
    check.status = 'passed';
    check.result = result;
    state.stage = 'verified_locally';
  } catch (error) {
    check.status = 'failed';
    state.stage = 'verification_failed';
    throw error;
  } finally {
    check.completedAt = new Date().toISOString();
    writeState(file, state);
  }
}

async function runPilot(
  id,
  directory,
  approval,
  { store = controlDirectory(), env = process.env } = {},
) {
  validateApproval(approval);
  const task = taskById(id);
  directory = path.resolve(directory);
  if (fs.existsSync(directory))
    throw new Error(
      'Pilot requires a new directory; it never retries the model',
    );
  fs.mkdirSync(store, { recursive: true });
  const release = acquireLock(path.join(store, 'pilot.lock'));
  let file;
  let state;
  try {
    requireAccountedRuns(store);
    const preflight = await checkControls([task]);
    const prepared = prepare(task, directory);
    assert.equal(prepared.metadata.initialHead, preflight.tasks[0].initialHead);
    const sessionId = randomUUID();
    file = path.join(store, `pilot-${sessionId}.json`);
    state = {
      ...prepared.metadata,
      kind: 'control-pilot',
      suiteSha256,
      directory,
      sessionId,
      model: approval.model,
      limits: {
        maxBudgetUsd: approval.maxBudgetUsd,
        maxTurns: approval.maxTurns,
        iterationTimeoutMs: approval.iterationTimeoutMs,
      },
      runnerSha256: hash(fs.readFileSync(import.meta.filename)),
      invocationSha256: hash(
        fs.readFileSync(new URL('./ralph.js', import.meta.url)),
      ),
      preflight,
      stage: 'running',
      startedAt: new Date().toISOString(),
      outcome: null,
      verifications: [],
    };
    writeState(file, state);
    const prompt = [
      task.prompt,
      `Файлы для исправления: ${task.paths.join(', ')}.`,
      'Это локальный контрольный пилот, не итерация Ralph. Доступны только чтение и правка.',
      'Не запускай команды, скиллы, субагентов и не делай коммитов. Проверки выполнит оркестратор.',
      'Заверши сессию сразу после исправления. Не изменяй другие файлы.',
    ].join('\n');
    state.outcome = runIteration(
      {
        ...state.limits,
        model: approval.model,
        permissionMode: 'dontAsk',
        allowedTools: [
          'Read(./**)',
          ...task.paths.map((file) => `Edit(./${file})`),
        ],
      },
      prompt,
      sessionId,
      {
        cwd: prepared.repo,
        env: modelEnvironment(env),
        killSignal: 'SIGKILL',
        extraArgs: [
          '--tools',
          'Read,Edit',
          '--disable-slash-commands',
          '--setting-sources',
          '',
          '--settings',
          '{"disableAllHooks":true}',
          '--strict-mcp-config',
          '--mcp-config',
          '{"mcpServers":{}}',
        ],
      },
    );
    state.finishedAt = new Date().toISOString();
    state.stage =
      state.outcome.status === 'success' ? 'candidate' : 'model_failed';
    writeState(file, state);
    saveCandidatePatch(state, file, candidate(state));
    writeState(file, state);
    if (state.outcome.status !== 'success')
      throw new Error(
        'Model failed; candidate retained, no automatic verification or retry',
      );
    await verify(state, file, false);
    return { file, ...state };
  } catch (error) {
    if (state) {
      state.stops ??= [];
      state.stops.push({
        stage: state.stage,
        at: new Date().toISOString(),
        reason: error.message,
      });
      writeState(file, state);
      throw new Error(`${error.message}\nPilot journal: ${file}`, {
        cause: error,
      });
    }
    throw error;
  } finally {
    release();
  }
}

async function verifyPilot(file, confirm = false) {
  file = path.resolve(file);
  if (!/^pilot-.*\.json$/.test(path.basename(file)))
    throw new Error('Expected a pilot journal');
  const release = acquireLock(path.join(path.dirname(file), 'pilot.lock'));
  try {
    const state = read(file);
    await verify(state, file, confirm);
    return { file, ...state };
  } finally {
    release();
  }
}

async function main(args) {
  const [command, target, directory, ...options] = args;
  let report;
  if (command === 'run' && target && directory)
    report = await runPilot(target, directory, parseApproval(options));
  else if (
    command === 'verify' &&
    target &&
    args.length <= 3 &&
    (!directory || directory === '--confirm-candidate')
  )
    report = await verifyPilot(target, directory === '--confirm-candidate');
  else
    throw new Error(
      'Usage: control-pilot.js run <task> <new-directory> --model <id> --max-budget-usd <usd> --max-turns <n> --timeout-ms <ms> --allow-model | verify <pilot-journal> [--confirm-candidate]',
    );
  console.log(JSON.stringify(report, null, 2));
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

export { parseApproval, runPilot, verifyPilot };
