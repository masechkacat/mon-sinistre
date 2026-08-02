# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Контекст всего монорепозитория — в корневом `../../CLAUDE.md`. Здесь — специфика `@mon-sinistre/api`.

## Стек

NestJS 11 на **Fastify** (не Express — плагины подключаются через `app.register`, см. `src/main.ts`), **Prisma** + PostgreSQL, Passport (local + JWT), Swagger на `/docs`.

## Команды (из apps/api)

```bash
npm run start:dev        # watch-режим, читает .env через --env-file
npm test                 # jest, все *.spec.ts в src/
npm test -- steps        # один тест по подстроке пути
npm run test:cov         # с покрытием
npm run lint             # eslint, только проверка (используется pre-commit хуком)
npm run lint:fix         # eslint с автопочинкой
npm run prisma:generate  # перегенерировать клиент после правки schema.prisma
npm run migration:dev    # prisma migrate dev — создать/применить миграцию локально
npm run migration:deploy # prisma migrate deploy — применить миграции (прод/CI)
npm run seed             # prisma db seed — справочники (коммуны INSEE, шаблоны планов, сроки); сама команда настраивается в prisma.config.ts
```

База данных поднимается из корня: `npm run db:up`. Перед запуском API нужен собранный contracts (`npm run build:contracts` из корня) — рантайм импортирует его из `dist/`. В тестах это не нужно: jest через `moduleNameMapper` подставляет исходники `packages/contracts/src`.

## Текущее состояние

Технические решения по справочнику коммун (инфраструктура интеграционных тестов, клиент geo.api.gouv.fr, стратегия импорта и seed, нормализация поиска) приняты в `../../docs/research/commune-referential.md` — при реализации фаз плана следовать ему, не перевыбирать.

Prisma 7 подключена (стиль v7 заметно отличается от Prisma 5/6 — инструкции из старых туториалов не годятся):

- **`prisma.config.ts`** в корне пакета — единственный источник конфигурации CLI (ключ `"prisma"` в package.json больше не читается): первой строкой `import 'dotenv/config'` (CLI в v7 сама `.env` **не** загружает), затем `defineConfig` с путём к схеме и `datasource.url`; конфигурация seed-команды появится там же.
- **`DATABASE_URL` отдельной переменной нет**: connection string собирается из `DB_HOST/DB_PORT/DB_USER/DB_PASSWORD/DB_NAME` — в `prisma.config.ts` из `process.env`, в `PrismaService` из ConfigService. Так docker-compose, CLI миграций и рантайм гарантированно смотрят на одну базу (решение — `docs/decisions.md`).
- **`prisma/schema.prisma`**: в `datasource db` только `provider = "postgresql"` (url живёт в конфиге); генератор — `provider = "prisma-client"` (не `prisma-client-js`) с `output = "../src/generated/prisma"`. Папка `src/generated/` в .gitignore и вне eslint/coverage; `npm run prisma:generate` — после каждой правки схемы, в скрипте `build` он выполняется автоматически перед `nest build`.
- **Driver adapter** (стандартный путь v7): `@prisma/adapter-pg`, `new PrismaClient({ adapter: new PrismaPg({ connectionString }) })` — см. `src/prisma/prisma.service.ts`.
- **`PrismaModule`** (`src/prisma/`) — `@Global()`, экспортирует `PrismaService`; сервис наследует сгенерированный `PrismaClient`, делает `$connect` в `onModuleInit` (недоступная база валит bootstrap, а не первый запрос) и disconnect в `onModuleDestroy` (срабатывает через `enableShutdownHooks`).

Уже подключено в скелете:

- Валидация переменных окружения на старте (`src/config/env.validation.ts`, class-validator): отсутствующий или некорректный секрет валит приложение при bootstrap, а не при первом использовании. Новая переменная добавляется в эту схему и в `.env.example` одним коммитом. SMTP-переменные необязательны, пока нет модуля рассылки — ужесточить при его появлении.
- Глобальный rate limiting (`@nestjs/throttler`, 100 запросов в минуту, `ThrottlerGuard` через `APP_GUARD`). Auth-эндпоинтам при появлении задать более строгие лимиты через `@Throttle()`.
- `app.enableShutdownHooks()` в `main.ts` — корректная остановка cron-задач по SIGTERM; когда появится PrismaModule, тот же механизм вызовет его disconnect.
- `tsconfig.build.json` исключает `*.spec.ts` из продакшен-сборки; `nest build` использует его автоматически.

## Актуализация документации

Раздел «Текущее состояние» выше описывает скелет и устареет первым: при подключении Prisma (PrismaModule/PrismaService), первых моделей и миграций — обновить его в том же коммите. Новые модули, изменения в аутентификации или структуре `src/` тоже отражать здесь; изменения, затрагивающие весь монорепозиторий (команды, порядок сборки, contracts), — в корневом `../../CLAUDE.md`.

## Правила проекта

- Глобальный `ValidationPipe` с `whitelist + forbidNonWhitelisted`: у каждого эндпоинта, принимающего данные, должен быть DTO с декораторами class-validator, иначе любое тело запроса будет отклонено.
- Проверка принадлежности объекта пользователю — **в условии запроса к базе** (`where: { ..., user }`), не после выборки. Чужой и несуществующий объект дают одинаковый ответ (404, не 403).
- Изменения схемы — только через `prisma migrate` (файлы миграций в git); `prisma db push` — только для локальных экспериментов, в прод никогда.
- Файлы пользователей (фото ущерба, justificatifs) — в приватном S3-совместимом хранилище, наружу только короткие подписанные URL; публичных бакетов нет.
- Юридические сроки берутся только из справочника `DeadlineRule` (с `SourceReference`), не хардкодятся; дата публикации arrêté — только из XML JORF, не из GASPAR и не из даты появления файла в выгрузке DILA.
- В логи не попадают email, адреса, содержимое инвентаря и файлы.
- Refresh-токены — в httpOnly-cookie с ротацией; access — в теле ответа. Секреты и сроки — в `.env` (`.env.example` — актуальный список переменных).
- Статусы шагов (`A_VENIR`/`A_FAIRE`/`EN_RETARD`) вычисляются при чтении из плановой даты; в базе хранятся только `FAIT` и `NON_APPLICABLE`. Enum'ы и пороги брать из `@mon-sinistre/contracts`, не дублировать.
- Доменные даты — строки `YYYY-MM-DD` (брендированный тип `IsoDate`, конструируется через `toIsoDate`/`isIsoDate` из contracts), в Postgres — колонки `date`, не `timestamp`. Тесты этих хелперов — `src/common/iso-date.spec.ts`: у contracts нет своего test runner'а, jest подставляет его исходники через `moduleNameMapper`.
- Рассылка напоминаний — `@nestjs/schedule`, раз в сутки, не больше одного письма пользователю в день; сбой отправки одному получателю не прерывает остальных.
