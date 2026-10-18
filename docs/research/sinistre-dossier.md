# Research: Экран синистра как досье

**PRD**: docs/prd/sinistre-dossier.md (план фаз пишется после этого отчёта)
**Дата**: 2026-10-17

Стек — `apps/web/CLAUDE.md`. Уже решено и не переисследуется: токены и
поверхность `papier` в тёмной теме, бейдж `hero`, остаток дней из API,
тесты контраста и снимков — `docs/research/design-system.md`; общие
компоненты плана для двух режимов и параметры `/dossier` в адресе —
`docs/research/dossier-preliminaire.md`. Новых зависимостей нет.

## Решения

### Три тона бумаги без нового токена

**Решение:** лист — `data-surface="papier"` (фон `--papier`), полосы шагов —
`color-mix(in oklch, var(--papier), var(--encre) 5%)`, земля — `--fond`.
Загнутый угол и мягкая тень — CSS на контейнере листа (`DossierSheet`,
`src/components/plan/dossier-sheet.tsx`), без картинок.
**Почему:** в макете три тона, в палитре два; подмес чернил в бумагу уже
применяется в кнопке `secondary` (`button.tsx`) и наследует контраст пары
`papier`/`encre` (≥ 9:1 в обеих темах), тогда как новый токен потребовал бы
пары в `tokens.spec` и правки `design-system.md`.
**Отброшено:** `--fond` для полос — сольётся с землёй; новый токен
`papier-sombre` — третий цвет бумаги ради одного места.
**Как применять:** класс полосы — один в `PlanStepItem`; выделенная полоса
декларации — та же полоса с `border-2 border-foreground`; тесты
`tests/a11y/surface.spec.ts` уже обходят все контролы на листе в обеих
темах.

### Шапка: штемпель, хронология, бейдж

**Решение:** `DossierHeader` получает три дочерних блока: `StatusStamp`
(слово статуса из `fr.sinistres.status`, рамка с `rotate(-3deg)`, как
штемпель бейджа), `DossierTimeline` (четыре точки) и бейдж `hero`
справа на десктопе, под заголовком на 320 px (`grid` с `sm:` брейкпойнтом).
Точки хронологии и их источники:

| Точка         | `/sinistres/[id]`                                                | `/dossier`                               |
| ------------- | ---------------------------------------------------------------- | ---------------------------------------- |
| événement     | `eventDate`                                                      | `eventDate`                              |
| arrêté        | слово по `status` (attendu / publié / refusé), без даты          | `arrete.publishedAt` или «attendu»       |
| déclaration   | `declarationDate`, иначе «avant le» + `declarationDeadline.date` | `declarationDeadline.date` или «à venir» |
| indemnisation | `plannedDate` шага с якорем `DATE_ETAT_ESTIMATIF_OU_EXPERTISE`   | «à venir»                                |

**Почему:** `SinistreDetail` не несёт дату публикации arrêté (только
`arreteEntryId`), а API в фазе не меняется — слово состояния честнее
выдуманной даты; `DossierApercu` дату несёт через `ArreteCoverage`.
Точка indemnisation берётся по якорю, не по имени шага: имена — данные
шаблона.
**Отброшено:** расширение `GET /sinistres/:id` полем `arrete` — отдельное
решение через `/decision`, когда понадобится дата на экране синистра.
**Как применять:** `timelinePoints(detail | apercu)` — чистая функция в
`src/lib/dossier-timeline.ts` с тестом без браузера
(`tests/components/dossier-timeline.spec.ts`); компонент только
рисует. Текущая точка — `aria-current="step"`.

### Закладка «Étape en cours» и прогресс

**Решение:** `CurrentStep` над планом: имя шага из `nextUpcomingStep`
(`src/lib/sinistre-timeline.ts`, уже есть), текст «N étapes faites sur M»
и `<div role="progressbar" aria-valuenow={N} aria-valuemax={M}>` полосой
`petrole`. N — шаги со `status === FAIT`, M — все шаги; `NON_APPLICABLE` не
считается сделанным и не вычитается из M.
**Почему:** прогресс — мотивация, не блокировка (ТЗ § 3.4), одна формула в
одном месте; `progressbar` даёт скринридеру число без второй фразы.
**Отброшено:** `<progress>` — стилизуется плохо в обеих темах.
**Как применять:** `planProgress(steps)` рядом с `nextUpcomingStep`,
тест в `tests/components/plan.spec.ts`.

### Полосы вместо карточек, бейджи только в шапке

**Решение:** `PlanStepItem` рисует полосу: имя шага (`font-heading`),
описание, строка даты — короткая дата (`formatDateShortFr`) со словом
состояния из `fr.deadlineBadge` (en retard, aujourd'hui, demain, dernière
semaine) или объяснение ожидания (`attentePar`), `SourceNote`. Форма `row`
бейджа и её состояния удаляются из `deadline-badge.tsx`, `test-bejdz` и
`tests/components/deadline-badge.spec.ts` вместе со снимками `row`;
`deadlineBadgeState` остаётся источником слова состояния.
**Почему:** 16b принят с бейджем только в шапке; неиспользуемая форма —
мёртвый код по главному правилу; слово состояния уже локализовано и
протестировано в `deadline-badge-state.spec.ts`.
**Отброшено:** оставить `row` «на будущее».
**Как применять:** тесты `tests/sinistres/detail.spec.ts`, проверяющие
бейджи в строках, переписываются на строку даты; снимки
`etapes-{light,dark}.png` перегенерируются.

### Контейнеры, строка «Fait», отметки

**Решение:** контейнер (`kind !== ACTION`, кроме `DECLARATION`) — полоса с
описанием и текстом `fr.dossier.conteneur[kind]`, без кнопок отметки в обоих
режимах. Шаг-действие в режиме синистра несёт кнопки «Marquer comme fait» и
«Non applicable» (как сейчас); шаги `FAIT` и `NON_APPLICABLE` уходят из
списка в строку `DoneRow` под планом: «Fait · 1 имя · 2 имя» с кнопкой
«Annuler ce choix» у каждого, кроме шага декларации — его путь назад
«Effacer la date». `aria-current="step"` остаётся у ближайшего шага в
списке.
**Почему:** пустой контейнер закрыть нельзя (ТЗ § 3.4); сделанное внизу —
структура 16b, и список остаётся «что делать».
**Как применять:** `PlanList` делит шаги на открытые и закрытые одной
функцией `partitionSteps` в `sinistre-timeline.ts`; live-регион объявлений
отметки не меняется.

### Декларация внутри полосы

**Решение:** шаг `kind === DECLARATION` — единственная обведённая полоса; в
режиме синистра внутри неё форма даты из нынешней `DeclarationSection`
(поле, «Enregistrer la date», ошибки, объявления) без собственного
заголовка. Записанная дата закрывает шаг (API, research `sinistre-plan.md`
«Контракт API»), и он уходит в `DoneRow`, где его строка несёт «Fait le
<дата>» и «Effacer la date». В режиме `/dossier` — только описание и
ожидание даты.
**Почему:** дата декларации — действие этого шага (ТЗ § 3.4 после 13.10);
логика мутации уже есть, переезжает из секции в полосу без изменений.
**Как применять:** `DeclarationStrip` в `src/components/plan/`, принимает
`sinistreId` и `declarationDate`; `PlanList` отдаёт его и открытой полосе,
и строке «Fait». Шаг меняет список вместе с датой, и полоса монтируется
заново — фокус после записи и очистки ставит страница на `<li>` шага, тем же
`focusAfterMark`, что и после отметки. `sinistre-detail.tsx` теряет
`DeclarationSection`; тесты `detail.spec.ts` про дату остаются, меняется
только локатор формы.

## Ограничения и риски

- Снимки `etapes-*.png` и `hero/*` перегенерируются после правки — ревью
  смотрит их глазами, тест их только сторожит.
- На `/sinistres/[id]` точка «arrêté» без даты, пока API не отдаёт
  `publishedAt`; это ограничение экрана, не макета.
- `tests/sinistres/detail.spec.ts` — 25 тестов; часть перепишется, и это
  ожидаемая работа фазы, не повод её дробить.
