import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { acquireLock, parseRunResult, RalphStop } from './ralph-state.js';

test('process error codes survive parsing without inventing spend', () => {
  for (const code of ['ENOENT', 'ENOBUFS', 'ETIMEDOUT', undefined]) {
    const error = new Error('CLI interrupted');
    error.code = code;
    const outcome = parseRunResult({ error, status: null }, 'session');
    assert.equal(outcome.errorCode, code ?? null);
    assert.equal(outcome.status, 'failed');
    assert.equal(
      outcome.failureKind,
      code === 'ETIMEDOUT' ? 'timeout' : 'process_error',
    );
    assert.equal(outcome.costUsd, null);
  }
  const outcome = parseRunResult({ status: 1 }, 'session');
  assert.equal(outcome.errorCode, null);
  assert.equal(outcome.costUsd, null);
});

test('releasing a removed lock stops with guidance without losing ownership checks', (t) => {
  const directory = fs.mkdtempSync(
    path.join(import.meta.dirname, 'lock-test-'),
  );
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'lock');
  const release = acquireLock(file);
  const identity = fs.readFileSync(file);
  fs.unlinkSync(file);
  assert.throws(release, (error) => {
    assert.ok(error instanceof RalphStop);
    assert.match(error.message, /lock удалён/);
    assert.match(error.hint, /Проверь все запуски/);
    return true;
  });
  fs.mkdirSync(file);
  assert.throws(release, { code: 'EISDIR' });
  fs.rmdirSync(file);
  fs.writeFileSync(file, identity);
  release();
  release();
  assert.equal(fs.existsSync(file), false);
});
