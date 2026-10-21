/**
 * Тесты чистых функций метрик цикла. Запуск: npm run test:tooling.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';

import {
  averageUsage,
  classifyPaths,
  formatReport,
  parseArgs,
  report,
  reviewFixShare,
  transcriptsDir,
  usageOfTranscript,
} from './metrics.js';

const line = (o) => JSON.stringify(o);

test('usageOfTranscript считает каждый ответ модели один раз', () => {
  const usage = {
    cache_read_input_tokens: 1000,
    cache_creation_input_tokens: 100,
    input_tokens: 10,
    output_tokens: 50,
  };
  const text = [
    line({ type: 'user', message: { content: 'задача' } }),
    // один ответ — две строки (текст и вызов инструмента) с тем же usage
    line({ type: 'assistant', message: { id: 'msg_1', usage } }),
    line({ type: 'assistant', message: { id: 'msg_1', usage } }),
    line({ type: 'assistant', message: { content: [] } }),
    line({
      type: 'assistant',
      message: { usage: { cache_read_input_tokens: 2000, output_tokens: 5 } },
    }),
  ].join('\n');
  assert.deepEqual(usageOfTranscript(text), {
    turns: 2,
    context: 3110,
    output: 55,
  });
});

test('отсутствующие или повреждённые данные не становятся нулевой стоимостью', () => {
  for (const text of ['', 'не json', line({ type: 'user' })])
    assert.equal(usageOfTranscript(text), null);
  const lines = report({ sessions: ['test-nonexistent-ralph-session'] });
  assert.ok(
    lines.some((value) => value.includes('Нет данных о токенах: 1 из 1')),
  );
  assert.ok(!lines.some((value) => value.startsWith('- Итерация:')));
  const partial = report({
    attempts: [
      {
        outcome: {
          usage: { turns: 2, context: 100, output: 10 },
          costUsd: 0.5,
        },
      },
      { outcome: { status: 'failed', usage: null, costUsd: 0.25 } },
      { outcome: null },
    ],
  });
  assert.ok(partial.some((value) => value.includes('среднее по 1 сессиям')));
  assert.ok(
    partial.some((value) => value.includes('Нет данных о токенах: 2 из 3')),
  );
  assert.ok(partial.some((value) => value.includes('$0.75; учтено 2 из 3')));
});

test('averageUsage округляет среднее и не делит на ноль', () => {
  assert.deepEqual(averageUsage([]), { turns: 0, context: 0, output: 0 });
  assert.deepEqual(
    averageUsage([
      { turns: 1, context: 10, output: 1 },
      { turns: 2, context: 15, output: 2 },
    ]),
    { turns: 2, context: 13, output: 2 },
  );
});

test('transcriptsDir строит слаг репозитория как Claude Code', () => {
  assert.equal(
    transcriptsDir('/home/marina/jalons'),
    path.join(os.homedir(), '.claude', 'projects', '-home-marina-jalons'),
  );
});

test('classifyPaths отличает тесты от кода и пропускает сгенерированное', () => {
  const byPackage = classifyPaths([
    'apps/api/src/auth/auth.service.ts',
    'apps/api/src/auth/auth.service.spec.ts',
    'apps/api/test/integration/auth.int-spec.ts',
    'apps/api/src/generated/prisma/client.ts',
    'apps/web/src/app/page.tsx',
    'apps/web/tests/pages/home.spec.ts',
    'apps/web/e2e/parcours.spec.ts',
    'packages/contracts/src/enums.ts',
    'apps/api/README.md',
    'docs/plan/x.md',
  ]);
  assert.deepEqual(byPackage['apps/api'], {
    code: ['apps/api/src/auth/auth.service.ts'],
    tests: [
      'apps/api/src/auth/auth.service.spec.ts',
      'apps/api/test/integration/auth.int-spec.ts',
    ],
  });
  assert.deepEqual(byPackage['apps/web'], {
    code: ['apps/web/src/app/page.tsx'],
    tests: [
      'apps/web/tests/pages/home.spec.ts',
      'apps/web/e2e/parcours.spec.ts',
    ],
  });
  assert.deepEqual(byPackage['packages/contracts'], {
    code: ['packages/contracts/src/enums.ts'],
    tests: [],
  });
});

test('reviewFixShare считает PR, где хоть один коммит упоминает ревью', () => {
  assert.deepEqual(
    reviewFixShare([
      { number: 1, commits: ['feat: x', 'fix(web): правки по ревью PR 1'] },
      { number: 2, commits: ['feat: y'] },
      { number: 3, commits: ['fix: review follow-ups'] },
      { number: 4, commits: ['fix(api): гонка в create\n\nПо ревью PR 3: …'] },
    ]),
    { withFixes: 3, total: 4 },
  );
  assert.deepEqual(reviewFixShare([]), { withFixes: 0, total: 0 });
});

test('formatReport печатает только то, что есть', () => {
  assert.deepEqual(
    formatReport({ sessions: 0, ratios: null, review: null }),
    [],
  );
  const lines = formatReport({
    usage: { turns: 120, context: 17_500_000, output: 90_000 },
    sessions: 3,
    ratios: [
      { pkg: 'apps/api', ratio: 1.6 },
      { pkg: 'apps/web', ratio: 1.11 },
    ],
    review: { withFixes: 20, total: 32 },
  });
  assert.deepEqual(lines, [
    '- Итерация: 17.5 млн контекст-токенов, 120 ходов, 0.1 млн на выходе (среднее по 3 сессиям)',
    '- Тесты к коду: api 1.60 · web 1.11',
    '- PR с правками по ревью: 20 из 32',
  ]);
});

test('parseArgs читает сессии и число PR', () => {
  assert.deepEqual(parseArgs(['--sessions', 'a,b', '--prs', '5']), {
    sessions: ['a', 'b'],
    prs: 5,
  });
  assert.deepEqual(parseArgs([]), { sessions: [], prs: 0 });
  assert.deepEqual(parseArgs(['--prs']), { sessions: [], prs: 20 });
  assert.deepEqual(
    parseArgs([
      '--runs',
      'new/phase-1,new/phase-2',
      '--compare',
      'old/phase-1',
      '--json',
    ]),
    {
      sessions: [],
      prs: 0,
      runs: ['new/phase-1', 'new/phase-2'],
      compare: ['old/phase-1'],
      json: true,
    },
  );
  for (const args of [
    ['--runs'],
    ['--compare', 'base'],
    ['--json'],
    ['--runs', 'a,,b'],
    ['--runs', 'a', '--list-runs'],
    ['--runs', 'a', '--prs'],
    ['--prs', 'zero'],
    ['--json', '--json'],
    ['--unknown'],
  ])
    assert.throws(() => parseArgs(args), Error);
});
