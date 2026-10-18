import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const STAGES = new Set([
  'running',
  'candidate',
  'published',
  'complete',
  'no_commit',
]);
const isSha = (value) =>
  typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);
const isCount = (value) => Number.isInteger(value) && value >= 0;

function stateDirectory(root) {
  return path.resolve(
    root,
    execFileSync('git', ['rev-parse', '--git-path', 'ralph'], {
      cwd: root,
      encoding: 'utf8',
    }).trim(),
  );
}

function statePath(root, branch) {
  return path.join(
    stateDirectory(root),
    `${createHash('sha256').update(branch).digest('hex')}.json`,
  );
}

function verificationRuns(attempt) {
  if (attempt.verifications) return attempt.verifications;
  return attempt.verification
    ? [{ ...attempt.verification, status: 'passed' }]
    : [];
}

function readState(file, branch) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' || branch === undefined) throw error;
    return { version: 1, branch, attempts: [] };
  }
  let state;
  try {
    state = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new SyntaxError(
      `Не удалось прочитать журнал ${file}: ${error.message}`,
      {
        cause: error,
      },
    );
  }
  if (
    state?.version !== 1 ||
    typeof state.branch !== 'string' ||
    !state.branch ||
    (branch !== undefined && state.branch !== branch) ||
    (state.verifications !== undefined &&
      !Array.isArray(state.verifications)) ||
    !Array.isArray(state.attempts) ||
    !state.attempts.every(
      (a) =>
        Number.isInteger(a.issue) &&
        a.issue > 0 &&
        typeof a.sessionId === 'string' &&
        isSha(a.before) &&
        (a.head === null || isSha(a.head)) &&
        STAGES.has(a.stage) &&
        (a.verifications === undefined || Array.isArray(a.verifications)) &&
        (a.stops === undefined ||
          (Array.isArray(a.stops) &&
            a.stops.every(
              (stop) => typeof stop?.kind === 'string' && stop.kind,
            ))) &&
        (a.outcome === null ||
          ['success', 'failed'].includes(a.outcome?.status)),
    ) ||
    state.attempts.slice(0, -1).some((a) => !isFinished(a))
  )
    throw new Error(`Повреждён или несовместим журнал Ralph: ${file}`);
  return state;
}

function isFinished(attempt) {
  return ['complete', 'no_commit'].includes(attempt.stage);
}

function writeState(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2) + '\n', {
      mode: 0o600,
    });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function acquireLock(file) {
  if (fs.existsSync(file)) {
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!Number.isInteger(owner.pid) || owner.pid < 1)
      throw new Error(`Повреждён lock Ralph: ${file}`);
    let alive = true;
    if (owner.host === os.hostname()) {
      try {
        process.kill(owner.pid, 0);
      } catch (error) {
        if (error.code !== 'ESRCH') throw error;
        alive = false;
      }
    }
    if (alive)
      throw new Error(`Ralph уже запущен: PID ${owner.pid}, ${owner.host}`);
    console.warn(`Ralph: удалён lock завершившегося процесса ${owner.pid}`);
    fs.unlinkSync(file);
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ pid: process.pid, host: os.hostname() }),
    { flag: 'wx', mode: 0o600 },
  );
  return () => fs.unlinkSync(file);
}

function parseRunResult(res, sessionId) {
  let result;
  try {
    result = JSON.parse(res.stdout || '');
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
  }
  const valid = result?.type === 'result' && result.session_id === sessionId;
  const success =
    valid &&
    result.subtype === 'success' &&
    result.is_error === false &&
    res.status === 0 &&
    !res.error &&
    !res.signal;
  const usage = valid && result.usage;
  const counts = usage && {
    input: usage.input_tokens,
    cacheRead: usage.cache_read_input_tokens ?? 0,
    cacheWrite: usage.cache_creation_input_tokens ?? 0,
    output: usage.output_tokens,
    turns: result.num_turns,
  };
  const completeUsage = counts && Object.values(counts).every(isCount);
  return {
    status: success ? 'success' : 'failed',
    failureKind: success
      ? null
      : res.error?.code === 'ETIMEDOUT'
        ? 'timeout'
        : res.error || res.signal
          ? 'process_error'
          : !valid
            ? 'invalid_result'
            : result.is_error
              ? 'model_error'
              : 'process_error',
    reason: success
      ? null
      : res.error?.message ||
        res.signal ||
        (valid
          ? `${result.subtype}; exit=${res.status}`
          : 'Нет корректного JSON-result этой сессии'),
    exitCode: res.status,
    usage: completeUsage
      ? {
          ...counts,
          context: counts.input + counts.cacheRead + counts.cacheWrite,
        }
      : null,
    costUsd:
      valid &&
      Number.isFinite(result.total_cost_usd) &&
      result.total_cost_usd >= 0
        ? result.total_cost_usd
        : null,
  };
}

export {
  acquireLock,
  isFinished,
  parseRunResult,
  readState,
  stateDirectory,
  statePath,
  verificationRuns,
  writeState,
};
