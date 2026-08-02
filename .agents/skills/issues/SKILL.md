---
name: issues
description: Создаёт GitHub milestones и issues из файла плана в docs/plan/. Использовать, когда план с фазами готов и нужно завести бэклог — «создай issues по плану», «заведи задачи в GitHub».
---

# Генератор бэклога

Прочитай план: $ARGUMENTS (файл в `docs/plan/`). Репозиторий —
`masechkacat/mon-sinistre`. Борд (Project «Mon Sinistre», workflow auto-add)
подхватывает открытые issues сам — добавлять их в проект вручную не нужно.

**Имя фичи** — имя файла плана без расширения (`docs/plan/commune-referential.md`
→ `commune-referential`). Оно входит в название каждого milestone.

## Порядок действий

1. Прочитай файл плана, выпиши фазы и задачи.
2. Проверь, что уже существует, чтобы не создавать дубли:
   `gh api repos/{owner}/{repo}/milestones --jq '.[].title'` и
   `gh issue list --state all --limit 100 --json title`.
   Существующие milestone и issue не пересоздавать — только досоздать недостающие.
3. Проверь метки (`gh label list`); недостающие создай:
   `gh label create <name> --color <hex>`.
4. Для каждой фазы создай milestone:
   `gh api repos/{owner}/{repo}/milestones -f title="[{фича}] Фаза N: {название}" -f description="Цель: {…}. Когда готова: {…}"`
5. Для каждой задачи создай issue **в порядке фаз** (нумерация issues повторит план):
   `gh issue create --title "…" --body "…" --label "…" --milestone "[{фича}] Фаза N: {название}"`
6. Выведи сводку: фаза → milestone → номера созданных issues.

## Формат issue

- **Title** — текст задачи из плана, без маркеров `- [ ]`.
- **Body** — что сделать, как проверить, и строка-ссылка:
  `План: docs/plan/{файл}.md, Фаза N`.
- **Labels** — по полю «Затрагивает» фазы: api → `backend`, web → `frontend`,
  contracts → `contracts`, db → `db`; задачи на тесты дополнительно — `tests`.
- **Milestone** — точное название milestone фазы.

## Формат milestone

`[{фича}] Фаза N: {название}` — например `[commune-referential] Фаза 3: Поиск
без учёта регистра и диакритики`.

Имя фичи в названии обязательно: milestones в репозитории общие для всех фич, и
без префикса «Фаза 1» второй фичи столкнётся с «Фазой 1» первой. Кроме того по
этому формату Ralph Loop (`.claude/ralph.js`) находит milestone по номеру фазы и
выводит имя рабочей ветки — `{фича}/phase-N`. Менять формат нельзя, не поправив
`.claude/ralph.js`.

## Правила

- Язык issues — русский; доменные термины (arrêté, veille, sinistre, NOR) — без
  перевода, как в contracts.
- В body — только то, что есть в плане; деталей реализации не выдумывать.
- Скилл идемпотентен: повторный запуск на том же плане ничего не дублирует.
