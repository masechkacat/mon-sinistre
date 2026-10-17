#!/usr/bin/env node
/**
 * Метрики цикла — три числа, по которым судят изменения харнеса: стоимость
 * итерации, доля PR с правками по ревью, строки тестов на строку кода.
 *
 * Запуск: node .claude/metrics.js [--sessions <id,id,…>] [--prs <N>]
 *   --sessions — транскрипты сессий Ralph (id задаёт сам цикл);
 *   --prs      — сколько последних смерженных PR считать (по умолчанию 20).
 * Без флагов — только отношение тестов к коду.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

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
    } catch {
      continue;
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
  return sum;
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
  return sessionTranscripts(dir, id)
    .map((f) => usageOfTranscript(fs.readFileSync(f, 'utf8')))
    .reduce(addUsage, EMPTY_USAGE);
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
function formatReport({ usage, sessions, ratios, review }) {
  const lines = [];
  if (usage && sessions > 0)
    lines.push(
      `- Итерация: ${millions(usage.context)} контекст-токенов, ` +
        `${usage.turns} ходов, ${millions(usage.output)} на выходе ` +
        `(среднее по ${sessions} сессиям)`,
    );
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
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sessions')
      args.sessions = (argv[++i] || '').split(',').filter(Boolean);
    else if (argv[i] === '--prs') args.prs = Number(argv[++i]) || 20;
  }
  return args;
}

/** Строки отчёта: для консоли и для тела PR фазы (`ralph.js`). */
function report({ sessions = [], prs = 0, root = ROOT }) {
  const dir = transcriptsDir(root);
  const usages = sessions.map((id) => sessionUsage(dir, id));
  return formatReport({
    usage: averageUsage(usages),
    sessions: usages.length,
    ratios: testCodeRatio(root),
    review: prs ? reviewFixShare(mergedPullRequests(prs)) : null,
  });
}

if (import.meta.main)
  console.log(report(parseArgs(process.argv.slice(2))).join('\n'));

export {
  averageUsage,
  classifyPaths,
  formatReport,
  parseArgs,
  report,
  reviewFixShare,
  sessionUsage,
  testCodeRatio,
  transcriptsDir,
  usageOfTranscript,
};
