# Mon Sinistre

Assistant catastrophe naturelle : veille des arrêtés au Journal Officiel et
suivi du sinistre.

> Домены-кандидаты: `mon-sinistre.fr`, `monsinistre.app` (свободны на 30.07.2026).

Приложение уведомляет жителей выбранных коммун в день публикации arrêté de
catastrophe naturelle в Journal Officiel и ведёт пострадавшего через страховой
случай: план действий, 30-дневный срок декларации, сроки страховщика, инвентарь
ущерба. Оно не даёт юридических консультаций и не действует от имени
пользователя перед страховщиком — его задача не дать пропустить сроки.

Полное описание: [`docs/technical-specification.md`](docs/technical-specification.md).

## Структура

```
apps/api        NestJS + Fastify + Prisma + PostgreSQL
apps/web        Next.js + shadcn/ui
packages/contracts  типы и enum'ы, общие для API и клиента
docs            техническое задание
```

Монорепозиторий на npm workspaces. Общие типы вынесены в `@mon-sinistre/contracts`,
чтобы статусы синистра и шагов не расходились между сервером и клиентом.

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

Ядро, требующее покрытия в первую очередь (раздел 9 ТЗ), — парсер arrêté на
фикстурах реальных XML из JORF, вычисление дедлайнов (30 дней от публикации,
граничные случаи), состояния шагов и шаги с ещё не наступившим якорем,
дедупликация по NOR, поводы для напоминаний.

## Pre-commit хук

Перед каждым коммитом автоматически прогоняются `npm run lint` и `npm test`
(хук в `.githooks/pre-commit`, без сторонних зависимостей). Git настраивается
на эту папку сам при `npm install` (скрипт `prepare` выставляет
`core.hooksPath`). Обойти в исключительном случае: `git commit --no-verify`.

## Доступность

Требования доступности обязательны наравне с функциональными: аудитория
приложения — люди в остром стрессе после катастрофы, среди них много пожилых.
Ориентир — WCAG 2.1 AA и RGAA 4.1.2 с публикуемой déclaration d'accessibilité,
состав требований в разделе 7 технического задания.
