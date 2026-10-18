#!/usr/bin/env node
/**
 * Метрики цикла — три числа, по которым судят изменения харнеса: стоимость
 * итерации, доля PR с правками по ревью, строки тестов на строку кода.
 *
 * Запуск: node .claude/metrics.js [--sessions <id,id,…>] [--prs <N>]
 *   --sessions — транскрипты сессий Ralph (id задаёт сам цикл);
 *   --prs      — сколько последних смерженных PR считать (по умолчанию 20).
 * Локальные выборки --runs/--compare — docs/research/harness-v2.md.
 * Без флагов — только отношение тестов к коду.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  buildRunReport,
  formatRunReport,
  listRuns,
  loadRuns,
} from './run-report.js';

const ROOT = path.resolve(import.meta.dirname, '..');

// ─── стоимость сессии ─────────────────────────────────────────────────────────

/** Каталог транскриптов Claude Code для репозитория: путь, где не-буквы → «-». */
function transcriptsDir(root = ROOT) {
  return path.join(
    os.homedir(),
    '.claude',
    'projects',
    root.replace(/[^A-Za-z0-9]/g, '-'),
  );
}

const EMPTY_USAGE = { turns: 0, context: 0, output: 0 };

/**
 * Сумма по транскрипту (jsonl): ходы ассистента, контекст на входе каждого
 * хода (кеш и новое — это то, что платится каждый ход) и выход.
 *
 * Один ответ модели записан несколькими строками `assistant` — по одной на
 * блок текста и на каждый вызов инструмента, и в каждой тот же `usage`;
 * считается первая строка каждого `message.id`.
 */
function usageOfTranscript(text) {
  const sum = { ...EMPTY_USAGE };
  const counted = new Set();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      return null;
    }
    const usage = entry.type === 'assistant' && entry.message?.usage;
    if (!usage) continue;
    const id = entry.message.id;
    if (id) {
      if (counted.has(id)) continue;
      counted.add(id);
    }
    sum.turns++;
    sum.context +=
      (usage.cache_read_input_tokens || 0) +
      (usage.cache_creation_input_tokens || 0) +
      (usage.input_tokens || 0);
    sum.output += usage.output_tokens || 0;
  }
  return sum.turns ? sum : null;
}

function addUsage(a, b) {
  return {
    turns: a.turns + b.turns,
    context: a.context + b.context,
    output: a.output + b.output,
  };
}

/** Транскрипты сессии: её собственный и всех её субагентов (`<dir>/<id>/`). */
function sessionTranscripts(dir, id) {
  const files = [path.join(dir, `${id}.jsonl`)];
  const subagents = path.join(dir, id);
  if (fs.existsSync(subagents))
    for (const f of fs.readdirSync(subagents, { recursive: true }))
      if (f.endsWith('.jsonl')) files.push(path.join(subagents, f));
  return files.filter((f) => fs.existsSync(f));
}

function sessionUsage(dir, id) {
  if (!fs.existsSync(path.join(dir, `${id}.jsonl`))) return null;
  const usages = sessionTranscripts(dir, id).map((f) =>
    usageOfTranscript(fs.readFileSync(f, 'utf8')),
  );
  return usages.includes(null) ? null : usages.reduce(addUsage, EMPTY_USAGE);
}

function averageUsage(usages) {
  if (usages.length === 0) return { ...EMPTY_USAGE };
  const total = usages.reduce(addUsage, EMPTY_USAGE);
  return {
    turns: Math.round(total.turns / usages.length),
    context: Math.round(total.context / usages.length),
    output: Math.round(total.output / usages.length),
  };
}

// ─── тесты к коду ─────────────────────────────────────────────────────────────

const PACKAGES = ['apps/api', 'apps/web', 'packages/contracts'];

function classifyPaths(paths) {
  const byPackage = Object.fromEntries(
    PACKAGES.map((p) => [p, { code: [], tests: [] }]),
  );
  for (const p of paths) {
    const pkg = PACKAGES.find((name) => p.startsWith(`${name}/`));
    if (!pkg || !/\.(ts|tsx)$/.test(p) || p.includes('/generated/')) continue;
    const isTest =
      /\.(int-)?spec\.tsx?$/.test(p) || /\/(test|tests|e2e)\//.test(p);
    byPackage[pkg][isTest ? 'tests' : 'code'].push(p);
  }
  return byPackage;
}

function countLines(root, files) {
  return files.reduce(
    (n, f) =>
      n + fs.readFileSync(path.join(root, f), 'utf8').split('\n').length,
    0,
  );
}

function testCodeRatio(root = ROOT) {
  const tracked = execFileSync('git', ['ls-files', '--', ...PACKAGES], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\n')
    .filter(Boolean);
  return Object.entries(classifyPaths(tracked)).map(([pkg, files]) => {
    const code = countLines(root, files.code);
    const tests = countLines(root, files.tests);
    return { pkg, code, tests, ratio: code ? tests / code : 0 };
  });
}

// ─── правки по ревью ──────────────────────────────────────────────────────────

const REVIEW_FIX = /ревью|review/i;

/**
 * PR считается правленым, если хоть один его коммит упоминает ревью —
 * в заголовке или в теле: «правки по ревью» часто уходят в тело под
 * обычным `fix(...)`.
 */
function reviewFixShare(prs) {
  const withFixes = prs.filter((pr) =>
    pr.commits.some((message) => REVIEW_FIX.test(message)),
  ).length;
  return { withFixes, total: prs.length };
}

function mergedPullRequests(limit) {
  const gh = (args) => execFileSync('gh', args, { encoding: 'utf8' });
  const list = JSON.parse(
    gh([
      'pr',
      'list',
      '--state',
      'merged',
      '--limit',
      String(limit),
      '--json',
      'number',
    ]),
  );
  return list.map(({ number }) => ({
    number,
    commits: JSON.parse(
      gh(['pr', 'view', String(number), '--json', 'commits']),
    ).commits.map((c) => `${c.messageHeadline}\n${c.messageBody || ''}`),
  }));
}

// ─── отчёт ────────────────────────────────────────────────────────────────────

const millions = (n) => `${(n / 1e6).toFixed(1)} млн`;

/** Строки для тела PR и для консоли — один формат. */
function formatReport({ usage, sessions, missing = 0, costs, ratios, review }) {
  const lines = [];
  if (usage && sessions > 0)
    lines.push(
      `- Итерация: ${millions(usage.context)} контекст-токенов, ` +
        `${usage.turns} ходов, ${millions(usage.output)} на выходе ` +
        `(среднее по ${sessions} сессиям)`,
    );
  if (missing)
    lines.push(
      `- Нет данных о токенах: ${missing} из ${sessions + missing} сессий`,
    );
  if (costs?.length) {
    const known = costs.filter((cost) => cost !== null);
    lines.push(
      `- Стоимость попыток (оценка CLI): ` +
        (known.length
          ? `$${known.reduce((sum, cost) => sum + cost, 0).toFixed(2)}`
          : 'нет данных') +
        `; учтено ${known.length} из ${costs.length} сессий`,
    );
  }
  if (ratios)
    lines.push(
      `- Тесты к коду: ` +
        ratios
          .map(({ pkg, ratio }) => `${pkg.split('/')[1]} ${ratio.toFixed(2)}`)
          .join(' · '),
    );
  if (review)
    lines.push(
      `- PR с правками по ревью: ${review.withFixes} из ${review.total}`,
    );
  return lines;
}

function parseArgs(argv) {
  const args = { sessions: [], prs: 0 };
  const seen = new Set();
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (seen.has(flag)) throw new Error(`Повторён аргумент ${flag}`);
    seen.add(flag);
    if (flag === '--json') args.json = true;
    else if (flag === '--list-runs') args.listRuns = true;
    else if (flag === '--prs') {
      const value = argv[i + 1];
      args.prs = !value || value.startsWith('--') ? 20 : Number(argv[++i]);
      if (!Number.isInteger(args.prs) || args.prs < 1)
        throw new Error('--prs требует положительное целое число');
    } else if (['--sessions', '--runs', '--compare'].includes(flag)) {
      const value = argv[++i];
      if (
        !value ||
        value.startsWith('--') ||
        value.split(',').some((v) => !v.trim())
      )
        throw new Error(`${flag} требует непустой список через запятую`);
      args[flag.slice(2)] = value.split(',').map((v) => v.trim());
    } else throw new Error(`Неизвестный аргумент ${flag}`);
  }
  if (args.compare && !args.runs)
    throw new Error('--compare требует текущую выборку --runs');
  if (args.json && !args.runs && !args.listRuns)
    throw new Error('--json используется с --runs или --list-runs');
  if (
    (args.runs || args.listRuns) &&
    (args.sessions.length || args.prs || (args.runs && args.listRuns))
  )
    throw new Error(
      'Журналы --runs/--list-runs не смешиваются с --sessions/--prs или друг с другом',
    );
  return args;
}

/** Строки отчёта: для консоли и для тела PR фазы (`ralph.js`). */
function report({ sessions = [], attempts, prs = 0, root = ROOT }) {
  const dir = transcriptsDir(root);
  const usages = attempts
    ? attempts.map((attempt) => attempt.outcome?.usage ?? null)
    : sessions.map((id) => sessionUsage(dir, id));
  const known = usages.filter((usage) => usage !== null);
  return formatReport({
    usage: averageUsage(known),
    sessions: known.length,
    missing: usages.length - known.length,
    costs: attempts?.map((attempt) => attempt.outcome?.costUsd ?? null),
    ratios: testCodeRatio(root),
    review: prs ? reviewFixShare(mergedPullRequests(prs)) : null,
  });
}

if (import.meta.main) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.listRuns) {
      const runs = listRuns(ROOT).map((run) => ({
        branch: run.branch,
        attempts: run.attempts.length,
      }));
      console.log(
        args.json
          ? JSON.stringify({ version: 1, runs }, null, 2)
          : runs
              .map((run) => `${run.branch}: ${run.attempts} попыток`)
              .join('\n') || 'Нет сохранённых журналов Ralph',
      );
    } else if (args.runs) {
      const result = buildRunReport(
        loadRuns(ROOT, args.runs),
        args.compare ? loadRuns(ROOT, args.compare) : undefined,
      );
      console.log(
        args.json
          ? JSON.stringify(result, null, 2)
          : formatRunReport(result).join('\n'),
      );
    } else console.log(report(args).join('\n'));
  } catch (error) {
    console.error(`Метрики: ${error.message}`);
    process.exitCode = 1;
  }
}

export {
  averageUsage,
  classifyPaths,
  formatReport,
  parseArgs,
  report,
  reviewFixShare,
  transcriptsDir,
  usageOfTranscript,
};
