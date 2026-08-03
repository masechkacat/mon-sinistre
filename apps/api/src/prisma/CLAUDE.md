# CLAUDE.md — `src/prisma`

Подключение Prisma 7, сборка connection string, экранирование LIKE и клиент для
интеграционных тестов. Правила приложения — `../../CLAUDE.md`. Схема и миграции
живут в `apps/api/prisma/`.

**Стиль v7 — driver adapter**: инструкции из туториалов для Prisma 5/6 не
годятся.

## Конфигурация CLI

**`prisma.config.ts`** в корне пакета — единственный источник конфигурации CLI
(ключ `"prisma"` в `package.json` больше не читается). Первой строкой
`process.loadEnvFile()` в `try/catch`: CLI в v7 сама `.env` **не** загружает, а
при отсутствии файла (например в CI) переменные приходят из окружения. `dotenv`
не подключать — фантомная зависимость, Node ≥ 24 умеет это сам. Здесь же
настроена seed-команда: `migrations.seed` →
`ts-node -r tsconfig-paths/register prisma/seed.ts` (регистрация путей
обязательна: value-импорт из `src/...` без неё упадёт с `MODULE_NOT_FOUND`).

## `DATABASE_URL` не существует

Connection string собирает `database-url.ts` из
`DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` — в `prisma.config.ts` из
`process.env`, в `PrismaService` из `ConfigService`. Так docker-compose, CLI
миграций, рантайм и интеграционные тесты гарантированно смотрят на одну базу
(`docs/decisions.md`, 30.07.2026).

## Схема и клиент

**`schema.prisma`**: в `datasource db` только `provider = "postgresql"` (url
живёт в конфиге); генератор `prisma-client` эмитит TypeScript в
`src/generated/prisma` (папка в `.gitignore`). `npm run prisma:generate` — после
каждой правки схемы; `npm run build` делает это сам перед `nest build`.

Реляционная схема следует `docs/research/data-model.md`. Сейчас в схеме:
`Commune` (§ 3 модели; миграции `init_commune`, `add_commune_name_normalized` —
детали колонки `nameNormalized` в `../communes/CLAUDE.md`).

**`PrismaService`** наследует сгенерированный `PrismaClient` поверх
`@prisma/adapter-pg`: явный `$connect` в `onModuleInit` — недоступная база валит
приложение при bootstrap, как и невалидный env (API без Postgres не стартует,
это осознанно); disconnect в `onModuleDestroy` (срабатывает через
`enableShutdownHooks`). **`PrismaModule` глобальный**, подключён в `AppModule`.

## `escapeLikePattern`

`\`, `%`, `_` → с обратной косой одним проходом по классу символов (Postgres
читает обратную косую как escape по умолчанию). Это **единственное правило
экранирования на весь API**: применять к любому пользовательскому вводу в
`startsWith`/`contains`/`endsWith`, второй реализации не заводить. Ровно один
раз — функция не идемпотентна, повторный вызов экранирует собственные escape'ы.

Лежит здесь, а не рядом с запросом, и покрыта юнит-тестом без базы: так запрос
остаётся типизированным Prisma, без `$queryRaw`.

## Клиент для интеграционных тестов

`prisma-client.int-helper.ts` — `createIntTestPrismaClient` для спеков, которым
Nest не нужен (импорт работает вне контекста, тесты миграций — на сыром SQL).
`$disconnect` в `afterAll` — на вызывающей стороне, иначе прогон повиснет на
открытом пуле. Спеки, поднимающие `AppModule`, берут `PrismaService` из
контейнера, а не этот хелпер.
