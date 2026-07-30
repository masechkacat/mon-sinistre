---
name: issues
description: Создаёт GitHub milestones и issues из файла плана в docs/plan/. Использовать, когда план с фазами готов и нужно завести бэклог — «создай issues по плану», «заведи задачи в GitHub».
---

# Генератор бэклога

Прочитай план: $ARGUMENTS (файл в `docs/plan/`). Репозиторий —
`masechkacat/mon-sinistre`. Борд (Project «Mon Sinistre», workflow auto-add)
подхватывает открытые issues сам — добавлять их в проект вручную не нужно.

## Порядок действий

1. Прочитай файл плана, выпиши фазы и задачи.
2. Проверь, что уже существует, чтобы не создавать дубли:
   `gh api repos/{owner}/{repo}/milestones --jq '.[].title'` и
   `gh issue list --state all --limit 100 --json title`.
   Существующие milestone и issue не пересоздавать — только досоздать недостающие.
3. Проверь метки (`gh label list`); недостающие создай:
   `gh label create <name> --color <hex>`.
4. Для каждой фазы создай milestone:
   `gh api repos/{owner}/{repo}/milestones -f title="Фаза N: {название}" -f description="Цель: {…}. Когда готова: {…}"`
5. Для каждой задачи создай issue **в порядке фаз** (нумерация issues повторит план):
   `gh issue create --title "…" --body "…" --label "…" --milestone "Фаза N: {название}"`
6. Выведи сводку: фаза → milestone → номера созданных issues.

## Формат issue

- **Title** — текст задачи из плана, без маркеров `- [ ]`.
- **Body** — что сделать, как проверить, и строка-ссылка:
  `План: docs/plan/{файл}.md, Фаза N`.
- **Labels** — по полю «Затрагивает» фазы: api → `backend`, web → `frontend`,
  contracts → `contracts`, db → `db`; задачи на тесты дополнительно — `tests`.
- **Milestone** — точное название milestone фазы.

## Правила

- Язык issues — русский; доменные термины (arrêté, veille, sinistre, NOR) — без
  перевода, как в contracts.
- В body — только то, что есть в плане; деталей реализации не выдумывать.
- Скилл идемпотентен: повторный запуск на том же плане ничего не дублирует.
