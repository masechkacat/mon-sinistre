# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Контекст всего монорепозитория — в корневом `../../CLAUDE.md`. Здесь — специфика `@jalons/api`.

## Стек

NestJS 11 на **Fastify** (не Express — плагины подключаются через `app.register`, см. `src/main.ts`), TypeORM + PostgreSQL, Passport (local + JWT), Swagger на `/docs`.

## Команды (из apps/api)

```bash
npm run start:dev        # watch-режим, читает .env через --env-file
npm test                 # jest, все *.spec.ts в src/
npm test -- steps        # один тест по подстроке пути
npm run test:cov         # с покрытием
npm run lint             # eslint, только проверка (используется pre-commit хуком)
npm run lint:fix         # eslint с автопочинкой
npm run migration:generate -- src/database/migrations/<Name>
npm run migration:run
npm run migration:revert
npm run seed             # заполнение справочников (коммуны INSEE, шаблоны планов, справочник сроков)
```

База данных поднимается из корня: `npm run db:up`. Перед запуском API нужен собранный contracts (`npm run build:contracts` из корня) — рантайм импортирует его из `dist/`. В тестах это не нужно: jest через `moduleNameMapper` подставляет исходники `packages/contracts/src`.

## Текущее состояние

Скелет: `AppModule` намеренно не подключает TypeORM, чтобы приложение стартовало без базы (см. комментарий в `src/app.module.ts`). При добавлении первых сущностей нужно создать `DatabaseModule` (data source ожидается в `src/database/data-source.ts` — на него ссылаются migration-скрипты) и подключить его в `AppModule`.

Уже подключено в скелете:

- Валидация переменных окружения на старте (`src/config/env.validation.ts`, class-validator): отсутствующий или некорректный секрет валит приложение при bootstrap, а не при первом использовании. Новая переменная добавляется в эту схему и в `.env.example` одним коммитом. SMTP-переменные необязательны, пока нет модуля рассылки — ужесточить при его появлении.
- Глобальный rate limiting (`@nestjs/throttler`, 100 запросов в минуту, `ThrottlerGuard` через `APP_GUARD`). Auth-эндпоинтам при появлении задать более строгие лимиты через `@Throttle()`.
- `app.enableShutdownHooks()` в `main.ts` — корректная остановка cron-задач и будущего пула TypeORM по SIGTERM.
- `tsconfig.build.json` исключает `*.spec.ts` из продакшен-сборки; `nest build` использует его автоматически.

## Актуализация документации

Раздел «Текущее состояние» выше описывает скелет и устареет первым: при подключении TypeORM, появлении DatabaseModule, первых сущностей и миграций — обновить его в том же коммите. Новые модули, изменения в аутентификации или структуре `src/` тоже отражать здесь; изменения, затрагивающие весь монорепозиторий (команды, порядок сборки, contracts), — в корневом `../../CLAUDE.md`.

## Правила проекта

- Глобальный `ValidationPipe` с `whitelist + forbidNonWhitelisted`: у каждого эндпоинта, принимающего данные, должен быть DTO с декораторами class-validator, иначе любое тело запроса будет отклонено.
- Проверка принадлежности объекта пользователю — **в условии запроса к базе** (`where: { ..., user }`), не после выборки. Чужой и несуществующий объект дают одинаковый ответ (404, не 403).
- Изменения схемы — только миграции; `synchronize` не включать.
- Файлы пользователей (фото ущерба, justificatifs) — в приватном S3-совместимом хранилище, наружу только короткие подписанные URL; публичных бакетов нет.
- Юридические сроки берутся только из справочника `DeadlineRule` (с `SourceReference`), не хардкодятся; дата публикации arrêté — только из XML JORF, не из GASPAR и не из даты появления файла в выгрузке DILA.
- В логи не попадают email, адреса, содержимое инвентаря и файлы.
- Refresh-токены — в httpOnly-cookie с ротацией; access — в теле ответа. Секреты и сроки — в `.env` (`.env.example` — актуальный список переменных).
- Статусы шагов (`A_VENIR`/`A_FAIRE`/`EN_RETARD`) вычисляются при чтении из плановой даты; в базе хранятся только `FAIT` и `NON_APPLICABLE`. Enum'ы и пороги брать из `@jalons/contracts`, не дублировать.
- Доменные даты — строки `YYYY-MM-DD` (тип `IsoDate`), в Postgres — колонки `date`, не `timestamp`.
- Рассылка напоминаний — `@nestjs/schedule`, раз в сутки, не больше одного письма пользователю в день; сбой отправки одному получателю не прерывает остальных.
