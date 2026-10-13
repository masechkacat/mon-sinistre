---
name: issues
description: Создаёт GitHub milestone и issues одной фазы из файла плана в docs/plan/. Использовать перед прогоном фазы — «создай issues фазы 3», «заведи задачи следующей фазы в GitHub».
argument-hint: '<имя-фичи> <номер фазы>'
disable-model-invocation: true
allowed-tools: Read, Bash(gh api repos/{owner}/{repo}/milestones:*), Bash(gh issue list:*), Bash(gh issue create:*), Bash(gh label list:*), Bash(gh label create:*)
---

# Бэклог одной фазы

Прочитай план: первый аргумент из $ARGUMENTS — имя файла в `docs/plan/` без
расширения, второй — номер фазы. Репозиторий — `masechkacat/mon-sinistre`.
Борд (Project «Mon Sinistre», workflow auto-add) подхватывает открытые issues
сам — добавлять их в проект вручную не нужно.

Issues заводятся **только на названную фазу**: очередь Ralph никогда не
длиннее одной фазы, и решение, принятое после планирования, правит план, а
не десяток уже открытых задач.

## Порядок действий

1. Прочитай файл плана, выпиши задачи названной фазы. Если такой фазы в
   плане нет — остановись и скажи об этом.
2. `gh issue list --state open --limit 100 --json title,milestone`: если
   открыты issues другой фазы или другой фичи — остановись и назови их:
   предыдущая фаза ещё не закрыта или её хвост не разобран.
3. Проверь, что уже существует, чтобы не создавать дубли:
   `gh api repos/{owner}/{repo}/milestones --jq '.[].title'` и
   `gh issue list --state all --limit 100 --json title`.
   Существующие milestone и issue не пересоздавать — только досоздать недостающие.
4. Проверь метки (`gh label list`); недостающие создай:
   `gh label create <name> --color <hex>`.
5. Создай milestone фазы:
   `gh api repos/{owner}/{repo}/milestones -f title="[{фича}] Фаза N: {название}" -f description="Цель: {…}. Когда готова: {…}"`
6. Для каждой задачи создай issue **в порядке плана**:
   `gh issue create --title "…" --body "…" --label "…" --milestone "[{фича}] Фаза N: {название}"`
7. Выведи сводку: milestone → номера созданных issues.

## Формат issue

- **Title** — текст задачи из плана, без маркеров `- [ ]`.
- **Body** — что сделать, как проверить, строка-ссылка
  `План: docs/plan/{файл}.md, Фаза N` и, у фазы с UI, строка
  `Макет: docs/design/{экран}.html` из плана.
- **Labels** — по полю «Затрагивает» фазы: api → `backend`, web → `frontend`,
  contracts → `contracts`, db → `db`.
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
- Скилл идемпотентен: повторный запуск на той же фазе ничего не дублирует.
