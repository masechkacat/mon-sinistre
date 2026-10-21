import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRunReport,
  formatRunReport,
  summarizeRuns,
} from './run-report.js';

const at = (seconds) =>
  new Date(Date.UTC(2026, 0, 1) + seconds * 1000).toISOString();

function attempt(overrides = {}) {
  return {
    issue: 1,
    stage: 'complete',
    telemetryVersion: 2,
    model: 'test-model',
    runnerRevision: 'a'.repeat(40),
    startedAt: at(0),
    finishedAt: at(2),
    completedAt: at(5),
    outcome: { status: 'success', costUsd: 1, usage: { context: 10 } },
    verifications: [{ startedAt: at(2), completedAt: at(3), status: 'passed' }],
    stops: [],
    ...overrides,
  };
}

test('стоимость принятой задачи включает повторы и незавершённые задачи выборки', () => {
  const data = summarizeRuns([
    {
      branch: 'feature/phase-1',
      attempts: [
        attempt({
          stage: 'no_commit',
          outcome: { status: 'failed', costUsd: 2 },
          verifications: [],
          stops: [{ kind: 'model_error' }],
        }),
        attempt({
          startedAt: at(10),
          finishedAt: at(12),
          completedAt: at(30),
          outcome: { status: 'success', costUsd: 3 },
          verifications: [
            { startedAt: at(12), completedAt: at(15), status: 'passed' },
          ],
        }),
        attempt({
          issue: 2,
          stage: 'candidate',
          outcome: { status: 'failed', costUsd: 4 },
          verifications: [],
          stops: [{ kind: 'timeout' }],
        }),
      ],
    },
  ]);
  assert.deepEqual(data.tasks, {
    total: 2,
    accepted: 1,
    firstPass: 0,
    firstPassRate: 0,
  });
  assert.deepEqual(data.attempts, {
    total: 3,
    pending: 1,
    modelFailures: 2,
    noCommit: 1,
  });
  assert.equal(data.costUsd.value, 9);
  assert.equal(data.costUsd.perAcceptedTask, 9);
  assert.equal(data.timeMs.agent.value, 6000);
  assert.equal(data.timeMs.verification.value, 3000);
  assert.equal(data.timeMs.toAcceptance.median, 30000);
  assert.deepEqual(data.stops, { model_error: 1, timeout: 1 });
});

test('неполная и старая телеметрия явно блокирует полные оценки', () => {
  const legacy = attempt({
    telemetryVersion: undefined,
    outcome: { status: 'success', costUsd: null },
    finishedAt: at(-1),
    completedAt: undefined,
    verifications: undefined,
    verification: { head: 'a'.repeat(40), completedAt: at(3) },
    stops: undefined,
  });
  const result = buildRunReport([
    {
      branch: 'old/phase-1',
      attempts: [
        legacy,
        attempt({ issue: 2, outcome: { status: 'success', costUsd: 5 } }),
      ],
    },
  ]);
  const data = result.current;
  assert.equal(data.costUsd.value, null);
  assert.equal(data.costUsd.knownSubtotal, 5);
  assert.equal(data.costUsd.perAcceptedTask, null);
  assert.equal(data.timeMs.agent.value, null);
  assert.equal(data.timeMs.verification.value, null);
  assert.equal(data.timeMs.verification.unknownHistory, 1);
  assert.equal(data.timeMs.toAcceptance.median, null);
  assert.deepEqual(data.coverage.stopHistory, { known: 1, total: 2 });
  assert.match(formatRunReport(result).join('\n'), /нет полных данных/);
});

test('сравнение считает точные дельты, не объединяет номера разных фаз и отвергает пересечение', () => {
  const current = [
    {
      branch: 'new/phase-1',
      attempts: [
        attempt({
          outcome: { status: 'success', costUsd: 2 },
        }),
      ],
    },
  ];
  const baseline = [
    {
      branch: 'old/phase-1',
      attempts: [
        attempt({
          outcome: { status: 'success', costUsd: 4 },
          completedAt: at(10),
        }),
      ],
    },
  ];
  const report = buildRunReport(current, baseline);
  assert.equal(report.version, 1);
  assert.deepEqual(report.comparison.costPerAcceptedTaskUsd, {
    current: 2,
    baseline: 4,
    delta: -2,
    percent: -50,
  });
  assert.deepEqual(report.comparison.acceptanceMedianMs, {
    current: 5000,
    baseline: 10000,
    delta: -5000,
    percent: -50,
  });
  assert.match(report.comparison.warning, /не A\/B/);
  assert.match(formatRunReport(report).join('\n'), /-50.0 %/);
  assert.equal(summarizeRuns([...current, ...baseline]).tasks.total, 2);
  assert.throws(() => buildRunReport(current, current), /пересекаются/);
});

test('нулевая цена, отсутствие принятых задач и чётная медиана не дают ложных процентов', () => {
  const current = [
    {
      branch: 'current',
      attempts: [
        attempt({
          outcome: { status: 'success', costUsd: 0 },
          completedAt: at(2),
        }),
        attempt({
          issue: 2,
          outcome: { status: 'success', costUsd: 0 },
          completedAt: at(6),
        }),
      ],
    },
  ];
  const empty = summarizeRuns([{ branch: 'empty', attempts: [] }]);
  assert.equal(empty.costUsd.perAcceptedTask, null);
  assert.equal(empty.tasks.firstPassRate, null);
  const baseline = [
    {
      branch: 'baseline',
      attempts: [
        attempt({
          outcome: { status: 'success', costUsd: 0 },
        }),
      ],
    },
  ];
  const result = buildRunReport(current, baseline);
  assert.equal(result.current.timeMs.toAcceptance.median, 4000);
  assert.deepEqual(result.comparison.costPerAcceptedTaskUsd, {
    current: 0,
    baseline: 0,
    delta: 0,
    percent: null,
  });
  const approved = summarizeRuns([
    {
      branch: 'approved',
      attempts: [attempt({ approvedHead: 'a'.repeat(40) })],
    },
  ]);
  assert.equal(approved.tasks.firstPass, 0);
});
