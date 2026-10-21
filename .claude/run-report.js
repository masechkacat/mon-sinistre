import fs from 'node:fs';
import path from 'node:path';
import {
  isFinished,
  readState,
  stateDirectory,
  statePath,
  verificationRuns,
} from './ralph-state.js';

function listRuns(root) {
  const folder = stateDirectory(root);
  let files;
  try {
    files = fs.readdirSync(folder);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    return [];
  }
  const runs = files
    .filter((file) => file.endsWith('.json'))
    .map((file) => readState(path.join(folder, file)))
    .sort((a, b) => a.branch.localeCompare(b.branch));
  if (new Set(runs.map((run) => run.branch)).size !== runs.length)
    throw new Error(
      'Несколько журналов содержат одну ветку — выборка неоднозначна',
    );
  return runs;
}

function loadRuns(root, selection) {
  if (selection.length === 1 && selection[0] === 'all') {
    const runs = listRuns(root);
    if (!runs.length) throw new Error('Нет сохранённых журналов Ralph');
    return runs;
  }
  if (selection.includes('all') || new Set(selection).size !== selection.length)
    throw new Error('Выборка должна содержать разные ветки либо только all');
  return selection.map((branch) => {
    const file = statePath(root, branch);
    const state = readState(file);
    if (state.branch !== branch)
      throw new Error(`В журнале ${file} записана другая ветка`);
    return state;
  });
}

const numeric = (value) =>
  Number.isFinite(value) && value >= 0 ? value : null;
const sum = (values) => values.reduce((total, value) => total + value, 0);

function duration(start, end) {
  if (typeof start !== 'string' || typeof end !== 'string') return null;
  return numeric(Date.parse(end) - Date.parse(start));
}

function measurement(values, unknownHistory = 0) {
  const known = values.map(numeric).filter((value) => value !== null);
  return {
    value:
      known.length === values.length && unknownHistory === 0
        ? sum(known)
        : null,
    knownSubtotal: sum(known),
    known: known.length,
    total: values.length,
    unknownHistory,
  };
}

function median(values) {
  if (!values.length || values.some((value) => value === null)) return null;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2
    ? ordered[middle]
    : (ordered[middle - 1] + ordered[middle]) / 2;
}

function summarizeRuns(runs) {
  const tasks = new Map();
  for (const run of runs) {
    for (const attempt of run.attempts) {
      const key = JSON.stringify([run.branch, attempt.issue]);
      if (!tasks.has(key)) tasks.set(key, []);
      tasks.get(key).push(attempt);
    }
  }
  const attempts = runs.flatMap((run) => run.attempts);
  const accepted = [...tasks.values()].filter((group) =>
    group.some((attempt) => attempt.stage === 'complete'),
  );
  const firstPass = accepted.filter(
    (group) =>
      group.length === 1 &&
      group[0].outcome?.status === 'success' &&
      !group[0].approvedHead,
  ).length;
  const cost = measurement(attempts.map((a) => a.outcome?.costUsd));
  const leadTimes = accepted.map((group) =>
    duration(
      group[0].startedAt,
      group.findLast((a) => a.stage === 'complete').completedAt,
    ),
  );
  const legacy = attempts.filter((a) => a.telemetryVersion !== 2).length;
  const phaseChecks = runs.flatMap((run) => run.verifications || []);
  const checks = [...attempts.flatMap(verificationRuns), ...phaseChecks];
  const stops = {};
  for (const stop of attempts.flatMap((a) => a.stops || []))
    stops[stop.kind] = (stops[stop.kind] || 0) + 1;
  const phaseFailures = phaseChecks.filter((c) => c.status === 'failed').length;
  if (phaseFailures)
    stops.verification = (stops.verification || 0) + phaseFailures;
  return {
    branches: runs.map((run) => run.branch),
    models: [...new Set(attempts.map((a) => a.model).filter(Boolean))].sort(),
    runnerRevisions: [
      ...new Set(attempts.map((a) => a.runnerRevision).filter(Boolean)),
    ].sort(),
    tasks: {
      total: tasks.size,
      accepted: accepted.length,
      firstPass,
      firstPassRate: tasks.size ? firstPass / tasks.size : null,
    },
    attempts: {
      total: attempts.length,
      pending: attempts.filter((a) => !isFinished(a)).length,
      modelFailures: attempts.filter((a) => a.outcome?.status === 'failed')
        .length,
      noCommit: attempts.filter((a) => a.stage === 'no_commit').length,
    },
    costUsd: {
      ...cost,
      perAcceptedTask:
        cost.value !== null && accepted.length
          ? cost.value / accepted.length
          : null,
    },
    timeMs: {
      agent: measurement(
        attempts.map((a) => duration(a.startedAt, a.finishedAt)),
      ),
      verification: measurement(
        checks.map((c) => duration(c.startedAt, c.completedAt)),
        legacy,
      ),
      toAcceptance: {
        median: median(leadTimes),
        known: leadTimes.filter((value) => value !== null).length,
        total: leadTimes.length,
      },
    },
    stops,
    coverage: {
      stopHistory: { known: attempts.length - legacy, total: attempts.length },
      usage: {
        known: attempts.filter((a) => a.outcome?.usage).length,
        total: attempts.length,
      },
    },
  };
}

function difference(current, baseline) {
  const delta =
    current !== null && baseline !== null ? current - baseline : null;
  return {
    current,
    baseline,
    delta,
    percent: delta !== null && baseline !== 0 ? (delta / baseline) * 100 : null,
  };
}

function buildRunReport(currentRuns, baselineRuns) {
  if (
    baselineRuns?.some((base) =>
      currentRuns.some((current) => current.branch === base.branch),
    )
  )
    throw new Error(
      'Выборки пересекаются: одна ветка не может быть по обе стороны сравнения',
    );
  const current = summarizeRuns(currentRuns);
  const baseline = baselineRuns ? summarizeRuns(baselineRuns) : null;
  return {
    version: 1,
    current,
    baseline,
    comparison: baseline
      ? {
          costPerAcceptedTaskUsd: difference(
            current.costUsd.perAcceptedTask,
            baseline.costUsd.perAcceptedTask,
          ),
          firstPassRate: difference(
            current.tasks.firstPassRate,
            baseline.tasks.firstPassRate,
          ),
          acceptanceMedianMs: difference(
            current.timeMs.toAcceptance.median,
            baseline.timeMs.toAcceptance.median,
          ),
          warning:
            'Сравнение описательное, не A/B: сложность задач, модели и окружение могут различаться.',
        }
      : null,
  };
}

const money = (value) =>
  value === null ? 'нет полных данных' : `$${value.toFixed(2)}`;
const seconds = (value) =>
  value === null ? 'нет полных данных' : `${(value / 1000).toFixed(1)} с`;
const coverage = (value) => `${value.known}/${value.total}`;

function formatRunReport(report) {
  const lines = [];
  for (const [label, data] of [
    ['Текущая выборка', report.current],
    ['База', report.baseline],
  ]) {
    if (!data) continue;
    lines.push(
      `## ${label}: ${data.branches.join(', ')}`,
      `- Задачи: принято оркестратором ${data.tasks.accepted}/${data.tasks.total}; одной успешной попыткой модели ${data.tasks.firstPass}/${data.tasks.total}`,
      `- Попытки: ${data.attempts.total}; незавершённых ${data.attempts.pending}; ошибок модели/процесса ${data.attempts.modelFailures}`,
      `- Расход попыток реализации (оценка CLI): ${money(data.costUsd.value)}; известная часть ${money(data.costUsd.knownSubtotal)} (${coverage(data.costUsd)})`,
      `- Расход попыток / принятая задача: ${money(data.costUsd.perAcceptedTask)}`,
      `- Время агента: ${seconds(data.timeMs.agent.value)} (${coverage(data.timeMs.agent)})`,
      `- Время приёмки: ${seconds(data.timeMs.verification.value)} (${coverage(data.timeMs.verification)} запусков; неизвестная история у ${data.timeMs.verification.unknownHistory} попыток)`,
      `- До принятия, медиана с ожиданиями: ${seconds(data.timeMs.toAcceptance.median)} (${coverage(data.timeMs.toAcceptance)})`,
      `- Записанные остановки: ${
        Object.entries(data.stops)
          .map(([kind, count]) => `${kind}=${count}`)
          .join(', ') || 'нет записей'
      }; полнота истории ${coverage(data.coverage.stopHistory)}`,
      `- Usage: ${coverage(data.coverage.usage)}; модели: ${data.models.join(', ') || 'не записаны'}`,
      `- Ревизии харнесса: ${data.runnerRevisions.map((revision) => revision.slice(0, 8)).join(', ') || 'не записаны'}`,
    );
  }
  if (report.comparison) {
    lines.push('## Изменение относительно базы');
    for (const [label, value, format] of [
      [
        'Стоимость принятой задачи',
        report.comparison.costPerAcceptedTaskUsd,
        money,
      ],
      [
        'Доля принятия одной попыткой',
        report.comparison.firstPassRate,
        (value) => `${(value * 100).toFixed(1)} п.п.`,
      ],
      ['Медиана до принятия', report.comparison.acceptanceMedianMs, seconds],
    ]) {
      lines.push(
        `- ${label}: ${value.delta === null ? 'нет данных' : format(value.delta)}; ` +
          (value.percent === null
            ? 'процент не определён'
            : `${value.percent.toFixed(1)} %`),
      );
    }
    lines.push(report.comparison.warning);
  }
  return lines;
}

export { buildRunReport, formatRunReport, listRuns, loadRuns, summarizeRuns };
