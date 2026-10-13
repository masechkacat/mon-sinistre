# Research: ESM и Vitest в API

**PRD**: нет — техническая миграция без продуктовых требований; план фаз
пишется после этого отчёта.
**Дата**: 2026-10-13

## Откуда вопрос

Nest 12 (`@nestjs/*` 12.1.2, коммит d2e6b6a) поставляется только как ESM.
Наш API по-прежнему собирается в CommonJS: у `apps/api/package.json` нет
поля `type`, и tsc при `module: nodenext` эмитит `require`. Работает это
через `require(esm)` Node ≥ 22.12, а Jest ради этого запускается под
`--experimental-vm-modules` — его ESM-режим экспериментален, потому что
стоит на `vm.SourceTextModule`, который Node не стабилизировал. Nest 12
ответил на это не ожиданием, а сменой раннера: `nest new` по умолчанию
создаёт ESM-проект с Vitest, Jest остаётся только у CommonJS-проектов
(шаблон `@nestjs/schematics` 12.0.6, `files/ts-esm/`).

Инвентаризация 13.10 (`apps/api`, `packages/contracts`):

| Что                                          | Сколько                                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------------------------- |
| Относительные импорты без расширения         | 235 в api (+34 в `generated/`), 8 в contracts                                           |
| Импорты по алиасам `src/*`, `test/*`         | 663                                                                                     |
| Файлов с такими импортами (без `generated/`) | 225                                                                                     |
| Спеков                                       | 57 unit (910 тестов), 45 int                                                            |
| Файлов с `jest.*`                            | 19 (`fn` 33, `spyOn` 9, `Mock` 8, `SpyInstance`/`SpiedFunction` 5, `restoreAllMocks` 2) |
| `__dirname` в тестах                         | 2                                                                                       |
| CommonJS-обвязка                             | 5 файлов `test/setup/*.js`, `jest.int.config.js`                                        |
| `ts-node -r tsconfig-paths/register`         | seed, `backfill:jorf`, e2e-seed в `playwright.e2e.config.ts`                            |

`supertest` не используется (интеграционные тесты — `app.inject`),
`jest.mock`/фейковые таймеры/`done`-колбэки — нет, `@jest/globals` — нет:
все спеки работают на глобальных `describe`/`it`/`expect`.

## Решения

### Формат модулей: `"type": "module"` в `apps/api` и `packages/contracts`

**Решение:** оба пакета объявляются ESM; tsconfig не меняется (`nodenext`
уже стоит, этого Nest-гайд называет достаточным). `apps/web` не трогаем —
Next собирает его бандлером, и ESM-`dist` contracts он берёт через тот же
`transpilePackages`.
**Почему:** фреймворк уже ESM, Node 24.21 выше всех порогов (Nest: 22.12+;
Vite 8: 22.12+; Vitest 5: 22.12+), а прослойка `require(esm)` и флаг Jest —
единственное, что держит два формата в одном репозитории (`.claude/` и
скрипты web уже ESM).
**Отброшено:** остаться на CommonJS — Nest это разрешает «бессрочно», но
флаг и экспериментальное предупреждение в каждом прогоне остаются
навсегда; расширения `.mts` вместо поля `type` — те же правки плюс
переименование всех файлов.

### Расширение `.js` во всех относительных и алиасных импортах

**Решение:** одноразовый codemod дописывает `.js` к каждому
`from './x'`, `from 'src/x'`, `from 'test/x'` в `apps/api/{src,test,scripts,prisma}`
и `packages/contracts/src`; скрипт в репозиторий не попадает. Алиасы
`src/*` и `test/*` остаются.
**Почему:** под `nodenext` ESM-файл обязан называть эмитируемый файл, и
через `paths` тоже. `nest build` алиасы переписывает: хук
`@nestjs/cli/lib/compiler/hooks/tsconfig-paths.hook.js` в 12.0.8 различает
ESM (`requiresExplicitImportExtensions`) и подставляет относительный путь с
расширением после эмита — проверено по исходнику.
**Отброшено:** `rewriteRelativeImportExtensions` (TS 5.7+) — переписывает
только относительные пути, 663 алиасных не покрывает; замена алиасов на
`../..` — против правила `apps/api/CLAUDE.md` «относительных путей наверх
нет»; subpath imports `#src/*` — те же 663 правки без выигрыша против хука.
**Как применять:** после codemod — `npx tsc --noEmit -p apps/api`: каждый
пропущенный импорт даёт TS2835 с точным местом; ошибок не должно остаться
до первого запуска тестов.

### Prisma: `importFileExtension = "js"`

**Решение:** в `generator client` заменить `importFileExtension = ""` на
`"js"`; `moduleFormat` не задавать — выводится из `"type": "module"`
(документация Prisma 7: «inferred from environment»).
**Почему:** пустое расширение стояло ради резолвера Jest; tsc под ESM
такие импорты отвергнет (34 штуки в `generated/`). Vite резолвит `./x.js`
в `./x.ts` — шаблон Nest 12 так и импортирует в спеках (`'./app.service.js'`).
Комментарий в `schema.prisma` про jest удаляется вместе с причиной.

### Раннер: Vitest 5.0.4 на Vite 8.3.4, без swc-плагина

**Решение:** Jest 30, ts-jest, `@types/jest` удаляются; ставятся `vitest`
и `@vitest/coverage-v8` (для `test:cov`). Два конфига зеркалом нынешних:

- `vitest.config.ts`: `include: ['src/**/*.spec.ts']`, `globals: true`,
  `restoreMocks: true`, `sequence.hooks: 'list'`, `setupFiles` с
  `import 'reflect-metadata'`, `resolve.tsconfigPaths: true`,
  `resolve.alias` `@mon-sinistre/contracts` → `../../packages/contracts/src`
  (как `moduleNameMapper` сейчас: тестам собранный contracts не нужен);
- `vitest.config.int.ts`: `include: ['test/**/*.int-spec.ts']`,
  `globalSetup: 'test/setup/int.global-setup.ts'` (экспорт `setup`),
  `setupFiles: ['test/setup/int.env.ts']`, `fileParallelism: false`
  (равносильно `maxWorkers: 1`), остальное общее.

Скрипты: `test: vitest run`, `test:int: vitest run --config vitest.config.int.ts`,
`test:watch: vitest`, `test:cov: vitest run --coverage`; `NODE_OPTIONS`
уходит. `tsconfig.json`: `types: ["node", "vitest/globals"]`;
`eslint.config.mjs`: `globals.vitest` вместо `globals.jest`,
`sourceType: 'module'`.

Замены в 19 файлах: `jest.fn` → `vi.fn`, `jest.spyOn` → `vi.spyOn`,
`jest.restoreAllMocks` → `vi.restoreAllMocks`, типы `jest.Mock` → `Mock`,
`jest.SpyInstance`/`jest.SpiedFunction` → `MockInstance`; `vi`, `Mock`,
`MockInstance` импортируются из `'vitest'` явно — глобальными остаются
только `describe`/`it`/`expect`/хуки, как в шаблоне Nest. `__dirname` в
двух спеках → `import.meta.dirname`. Пять `test/setup/*.js` переписываются
в `.ts` ESM (Vitest, tsx и Playwright читают TS сами; `playwright.e2e.config.ts`
импортирует `e2e-db-name` оттуда же).

**Почему:** `@nestjs/testing` от раннера не зависит; Vitest — ESM-родной,
без флагов, и это выбор самого Nest 12. Vite 8 встроил
`emitDecoratorMetadata` (анонс Vite 8; шаблон Nest 12 ESM обходится без
плагинов). Oxc эмитит метаданные без информации о типах — ровно как
ts-jest под `isolatedModules` сегодня (`apps/api/CLAUDE.md`, «Команды»), то
есть DI уже живёт в этих условиях, и 910 тестов это подтверждают.
`resolve.tsconfigPaths` в Vite 8 читает `paths` из tsconfig — плагин для
алиасов не нужен. `sequence.hooks: 'list'` сохраняет порядок хуков Jest
(у Vitest по умолчанию `after*` идут в обратном порядке) — миграция не
должна менять семантику ни одного теста.
**WARM:** `vitest` 5.0.4 — нужен весь раннер; релиз 12.10.2026; 2,8 МБ,
13 поддепов, `vite` ^8 peer; advisories deps.dev — нет.
`@vitest/coverage-v8` 5.0.4 — только ради `test:cov`; 30 КБ; advisories —
нет. `vite` 8.3.4 ставится как peer; релиз 08.10.2026; advisories — нет.
**Отброшено:** `unplugin-swc` + `@swc/core` (рецепт docs.nestjs.com/recipes/swc
написан до Vite 8; нативный бинарь 134 КБ ради того, что Vite делает сам);
`vite-tsconfig-paths` (в шаблоне Nest, но Vite 8 умеет `resolve.tsconfigPaths`);
Jest в ESM-режиме (флаг и экспериментальный статус навсегда); `node --test`
(без транспилера с метаданными декораторов DI Nest не работает, а
`tsx`/esbuild метаданные не эмитят).
**Как применять:** порядок внутри фазы — сначала раннер при ещё
CommonJS-сборке (Vitest собирает TS и для CJS-проектов; зелёный прогон до
смены формата отделяет ошибки раннера от ошибок ESM), затем `"type": "module"`,
codemod расширений, Prisma, скрипты.

### Скрипты вне Nest: `tsx` вместо `ts-node -r tsconfig-paths/register`

**Решение:** `tsx` 4.23.15 в devDependencies API; `ts-node` и
`tsconfig-paths` удаляются. `seed: 'tsx prisma/seed.ts'` в
`prisma.config.ts`, `backfill:jorf: tsx scripts/jorf-backfill.ts`,
`npx tsx scripts/e2e-seed.ts` в `playwright.e2e.config.ts`.
**Почему:** ts-node 10 под ESM требует loader-флагов и `tsconfig-paths`
отдельным регистром; tsx читает `paths` из tsconfig сам и это раннер,
который документирует Prisma для `migrations.seed`. Встроенный type
stripping Node (стабилен с 24.12) не подходит: не берёт декораторы и
`paths` (nodejs.org/api/typescript.html), а скрипты импортируют классы с
`@Injectable()`. Метаданные декораторов tsx (esbuild) не эмитит — скриптам
они и не нужны: все три собирают сервисы через `new` (`jorf-backfill.ts`,
`seed.ts`, `e2e-seed.ts`), контейнер Nest не поднимают.
**WARM:** `tsx` 4.23.15 — замена ts-node, своего кода тут нет; релиз
20.09.2026; 397 КБ, один поддеп (`esbuild`); advisories — нет.
**Отброшено:** `@swc-node/register` — нужен только если скрипт когда-нибудь
поднимет `NestFactory.createApplicationContext`; тогда менять раннер
скриптов, не раньше.

### Сборка и запуск: без изменений, кроме имени точки входа

**Решение:** `nest build` на tsc-билдере остаётся: swagger-плагин — tsc-
трансформер, формат модулей ему безразличен; `nest-cli.json` и
`tsconfig.build.json` в шаблонах CJS и ESM Nest совпадают. `start:prod` →
`node dist/main.js` (ESM не ищет расширение). `main.ts` без правок.
**Почему:** гайд миграции Nest 12 перечисляет для ESM только `type`,
расширения, `import.meta.dirname` и `createRequire` — у нас `require` в
TS-коде нет, `__dirname` только в двух тестах.

## Исправлено при реализации (13.10.2026)

- Конфиги Vitest названы `.mts`: раннер менялся до смены формата, а tsc в
  CommonJS-пакете отвергает `import.meta` в `.ts`. `tsconfig.build.json`
  исключает их — они входят в `tsconfig.json` ради `tsc --noEmit`, а под
  `rootDir: src` не лежат.
- `apps/web/tsconfig.json` вёл contracts в исходники через `paths`, вопреки
  `apps/web/CLAUDE.md`; Turbopack по этому маппингу не резолвил `./enums.js`
  в `.ts`. Маппинг удалён, web берёт `dist` по `main`, как и записано.
- Документация правилась в коммите каждой задачи, не отдельной задачей:
  правило корневого `CLAUDE.md` сильнее плана.

## Что править в документации тем же PR

- корневой `CLAUDE.md`, «Команды и проверки»: «eslint и jest его не видят»
  → vitest;
- `apps/api/CLAUDE.md`: «Команды» (moduleNameMapper → alias Vitest; про
  ts-jest и isolatedModules — переписать на Oxc), «Интеграционные тесты»
  (`jest.int.*` → `int.*.ts`, `JEST_WORKER_ID` → `VITEST_POOL_ID`, «оба
  jest-конфига» → «оба конфига Vitest»);
- `apps/api/src/prisma/CLAUDE.md`: строка про `ts-node -r tsconfig-paths/register`;
- `docs/research/commune-referential.md` — снапшот: врезка про замену
  jest-конфига (правило «research — снапшот» действует до фазы 2 harness-v2).

## Ограничения и риски

- **Vitest 5 чистит историю вызовов моков перед каждым тестом**
  (`clearMocks: true` по умолчанию). Тест, считающий вызовы через границу
  тестов, упадёт — и это правильно; но увидеть такое можно только прогоном.
- **Метаданные без типов:** параметр конструктора с типом-интерфейсом или
  алиасом даёт `Object` — как и сейчас под `isolatedModules`; Nest там уже
  требует `@Inject`. Нового класса ошибок нет, проверка — зелёный прогон до
  смены формата (см. «Как применять» раннера).
- **`prisma.config.ts` под `"type": "module"`** — документация Prisma молчит
  о загрузке TS-конфига в ESM-пакете; первая команда фазы —
  `npx prisma validate`, при отказе файл переименовывается в
  `prisma.config.mts` (расширение в списке поддерживаемых). `?`
- **`nest start --watch` и `node dist/main.js`** под ESM в шаблоне Nest 12
  есть, на нашем приложении не прогонялись — критерий готовности фазы.
- **`.jscpd-baseline.json`**: codemod меняет токены строк импортов, часть
  записей baseline по API может перестать совпадать — пересобрать
  `dup:baseline`, не расширять.
- Объём одного PR — порядка 250 файлов, из них ~225 только строками
  импортов; ревью по ним — `git diff -w --stat` и выборочно, по смыслу
  смотреть конфиги, `test/setup/`, 19 спеков с моками.
