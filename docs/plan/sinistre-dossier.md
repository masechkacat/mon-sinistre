# Plan: Экран синистра как досье

**PRD**: docs/prd/sinistre-dossier.md
**Research**: docs/research/sinistre-dossier.md (17.10.2026) — решения там,
задачи ниже их применяют.
**Дата**: 2026-10-17

Одна фаза, web поверх существующего API; контрольная фаза харнеса
(`docs/plan/harness-v2.md`, фаза 5). Новых зависимостей и переменных
окружения нет; dev-база для `test:e2e` поднята (`npm run db:up`).

## Фаза 1: Лист досье на обоих экранах

**Цель:** `/sinistres/[id]` и `/dossier` показывают лист 16b: шапка со
штемпелем, хронологией и бейджем, закладка с прогрессом, план полосами,
строка «Fait», декларация в своей полосе.
**Затрагивает:** web
**Макет:** docs/design/sinistre.html
**Задачи:**

- [ ] Лист и полосы: `DossierSheet`, `PlanStepItem` как полоса со строкой
      даты вместо бейджа, контейнеры без кнопок отметки, строка `DoneRow`
      с закрытыми шагами и «Annuler ce choix»; форма `row` бейджа удалена из
      компонента, `test-bejdz` и тестов вместе со снимками `row`.
      **Проверяется:** `tests/components/plan.spec.ts` на `/test-plan` —
      Zero: план без закрытых шагов не рисует строку «Fait»; One: шаг `FAIT`
      стоит в строке «Fait», не в списке; Many: порядок в строке повторяет
      порядок плана; Exceptions: контейнер не имеет кнопок ни с `onMark`, ни
      без; `tests/components/deadline-badge.spec.ts` без `row`;
      `npm run test:web -- tests/a11y` зелёный.
- [ ] Шапка: `StatusStamp`, `DossierTimeline` из `timelinePoints`,
      бейдж `hero` в сетке шапки на обоих экранах.
      **Проверяется:** `tests/components/dossier-timeline.spec.ts` без
      браузера — Zero: синистр без arrêté и декларации даёт «attendu», «avant
      le <дедлайн>» или «à venir», «à venir»; One: `declarationDate` замещает
      дедлайн; Many: точка indemnisation берёт шаг по якорю
      `DATE_ETAT_ESTIMATIF_OU_EXPERTISE`, не по имени; Boundaries: аперçу с
      `arrete` даёт дату публикации; `detail.spec.ts` — штемпель содержит слово
      статуса, в шапке ровно один `[data-form=hero]`, в `<ol>` плана бейджей
      нет.
- [ ] Закладка «Étape en cours»: `CurrentStep` с `planProgress`.
      **Проверяется:** `tests/components/plan.spec.ts` — Zero: ни одного
      `FAIT` → «0 étapes faites sur M»; One: одна отметка → N растёт на один и
      закладка называет следующий шаг; Boundaries: `NON_APPLICABLE` не
      считается сделанным и не уменьшает M; Interface: `role="progressbar"` с
      `aria-valuenow`/`aria-valuemax`; `detail.spec.ts` — отметка «fait»
      через `PATCH` обновляет закладку и строку «Fait».
- [ ] Декларация в полосе: `DeclarationStrip` вместо `DeclarationSection`,
      «Fait le <дата>» и «Effacer la date» после ввода; `/dossier` — полоса в
      режиме чтения.
      **Проверяется:** `detail.spec.ts` — существующие сценарии даты
      (ввод, стирание, сбой, перечитывание) проходят с новым локатором;
      Interface: после ввода в полосе текст «Fait le» и кнопка «Effacer la
      date», поля ввода нет; `tests/dossier` — на `/dossier` формы нет;
      `npm run test:e2e` зелёный.

**Когда готова:** автоматическая приёмка `verificationCommands` в
`.claude/ralph.config.json` зелёная, снимки `etapes-{light,dark}.png` и
`hero/*` актуальны; `/ui-review` чисто на `/sinistres/[id]` и `/dossier`
на 320 px и при 200 % масштабе в обеих темах.
