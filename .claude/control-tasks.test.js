import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import {
  finishSelfCheck,
  prepare,
  suite,
  taskById,
  testResults,
} from './control-tasks.js';

test('self-check сохраняет контроли до recovery и явный итог при сбое или timeout', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'control-report-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'check.json');
  const tasks = [
    { task: 'completed-control', outcomes: [{ passed: 1, failed: 0 }] },
  ];
  for (const code of [null, 'ETIMEDOUT', 'EIO']) {
    const report = { tasks, modelCalls: 0 };
    const checking = finishSelfCheck(report, file, async () => {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      assert.deepEqual(saved.tasks, tasks);
      assert.equal(saved.status, 'running');
      assert.equal(saved.recovery.passed, null);
      if (code) throw Object.assign(new Error('Recovery failed'), { code });
    });
    if (code) await assert.rejects(checking, { code });
    else await checking;
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(saved.tasks, tasks);
    assert.equal(saved.status, code ? 'failed' : 'passed');
    assert.equal(saved.recovery.passed, !code);
    assert.equal(saved.recovery.errorCode, code || undefined);
    assert.ok(saved.completedAt);
    assert.equal(saved.modelCalls, 0);
  }
});

test('controls reproduce the same initial commit without history or remotes', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'control-prepare-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const task of suite.tasks) {
    const first = prepare(task, path.join(directory, `${task.id}-first`));
    const second = prepare(task, path.join(directory, `${task.id}-second`));
    assert.deepEqual(first.metadata, second.metadata);
    const git = (...args) =>
      execFileSync('git', args, {
        cwd: first.repo,
        encoding: 'utf8',
      }).trim();
    assert.equal(git('remote'), '');
    assert.equal(git('rev-list', '--count', 'HEAD'), '1');
    assert.equal(git('status', '--porcelain'), '');
    assert.throws(() => prepare(task, path.dirname(first.repo)), {
      code: 'EEXIST',
    });
  }
  assert.throws(() => taskById('missing'), /Unknown control task/);
});

test('a red control requires its exact failing scenario, not a setup error or missing tests', () => {
  const task = taskById('cors-methods');
  const report = {
    numTotalTestSuites: 1,
    numFailedTestSuites: 1,
    numFailedTests: 1,
    testResults: [
      {
        assertionResults: [
          {
            title: task.regressionFailure,
            fullName: task.regressionFailure,
            status: 'failed',
            failureMessages: task.failureIncludes,
          },
        ],
      },
    ],
  };
  testResults(report, task, true);
  for (const invalid of [
    { ...report, testResults: [] },
    { ...report, numRuntimeErrorTestSuites: 1 },
    {
      ...report,
      testResults: [
        {
          assertionResults: [
            {
              ...report.testResults[0].assertionResults[0],
              failureMessages: ['Database unavailable'],
            },
          ],
        },
      ],
    },
    {
      ...report,
      testResults: [
        {
          assertionResults: [{ title: 'different failure', status: 'failed' }],
        },
      ],
    },
  ])
    assert.throws(() => testResults(invalid, task, true));
  assert.throws(() => testResults(report, task, false));
});
