# Jalons

Suivi des démarches de renouvellement des droits MDPH.

Приложение рассчитывает график подготовки досье от даты истечения прав, следит
за сроками годности документов и напоминает о шагах заранее. Оно не даёт
юридических консультаций и не подаёт документы за пользователя — его задача не
дать пропустить сроки.

Полное описание: [`docs/technical-specification.md`](docs/technical-specification.md).

## Структура

```
apps/api        NestJS + Fastify + TypeORM + PostgreSQL
apps/web        Next.js + shadcn/ui
packages/contracts  типы и enum'ы, общие для API и клиента
docs            техническое задание
```

Монорепозиторий на npm workspaces. Общие типы вынесены в `@jalons/contracts`,
чтобы статусы досье и шагов не расходились между сервером и клиентом.

## Запуск

Требуется Node.js 24+ и Docker.

```bash
npm install

cp apps/api/.env.example apps/api/.env   # заполнить секреты
npm run db:up                            # PostgreSQL в Docker

npm run build:contracts                  # общие типы собираются первыми
npm run dev:api                          # http://localhost:3001, /docs — OpenAPI
npm run dev:web                          # http://localhost:3000
```

Секреты генерируются через `openssl rand -base64 48`. Файл `.env` в
репозиторий не попадает.

## Тесты

```bash
npm test
```

Ядро, требующее покрытия в первую очередь, — расчёт дат: развёртывание плана от
даты истечения прав, приоритет источников срока рассмотрения, состояния шагов,
контроль сроков годности документов.

## Pre-commit хук

Перед каждым коммитом автоматически прогоняются `npm run lint` и `npm test`
(хук в `.githooks/pre-commit`, без сторонних зависимостей). Git настраивается
на эту папку сам при `npm install` (скрипт `prepare` выставляет
`core.hooksPath`). Обойти в исключительном случае: `git commit --no-verify`.

## Доступность

Требования доступности обязательны наравне с функциональными: аудитория
приложения — люди с инвалидностью и их семьи. Ориентир — WCAG 2.1 AA и RGAA
4.1.2, состав требований в разделе 9 технического задания.
