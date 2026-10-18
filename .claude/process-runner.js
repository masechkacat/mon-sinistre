import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const DEFAULT_MAX_BUFFER = 32 * 1024 * 1024;
const MAX_TIMEOUT = 2 ** 31 - 1;
const EXIT_DRAIN_TIMEOUT_MS = 1000;
const SUPERVISOR = String.raw`
const { spawn } = require('node:child_process');
// Keep the group leader alive until cleanup, so its PID cannot be reused.
process.on('disconnect', () => process.kill(-process.pid, 'SIGKILL'));
process.once('message', ({ command, args, cwd, env }) => {
  const report = (message) => process.send(message);
  try {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.once('error', (error) => report({
      error: { message: error.message, code: error.code, errno: error.errno,
        syscall: error.syscall, path: error.path, spawnargs: error.spawnargs }
    }));
    child.once('exit', (status, signal) => report({ status, signal }));
  } catch (error) {
    report({ error: { message: error.message, code: error.code } });
  }
});
`;

function codedError(message, code) {
  return Object.assign(new Error(message), { code });
}

export async function runProcess(command, args = [], options = {}) {
  const {
    cwd,
    env,
    timeout,
    maxBuffer = DEFAULT_MAX_BUFFER,
    stdio = ['ignore', 'pipe', 'pipe'],
  } = options;
  let status = null;
  let signal = null;
  let error;
  const modes = stdio === 'inherit' ? ['inherit', 'inherit', 'inherit'] : stdio;
  const captured = [1, 2].map((fd) => modes?.[fd] === 'pipe');
  const chunks = [[], []];
  const sizes = [0, 0];
  const result = () => ({
    status,
    signal,
    stdout: captured[0] ? Buffer.concat(chunks[0]).toString('utf8') : null,
    stderr: captured[1] ? Buffer.concat(chunks[1]).toString('utf8') : null,
    error,
  });

  if (process.platform === 'win32') {
    error = codedError('Process-group cleanup requires Unix', 'ENOTSUP');
    return result();
  }
  if (
    typeof command !== 'string' ||
    !command ||
    !Array.isArray(args) ||
    args.some((arg) => typeof arg !== 'string') ||
    !Number.isInteger(timeout) ||
    timeout <= 0 ||
    timeout > MAX_TIMEOUT ||
    !Number.isSafeInteger(maxBuffer) ||
    maxBuffer < 0 ||
    (stdio !== 'inherit' &&
      (!Array.isArray(stdio) ||
        stdio.length !== 3 ||
        stdio[0] !== 'ignore' ||
        stdio[1] !== 'pipe' ||
        !['pipe', 'inherit'].includes(stdio[2])))
  ) {
    error = codedError('Invalid runProcess arguments or options', 'EINVAL');
    return result();
  }

  const deadline = performance.now() + timeout;
  return new Promise((resolve) => {
    let child;
    let timer;
    let settled = false;
    let stopping = false;
    let exited = false;
    let reported = false;

    const rememberError = (next) => {
      if (!error) error = next;
      else {
        const combined = new AggregateError(
          [error, next],
          `${error.message}; ${next.message}`,
          { cause: error },
        );
        combined.code = error.code;
        error = combined;
      }
    };
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child?.stdout?.destroy();
      child?.stderr?.destroy();
      resolve(result());
    };
    const stop = () => {
      if (stopping || exited || !child?.pid) return;
      stopping = true;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch (cleanupError) {
        if (cleanupError.code !== 'ESRCH') {
          rememberError(cleanupError);
          try {
            child.kill('SIGKILL');
          } catch (leaderError) {
            if (leaderError.code !== 'ESRCH') rememberError(leaderError);
          }
        }
      }
      clearTimeout(timer);
      // A descendant outside the group may retain a pipe after the command exits.
      timer = setTimeout(finish, EXIT_DRAIN_TIMEOUT_MS);
    };
    const expire = () => {
      if (settled) return;
      rememberError(codedError('Process deadline exceeded', 'ETIMEDOUT'));
      stop();
      if (!reported) signal = 'SIGKILL';
      // Escaped children can retain pipes; never wait for their EOF at deadline.
      finish();
    };

    try {
      child = spawn(
        process.execPath,
        ['--input-type=commonjs', '--eval', SUPERVISOR],
        { detached: true, stdio: [...modes, 'ipc'] },
      );
    } catch (launchError) {
      rememberError(launchError);
      finish();
      return;
    }
    timer = setTimeout(expire, Math.max(1, deadline - performance.now()));
    child.once('spawn', () => {
      if (settled || stopping) return;
      if (performance.now() >= deadline) {
        expire();
        return;
      }
      child.send(
        { command, args, cwd, env: env ?? process.env },
        (sendError) => {
          if (!sendError || settled || stopping) return;
          rememberError(sendError);
          stop();
        },
      );
    });
    child.on('error', (launchError) => {
      if (settled) return;
      rememberError(launchError);
      stop();
      if (!child.pid) finish();
    });
    child.once('message', (message) => {
      if (settled || stopping) return;
      reported = true;
      if (message.error) {
        rememberError(
          Object.assign(new Error(message.error.message), message.error),
        );
      } else {
        status = message.status;
        signal = message.signal;
      }
      stop();
    });
    [child.stdout, child.stderr].forEach((stream, index) => {
      stream?.on('data', (chunk) => {
        if (settled) return;
        const remaining = maxBuffer - sizes[index];
        if (remaining > 0) {
          const kept = chunk.subarray(0, remaining);
          chunks[index].push(kept);
          sizes[index] += kept.length;
        }
        if (chunk.length > remaining && !error) {
          rememberError(
            codedError('Process output exceeded maxBuffer', 'ENOBUFS'),
          );
          stop();
          if (!reported) signal = 'SIGKILL';
        }
      });
      stream?.on('error', (streamError) => {
        if (settled) return;
        rememberError(streamError);
        stop();
      });
    });
    child.once('exit', (code, exitSignal) => {
      exited = true;
      if (settled) return;
      if (!stopping) {
        // Never signal a reaped leader's numeric group ID: it may be reused.
        rememberError(
          codedError(
            'Process supervisor exited before group cleanup',
            'ESUPERVISOR',
          ),
        );
      }
      if (!reported) signal = exitSignal;
    });
    child.once('close', () => {
      if (!settled && !stopping && performance.now() >= deadline) expire();
      else finish();
    });
  });
}
