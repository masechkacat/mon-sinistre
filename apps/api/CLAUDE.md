# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Контекст всего монорепозитория — в корневом `../../CLAUDE.md`. Здесь — специфика `@mon-sinistre/api`.

## Стек

NestJS 11 на **Fastify** (не Express — плагины подключаются через `app.register`, см. `src/main.ts`), **Prisma** + PostgreSQL, Passport (local + JWT), Swagger на `/docs`.

## Команды (из apps/api)

```bash
npm run start:dev        # watch-режим, читает .env через --env-file
npm test                 # jest, все *.spec.ts в src/ (юнит, без Docker)
npm test -- steps        # один тест по подстроке пути
npm run test:int         # интеграционные тесты (*.int-spec.ts) против реального Postgres — нужен npm run db:up
npm run test:cov         # с покрытием
npm run lint             # eslint, только проверка (используется pre-commit хуком)
npm run lint:fix         # eslint с автопочинкой
npm run prisma:generate  # перегенерировать клиент после правки schema.prisma
npm run migration:dev    # prisma migrate dev — создать/применить миграцию локально
npm run migration:deploy # prisma migrate deploy — применить миграции (прод/CI)
npm run seed             # prisma db seed — идемпотентный импорт справочника коммун COG из geo.api.gouv.fr (~35 тыс. записей, повторный запуск безопасен); команда настроена в prisma.config.ts (migrations.seed)
```

База данных поднимается из корня: `npm run db:up`. Перед запуском API нужен собранный contracts (`npm run build:contracts` из корня) — рантайм импортирует его из `dist/`. В тестах это не нужно: jest через `moduleNameMapper` подставляет исходники `packages/contracts/src`.

## Текущее состояние

Prisma 7 подключена (стиль v7 — driver adapter, инструкции из туториалов для Prisma 5/6 не годятся):

- **`prisma.config.ts`** в корне пакета — единственный источник конфигурации CLI (ключ `"prisma"` в package.json больше не читается): первой строкой `process.loadEnvFile()` в `try/catch` (CLI в v7 сама `.env` **не** загружает; при отсутствии файла — например в CI — переменные приходят из окружения). `dotenv` не подключать: фантомная зависимость, Node ≥ 24 умеет это сам. Здесь же настроена seed-команда: `migrations.seed` → `ts-node -r tsconfig-paths/register prisma/seed.ts` (регистрация путей обязательна: value-импорт из `src/...` без неё упадёт с MODULE_NOT_FOUND).
- **`DATABASE_URL` не существует**: connection string собирает `buildDatabaseUrl` (`src/prisma/database-url.ts`) из `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` — в `prisma.config.ts` из `process.env`, в `PrismaService` из ConfigService. Так docker-compose, CLI миграций, рантайм и интеграционные тесты гарантированно смотрят на одну базу (решение — `docs/decisions.md`).
- **`prisma/schema.prisma`**: в `datasource db` только `provider = "postgresql"` (url живёт в конфиге); генератор `prisma-client` эмитит TypeScript в `src/generated/prisma` (папка в .gitignore). `npm run prisma:generate` — после каждой правки схемы; `npm run build` делает это сам перед `nest build`. Модели: `Commune` (справочник по `docs/research/data-model.md` § 3, миграции `init_commune`, `add_commune_name_normalized`).
- **`PrismaService`** (`src/prisma/`) наследует сгенерированный `PrismaClient` поверх `@prisma/adapter-pg`: явный `$connect` в `onModuleInit` — недоступная база валит приложение при bootstrap, как и невалидный env (API без Postgres не стартует, это осознанно); disconnect в `onModuleDestroy` (срабатывает через `enableShutdownHooks`). **`PrismaModule`** глобальный и подключён в `AppModule`.

Импорт справочника коммун (`src/communes/import/`, решения — `docs/research/commune-referential.md`): **`GeoApiClient`** — нативный `fetch` Node 24 с `AbortSignal.timeout(60 с)`, fetch-функция передаётся через конструктор (тесты мокают HTTP без nock/msw); каждая запись валидируется на четыре обязательных поля (`code`, `nom`, `codeDepartement`, `departement.nom`), ответ короче `MIN_EXPECTED_COMMUNES = 30_000` отклоняется — неполные данные роняют импорт, а не пропускаются молча. **`CommuneImportService`** — обычный класс без Nest-контекста (seed зависит только от `DB_*` и сети; при появлении регулярной актуализации оборачивается Nest-провайдером через `useFactory`): upsert по `codeInsee` чанками по 500, `update` задаёт `name`/`nameNormalized`/`departement*`/`sourceUrl`/`sourceVerifiedAt` (дата запуска, UTC-полночь) и не трогает `effectiveTo`/`successorCodeInsee`; исчезнувшие из ответа коды никогда не удаляются. Итоговая сверка: число успешных upsert'ов равно числу записей источника, иначе импорт завершается ошибкой (в логах — только счётчики и коды INSEE). Запуск — `npm run seed` (`prisma db seed` → ts-node с tsconfig-paths, скрипт сам грузит `.env`).

Нормализация названий (`src/communes/normalize-commune-name.ts`): `normalizeCommuneName` — единственный способ получить поисковый ключ названия коммуны (lowercase → NFD → удаление `\p{M}` → `œ`→`oe`, `æ`→`ae` → `’`→`'`). Ею заполняется колонка `Commune.nameNormalized` при импорте и ею же нормализуется `q` в поисковом запросе; второй реализации правила быть не должно, иначе запись и чтение разъедутся. Апострофы, дефисы и пробелы сохраняются осознанно как разделители («lhay» не находит «L'Haÿ-les-Roses»), но их типографские варианты приводятся к одному — `docs/decisions.md` (02.08.2026). Функция даёт ключ только для названий: ветка поиска по коду INSEE сравнивает «сырой» `q` с `codeInsee`, который импорт хранит как есть, в верхнем регистре (`2A004`). Тест — `normalize-commune-name.spec.ts`, без базы.

Колонка `nameNormalized` заведена миграцией `add_commune_name_normalized`: **nullable**, `COLLATE "C"`, обычный btree `Commune_nameNormalized_idx`. Байтовый порядок — требование переносимости, не оптимизация: под локальными collation порядок выдачи меняется между образами Postgres (почему и как проверено — `docs/decisions.md`, запись о `COLLATE "C"` от 02.08.2026); под ним же btree обслуживает и префиксный `LIKE`, и `ORDER BY`, класс оператора `text_pattern_ops` не нужен. Collation Prisma не выражает — она живёт только в SQL миграции и дрейфом не считается; сторожит её int-тест, потому что `migrate dev` потерю collation молча пропустит.

Правило нормализации не повторяется в SQL: backfill существующих строк — перезапуск идемпотентного импорта (`npm run seed`), который колонку заполняет. **Порядок развёртывания обязателен: `migration:deploy` → `seed`.** Пропуск второго шага не сломает ничего заметно — поиск по названию просто вернёт пустой список на всех запросах, потому что у строк не будет ключа; для аудитории продукта это худший вид отказа. Поэтому `CommuneSearchKeyCheck` (`src/communes/commune-search-key.check.ts`) на `onApplicationBootstrap` считает строки без ключа и пишет warning — предупреждает, но не валит приложение: частично импортированный справочник всё же отвечает по тем коммунам, что знает. Ужесточение до `NOT NULL` — отдельной миграцией и только после backfill'а на всех развёртываниях: она сделает пропуск невозможным и заменит собой эту проверку. Тесты на структуру (nullable, collation, индекс) — `commune-name-normalized.int-spec.ts`.

Модули: `CommunesModule` — публичный поиск `GET /communes?q=` (префикс названия или точный код INSEE, только действующие коды, лимит `COMMUNE_SEARCH_LIMIT` из contracts). Поиск по названию идёт по `nameNormalized`: `q` проходит через `normalizeCommuneName`, поэтому «chateau» находит «Château-Thierry»; сортировка — по той же колонке, а не по `name` (иначе «Étampes» уехал бы в конец выдачи), и порядок одинаков везде благодаря `COLLATE "C"` — см. абзац о колонке выше. Ветка кода INSEE сравнивает `q.toUpperCase()` с `codeInsee`: коды хранятся как их отдаёт COG, в верхнем регистре, и набранное с телефона «2a004» иначе не нашло бы ничего (буквы есть только в корсиканских 2A/2B). Нормализацию к коду применять нельзя — она предназначена для названий. `startsWith` Prisma не экранирует LIKE-символы, поэтому нормализованный префикс проходит через `escapeLikePattern` (`src/prisma/escape-like-pattern.ts`: `\`, `%`, `_` → с обратной косой одним проходом по классу символов; Postgres читает обратную косую как escape по умолчанию) — так запрос остаётся типизированным Prisma, без `$queryRaw`. Функция лежит не рядом с запросом, а в `src/prisma/`, и покрыта юнит-тестом без базы: это единственное правило экранирования на весь API, применять его к **любому** пользовательскому вводу в `startsWith`/`contains`/`endsWith`, второй реализации не заводить. Ровно один раз: функция не идемпотентна, повторный вызов экранирует собственные escape'ы. Индекс под префиксный поиск заведён миграцией (см. абзац о `nameNormalized` выше). Swagger-документация эндпоинтов — response-класс, реализующий контракт через `implements`, и `@ApiOkResponse` на методе; свойства описываются CLI-плагином `@nestjs/swagger` (см. «Правила проекта»), `@ApiProperty` остаётся там, где нужен пример или ограничение сверх типа.

Уже подключено в скелете:

- Валидация переменных окружения на старте (`src/config/env.validation.ts`, class-validator): отсутствующий или некорректный секрет валит приложение при bootstrap, а не при первом использовании. Новая переменная добавляется в эту схему и в `.env.example` одним коммитом. SMTP-переменные необязательны, пока нет модуля рассылки — ужесточить при его появлении.
- Глобальный rate limiting (`@nestjs/throttler`, 100 запросов в минуту, `ThrottlerGuard` через `APP_GUARD`). Auth-эндпоинтам при появлении задать более строгие лимиты через `@Throttle()`.
- `app.enableShutdownHooks()` в `main.ts` — корректная остановка cron-задач по SIGTERM; когда появится PrismaModule, тот же механизм вызовет его disconnect.
- `tsconfig.build.json` исключает `*.spec.ts` из продакшен-сборки; `nest build` использует его автоматически.

## Интеграционные тесты

Решение и его причины — `docs/research/commune-referential.md`; здесь итог:

- Интеграционные спеки — `*.int-spec.ts` рядом с кодом в `src/`. Юнит-конфиг в `package.json` их не видит (суффикс не подпадает под `.*\.spec\.ts$`), поэтому pre-commit хук и корневой `npm test` остаются быстрыми и без Docker-требования.
- `jest.int.config.js`: `testRegex '.*\.int-spec\.ts$'`, `maxWorkers: 1` — обязателен, пока тесты делят одну базу; если прогон станет медленным — база-на-воркера через `JEST_WORKER_ID`, не testcontainers.
- База — `${DB_NAME}_test` на том же docker-compose Postgres (`npm run db:up` из корня). `test/jest.int.global-setup.js` создаёт её при отсутствии (клиентом `pg`) и прогоняет `prisma migrate deploy` с переопределённым `DB_NAME`; `test/jest.int.env.js` тем же переопределением направляет туда `PrismaService` в тестах. Имя тестовой базы оба вычисляют общим хелпером `test/test-db-name.js` — setup и тесты обязаны смотреть на одну базу.
- Между тестами — `TRUNCATE` затронутых таблиц в `beforeEach`, не пересоздание схемы.
- Спекам, которым Nest не нужен (импорт работает вне контекста, тесты миграций — на сыром SQL), клиент даёт `createIntTestPrismaClient` (`src/prisma/prisma-client.int-helper.ts`); `$disconnect` в `afterAll` — на вызывающей стороне, иначе прогон повиснет на открытом пуле. Спеки, поднимающие `AppModule`, берут `PrismaService` из контейнера, а не этот хелпер.
- Суффикс `*.int-helper.ts` — тестовый код, живущий в `src/` (ради алиаса `src/*` и охвата `npm run lint`): исключён из продакшен-сборки и не подпадает под `testRegex` ни одного из конфигов.
- `*.int-spec.ts` и `*.int-helper.ts` исключены из продакшен-сборки в `tsconfig.build.json`, как и `*.spec.ts`.
- В CI понадобится сервисный Postgres 18 — зафиксировать при настройке CI.

## Актуализация документации

Раздел «Текущее состояние» выше описывает скелет и устареет первым: при подключении Prisma (PrismaModule/PrismaService), первых моделей и миграций — обновить его в том же коммите. Новые модули, изменения в аутентификации или структуре `src/` тоже отражать здесь; изменения, затрагивающие весь монорепозиторий (команды, порядок сборки, contracts), — в корневом `../../CLAUDE.md`.

## Правила проекта

- Глобальный `ValidationPipe` с `whitelist + forbidNonWhitelisted`: у каждого эндпоинта, принимающего данные, должен быть DTO с декораторами class-validator, иначе любое тело запроса будет отклонено. Пайп создаётся фабрикой `createGlobalValidationPipe` (`src/config/validation-pipe.ts`) — её же использовать в интеграционных тестах, конфигурацию не копировать.
- Проверка принадлежности объекта пользователю — **в условии запроса к базе** (`where: { ..., user }`), не после выборки. Чужой и несуществующий объект дают одинаковый ответ (404, не 403).
- Изменения схемы — только через `prisma migrate` (файлы миграций в git); `prisma db push` — только для локальных экспериментов, в прод никогда.
- Файлы пользователей (фото ущерба, justificatifs) — в приватном S3-совместимом хранилище, наружу только короткие подписанные URL; публичных бакетов нет.
- Юридические сроки берутся только из справочника `DeadlineRule` (с `SourceReference`), не хардкодятся; дата публикации arrêté — только из XML JORF, не из GASPAR и не из даты появления файла в выгрузке DILA.
- **Логи — только через `Logger` из `@nestjs/common`**, с контекстом класса (`private readonly logger = new Logger(CommuneImportService.name)`); `console.*` в коде приложения не используется. Уровни задаются один раз в `main.ts`: `error`/`warn`/`log` в продакшене, плюс `debug`/`verbose` в остальных средах; ошибка логируется с уровнем `error` и стеком, а не `log`. `nestjs-pino` не заводить, пока нет сбора логов. Почему так — `docs/decisions.md`, запись о логах от 03.08.2026.
- В логи не попадают email, адреса, содержимое инвентаря и файлы — правило действует и на логирование ошибок: пишутся идентификаторы, коды и счётчики, но не тело запроса и не DTO целиком.
- **Swagger-схема свойств — через CLI-плагин `@nestjs/swagger`** (`plugins` в `nest-cli.json`, `introspectComments: true`): типы полей и JSDoc-комментарии DTO попадают в `/docs` без ручных декораторов. `@ApiProperty` пишется только там, где плагину нечего вывести: пример значения, описание вне JSDoc, брендированные типы contracts (`IsoDate` стирается до `string` — указывать `type: String, format: 'date'`). Response-класс с `implements` контракта нужен по-прежнему (интерфейсы contracts на рантайме отсутствуют); ts-jest плагин не применяет — схему проверять на запущенном приложении (`/docs`), не в тестах. Контекст решения — `docs/decisions.md`, запись о плагине от 03.08.2026.
- Refresh-токены — в httpOnly-cookie с ротацией; access — в теле ответа. Секреты и сроки — в `.env` (`.env.example` — актуальный список переменных).
- Статусы шагов (`A_VENIR`/`A_FAIRE`/`EN_RETARD`) вычисляются при чтении из плановой даты; в базе хранятся только `FAIT` и `NON_APPLICABLE`. Enum'ы и пороги брать из `@mon-sinistre/contracts`, не дублировать.
- Доменные даты — строки `YYYY-MM-DD` (брендированный тип `IsoDate`, конструируется через `toIsoDate`/`isIsoDate` из contracts), в Postgres — колонки `date`, не `timestamp`. Тесты этих хелперов — `src/common/iso-date.spec.ts`: у contracts нет своего test runner'а, jest подставляет его исходники через `moduleNameMapper`.
- Рассылка напоминаний — `@nestjs/schedule`, раз в сутки, не больше одного письма пользователю в день; сбой отправки одному получателю не прерывает остальных.
- **Письма.** Модуля отправки ещё нет — он появляется в фазе 1 фичи `emails` (план — `docs/plan/emails.md`). Технические решения приняты заранее и обязательны для всех фаз: провайдер Scaleway TEM (регион `fr-par`, HTTP API через нативный `fetch`), французские строки — в `src/i18n/fr.ts`, а не в коде сервиса, text- и HTML-версии рендерятся из одной блочной модели, локальный режим пишет письма в файлы. Основания и ограничения — `docs/research/emails.md`.
