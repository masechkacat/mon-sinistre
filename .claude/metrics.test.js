'use strict';

/**
 * Тесты чистых функций метрик цикла. Запуск: npm run test:tooling.
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const {
  averageUsage,
  classifyPaths,
  formatReport,
  parseArgs,
  reviewFixShare,
  transcriptsDir,
  usageOfTranscript,
} = require('./metrics');

const line = (o) => JSON.stringify(o);

test('usageOfTranscript суммирует только ходы ассистента с usage', () => {
  const text = [
    line({ type: 'user', message: { content: 'задача' } }),
    line({
      type: 'assistant',
      message: {
        usage: {
          cache_read_input_tokens: 1000,
          cache_creation_input_tokens: 100,
          input_tokens: 10,
          output_tokens: 50,
        },
      },
    }),
    line({ type: 'assistant', message: { content: [] } }),
    'не json',
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
    path.join(
      require('node:os').homedir(),
      '.claude',
      'projects',
      '-home-marina-jalons',
    ),
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
});
