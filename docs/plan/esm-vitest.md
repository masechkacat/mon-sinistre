# Plan: ESM и Vitest в API

**PRD**: нет — техническая миграция, требования и инвентаризация в research.
**Research**: docs/research/esm-vitest.md (13.10.2026). Решения (ESM в api и
contracts, `.js` в импортах при сохранении алиасов, Vitest 5 на Vite 8 без
swc-плагина, tsx вместо ts-node) приняты там; задачи ниже их применяют.
Отступления фиксируются врезкой «Исправлено при реализации» в отчёте.
**Дата**: 2026-10-13

Одна фаза, один PR, ветка `esm-vitest/phase-1` от свежего `origin/main`.
Делается в сессии с человеком, не Ralph: правятся конфиги всего
приложения. Коммит на задачу — так codemod расширений (сотни файлов строками
импортов) ревьюится отдельно от правок руками. Новые зависимости — `vitest`,
`@vitest/coverage-v8`, `tsx`; переменных окружения нет; dev-база для
задач 2–3 поднята (`npm run db:up`).

## Фаза 1: Тесты и сборка API на ESM

**Цель:** `npm test`, `npm run test:int`, `npm run build`, `npm run seed` и
сквозной `npm run test:e2e` проходят без `--experimental-vm-modules`, без
Jest и без ts-node; API собирается и запускается как ESM.
**Затрагивает:** api, contracts, корневой `CLAUDE.md`, `apps/web`
(только команда сева в `playwright.e2e.config.ts`)
**Задачи:**

- [ ] Раннер при ещё CommonJS-сборке: `vitest.config.ts` и
      `vitest.config.int.ts` по research (`sequence.hooks: 'list'`,
      `restoreMocks`, `resolve.tsconfigPaths`, alias contracts → `src`,
      `fileParallelism: false` у int); пять `test/setup/*.js` → `.ts` ESM,
      `globalSetup` с экспортом `setup`; `jest.*` → `vi`/`Mock`/`MockInstance`
      в 19 файлах, `__dirname` → `import.meta.dirname` в двух;
      `types: ["node", "vitest/globals"]`, `globals.vitest` и
      `sourceType: 'module'` в eslint; скрипты `test*` без `NODE_OPTIONS`;
      `jest`, `ts-jest`, `@types/jest`, `jest.int.config.js` удалены.
      **Проверяется (до смены формата):** `npm test` — 57 сьютов, 910
      тестов зелёные; `npm run test:int` — 45 сьютов зелёные;
      `grep -rn "jest" apps/api --include='*.ts' --include='*.mjs' --include='*.json'`
      пуст; упавший из-за `clearMocks` тест чинится в этом же коммите с
      названием причины.
- [ ] Формат: `"type": "module"` в `apps/api/package.json` и
      `packages/contracts/package.json`; codemod `.js` в относительных и
      алиасных импортах `apps/api/{src,test,scripts,prisma}` и
      `packages/contracts/src` (скрипт одноразовый, в репозиторий не идёт);
      `importFileExtension = "js"` в `schema.prisma` без комментария про
      jest; `start:prod: node dist/main.js`.
      **Проверяется:** `npx prisma validate` и `prisma generate` проходят;
      `npm run lint` (в нём `tsc --noEmit`) без TS2835; `npm run build`
      собирает contracts и api, `node apps/api/dist/main.js` отвечает на
      `GET /docs`; `npm run dev:api` поднимается в watch; `npm test` и
      `npm run test:int` зелёные второй раз — уже под ESM.
- [ ] Скрипты вне Nest: `tsx` в devDependencies api; `seed: 'tsx prisma/seed.ts'`
      в `prisma.config.ts`, `backfill:jorf: tsx scripts/jorf-backfill.ts`,
      `npx tsx scripts/e2e-seed.ts` в `playwright.e2e.config.ts`; `ts-node`
      и `tsconfig-paths` удалены из `package.json` и из комментариев
      `prisma.config.ts`.
      **Проверяется:** `npm run seed` на dev-базе отрабатывает и повторный
      запуск ничего не меняет; `npm run test:e2e` зелёный (сев `_e2e` через
      tsx, API через `npm run start`); `npm ls ts-node tsconfig-paths` — пусто.
- [ ] Документация и baseline тем же PR: корневой `CLAUDE.md` («eslint и
      jest его не видят» → vitest), `apps/api/CLAUDE.md` («Команды» —
      alias Vitest и Oxc вместо ts-jest, абзац-ссылка на research
      убирается; «Интеграционные тесты» — `int.*.ts`, `VITEST_POOL_ID`,
      «оба конфига Vitest»), `apps/api/src/prisma/CLAUDE.md` (строка про
      ts-node), врезка в `docs/research/commune-referential.md` про замену
      jest-конфига; `npm run dup:baseline` только если `dup` упал на
      сдвинувшихся строках импортов.
      **Проверяется:** `grep -rn "jest\|ts-node\|tsconfig-paths" CLAUDE.md apps/*/CLAUDE.md apps/api/src/*/CLAUDE.md`
      пуст; `npm run dup` зелёный; `git diff --stat main -- '*.md'` в теле
      PR с объяснением баланса.

**Когда готова:** pre-commit хук зелёный на последнем коммите;
`grep -rn "experimental-vm-modules" --include=package.json --include='*.js' --include='*.ts' .`
(без `node_modules`) пуст; `npm run build && node apps/api/dist/main.js`
отвечает; `npm run test:e2e` зелёный; `/code-review <N> --comment` по PR,
отложенные находки остаются в PR; `node .claude/metrics.js` печатает
тесты к коду не выше базы 1,56 для api.
