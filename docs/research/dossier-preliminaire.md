# Research: Предварительное досье без аккаунта

**PRD**: docs/prd/dossier-preliminaire.md (план фаз пишется после этого отчёта)
**Дата**: 2026-10-10

Новых npm-зависимостей и переменных окружения фича не требует ни одной:
всё нужное — `@nestjs/throttler` 6.7 (глобальный лимит уже стоит), Base UI
`Combobox` (выбор коммуны), TanStack Query 5, `@nestjs/schedule` (чистка
уже есть) — установлено и в работе. Решения ниже опираются на принятые
отчёты: `sinistre-plan.md` (привязка entry ↔ синистр, шаблон плана, контракт
`/sinistres`), `user-account.md` (регистрация, подтверждение, сессия на
клиенте), `veille-subscription-lifecycle.md` (подписка и её лимиты),
`design-system.md` (бейдж, поверхность papier), `web-foundation.md` (слой
API, тесты). Они не переисследуются.

## Решения

### Публичные эндпоинты: модуль `src/dossier/`, два `GET`, без записи

**Решение:** новый модуль `src/dossier/` с контроллером под `@Public()` на
классе (как `CommunesController`) и двумя эндпоинтами:

| метод и путь                                        | ответ            |
| --------------------------------------------------- | ---------------- |
| `GET /dossier/arretes?codeInsee=`                   | `CommuneArretes` |
| `GET /dossier/apercu?codeInsee=&risque=&eventDate=` | `DossierApercu`  |

Оба — чистое чтение: ни одной строки в базе, ни одного письма (критерий PRD
«не создают записей»). `SinistresModule` остаётся целиком за `JwtAuthGuard`
(его докблок «No `@Public()` anywhere» не нарушается).
**Почему:** у двух публичных эндпоинтов один предмет — досье до аккаунта —
и одна аудитория (главная и страница досье); класть их в `communes/`
(справочник) или `sinistres/` (закрытый ресурс) размыло бы границы обоих.
Модуль **не заводит второй логики**: сопоставление arrêté, снапшот шагов,
расчёт срока и статусов он импортирует из `sinistres/` и `deadline-rules/`
(ниже).
**Отброшено:** `GET /communes/:code/arretes` в `CommunesModule` — модулю
справочника пришлось бы зависеть от `DeadlineRuleService` и `classifyRisques`;
серверный рендер страницы досье в Next с прямым чтением базы — у web нет
доступа к базе и не будет.
**Как применять:** DTO query с теми же валидаторами, что `CreateSinistreDto`
(`@Length(INSEE_CODE_LENGTH)`, `@IsEnum(RisqueCatnat)`,
`@IsNotFutureIsoDate`) — для `apercu` переиспользовать сам класс
`CreateSinistreDto` как тип query (`@Query() dto: CreateSinistreDto`), второй
копии правил не заводить. Неизвестная коммуна — `400` с
`fr.sinistres.unknownCommune`, как у `create`; клиент на `400` показывает
форму недостающих полей, не экран ошибки.

### Ответ по коммуне: окно 12 месяцев, преемник, срок у каждого arrêté

**Решение:** `GET /dossier/arretes` отдаёт:

```ts
interface CommuneArrete {
  arreteEntryId: string;
  nor: string;
  publishedAt: IsoDate;
  legifranceUrl: string;
  /** Как напечатано в annexe. */
  risqueLabel: string;
  /** `classifyRisques(risqueLabel)` — одно значение почти всегда. */
  risques: RisqueCatnat[];
  eventStart: IsoDate;
  eventEnd: IsoDate;
  outcome: ArreteEntryOutcome;
  /** Только для RECONNU; null — правило не резолвилось. */
  declarationDeadline: DeclarationDeadline | null;
}
interface CommuneArretes {
  commune: Commune;
  arretes: CommuneArrete[]; // publishedAt desc
}
```

Окно — `COMMUNE_ARRETES_WINDOW_MONTHS = 12` в contracts (продуктовое число,
`SourceReference` не нужен): `arrete.publishedAt >= today − 12 мес` по
`todayInParis()`. Коммуна-преемник: entries ищутся по множеству кодов
`{code} ∪ {предшественники}`, где предшественники — ключи `loadSuccessorMap`,
для которых `resolveCurrentCode(key) === code` (инверсия той же карты, что
использует `matchSinistres`).

> Расхождение с реализацией (11.10.2026): карта целиком остаётся у
> `matchSinistres` и монитора; `codesMergedInto` (`src/communes/`) собирает
> только рёбра, ведущие к `code`, обходом `successorCodeInsee` назад по хопам
> по частичному индексу `Commune(successorCodeInsee)` (data-model § 3), и
> фильтрует их тем же `resolveCurrentCode`.

Срок декларации —
`DeadlineRuleService.resolveActive(DECLARATION_ASSUREUR_CODE,
'DATE_PUBLICATION_ARRETE', publishedAt)` → `resolveDeadline` →
`daysBetween(today, date)` → `toSourceReference` — все четыре уже есть;
`daysLeft < 0` клиент показывает как «délai expiré», числа не печатает.
**Почему:** entry, а не arrêté, — единица ответа: один arrêté называет
коммуну отдельно по каждому риску и периоду, и у каждой строки свой исход
(тот же довод, что у `subtractCoveredEntries`). Срок считается здесь, а не
копируется откуда-то: у публичного ответа нет `Step`, из которого
`declarationDeadlineOf` его читает.
**Отброшено:** отдельная таблица или кеш «arrêtés по коммуне» — запрос по
индексу дешевле любого кеша; фильтр «только с неистёкшим сроком» — это
переключатель из PRD карты, не этой фичи.
**Как применять:** миграция добавляет индекс `ArreteEntry(codeInsee)`:
существующий unique начинается с `arreteId` и выборке по коммуне не служит
(та же логика отложенного индекса, что у `Sinistre(codeInsee, status)` в
data-model § 5 — заводит фаза, которая пишет запрос). `data-model.md` § 4 —
тем же коммитом. Кнопка досье у entry с **несколькими** `risques` (JO иногда
печатает «inondations, coulées de boue et mouvements de terrain») ведёт на
страницу досье без `risque`, и та просит выбрать из перечисленных — тот же
экран недостающих полей, что для «Préparer mon dossier». Пустой `risques`
(формулировка, которой `classifyRisques` ещё не знает; монитор о ней уже
алертит) ведёт туда же, выбор — из всего `RisqueCatnat`: подставлять полный
перечень на сервере нельзя, иначе клиент не отличит «не распознано» от
«все риски».

### Аперçu досье: виртуальный синистр из тех же функций, что `create`

**Решение:** `DossierService.apercu({ codeInsee, risque, eventDate })`
повторяет путь `SinistresService.create` до слова `prisma.sinistre.create`
и останавливается: `matchArrete` → `anchorDatesOf` → `buildStepSnapshot` на
каждом шаблоне → `sinistreStatus({ current: null, link, declarationDate:
null })`. Для этого приватный `SinistresService.matchArrete` выносится в
экспортируемую функцию `matchArreteFor(prisma, { codeInsee, risque,
eventDate })` (`src/sinistres/match-arrete.ts`), которую зовут оба сервиса;
`resolveRule` — так же в `src/sinistres/resolve-step-rule.ts`. Ответ:

```ts
interface DossierApercu {
  commune: Commune;
  risque: RisqueCatnat;
  eventDate: IsoDate;
  status: SinistreStatus; // AVANT_ARRETE | ARRETE_PUBLIE | ARRETE_REFUSE
  arrete: {
    // null = attendu
    publishedAt: IsoDate;
    legifranceUrl: string;
    outcome: ArreteEntryOutcome;
    eventStart: IsoDate;
    eventEnd: IsoDate;
  } | null;
  steps: StepView[];
  declarationDeadline: DeclarationDeadline | null;
}
```

`StepView` — поля `Step` без идентичности и отметок (`name`, `description`,
`kind`, `anchor`, `plannedDate`, `status`, `daysLeft`, `delay`, `source`,
`order`); в contracts `Step extends StepView` — чистый рефакторинг типа, ни
одно существующее поле не меняется. `toStepResponse` в `to-sinistre-detail.ts`
делится на `toStepView(row, today)` (общая часть) и обёртку с `id`,
`sinistreId`, `completedAt`, `fromTemplate`; `declarationDeadlineOf`
принимает `StepView`-совместимый ряд, поэтому срок аперçu считается той же
функцией, что у синистра.
**Почему:** критерий PRD «одной логикой» выполняется буквально: у публичного
расчёта нет ни одной своей формулы — только вызовы тех же функций без
финальной записи. Виртуальный `id` в ответе не выдумывается: `SinistreDetail`
с фальшивым `id` соврал бы клиенту, что ресурс существует.
**Отброшено:** `POST /sinistres?dryRun` — запись и чтение под одним
маршрутом с разной авторизацией; сохранение аперçu в базе «на всякий случай»
— прямо запрещено PRD.
**Как применять:** `arrete.eventStart/eventEnd` нужны странице для границ
уточнения даты; при `arrete !== null` страница ставит `min`/`max` на
`<input type="date">`. Правило «дата события в пределах периода» проверяет
только клиент: сервер считает любую непустую дату, и человек, знающий, что
ущерб был на день раньше периода, не блокируется — ему просто не найдётся
arrêté, и страница скажет «attendu».

### Ограничение частоты: глобальный лимит throttler, без новых правил

**Решение:** оба публичных `GET` остаются под `GLOBAL_RATE_LIMIT` (100 запросов
в минуту с IP, `TokenThrottlerGuard` как `APP_GUARD`) без `@Throttle` на
маршрутах.
**Почему:** стоимость запроса — три-четыре индексированных выборки и чистые
функции, писем нет; более жёсткие лимиты в проекте стоят только там, где
запрос тратит чужой ресурс (письмо, bcrypt). Отдельный лимит пришлось бы
обосновывать числом, которого нет.
**Отброшено:** `@fastify/rate-limit` — вторая реализация того же; кеш
ответов — преждевременно.
**Как применять:** ничего; `test/helpers/throttler.ts` уже умеет обходить
лимит в int-спеках. Риск по IP за прокси — в «Ограничениях».

### Вид шага: enum `StepKind` в contracts, Prisma и шаблоне, бэкфилл копий

**Решение:** `enum StepKind { ACTION, PHOTOS, JUSTIFICATIFS, OBJETS,
DECLARATION }` в contracts и Prisma; колонка `kind StepKind @default(ACTION)`
у `StepTemplate` и у `Step` (снапшот копирует её в `buildStepSnapshot`).
Seed `CATNAT`: order 1 «Photographier et filmer» → `PHOTOS`, 5 «Rassembler
les factures et justificatifs» → `JUSTIFICATIFS`, 7 «Déclarer le sinistre» →
`DECLARATION`, 9 «Transmettre l'état estimatif» → `OBJETS`; остальные —
`ACTION`. Миграция бэкфиллит `Step.kind` у строк `fromTemplate = true` по
`"order"` теми же четырьмя значениями.
**Почему:** один enum вместо пары «вид + подвид»: контейнеров ровно четыре
(ТЗ § 3.4), и каждому нужна своя подпись и своё будущее наполнение — второй
колонки не на что опереться. Бэкфилл — осознанное исключение из «копия плана
не пересчитывается»: `kind` не дата и не статус, это тождество шага; без
бэкфилла синистры, заведённые до этой миграции, не получили бы контейнеров,
когда придут файлы и инвентарь.
**Отброшено:** вычислять вид по `order`/имени на чтении — тот же бэкфилл, но
навсегда и в коде; `planKey`-вариант шаблона — контейнеры не вариант плана, а
свойство шага.
**Как применять:** `data-model.md` § 3 (StepTemplate) и § 5 (Step) — тем же
коммитом; `seedStepTemplates` идемпотентен (upsert по `(planKey, order)`),
`kind` входит в `update`. На экране синистра `kind` в этой фиче **не меняет
поведения**: кнопки отметки остаются у всех шагов (PRD). На странице досье
шаг с `kind !== ACTION` рендерится пустым контейнером с подписью из
`fr.dossier.conteneur[kind]` и без кнопок.

### Три параметра до подтверждения: таблица `DossierEnAttente`

**Решение:** `POST /auth/register` принимает необязательное вложенное
`dossier: { codeInsee, risque, eventDate }` (`@ValidateNested` +
`@Type(() => CreateSinistreDto)` — тот же класс валидаторов). Хранение —
новая таблица:

| колонка   | тип                         |
| --------- | --------------------------- |
| userId    | uuid PK → User, **cascade** |
| codeInsee | text → Commune, restrict    |
| risque    | enum RisqueCatnat           |
| eventDate | date                        |
| createdAt | timestamptz                 |

Ветки `register`: новый адрес — вставка; неподтверждённый адрес — `upsert`
(последняя форма побеждает, как и пароль); подтверждённый адрес — строка не
трогается, ответ `204` неотличим (anti-enumeration PRD user-account).
`POST /auth/confirmation` при переходе в `confirmed` в той же транзакции
читает строку, создаёт синистр через `SinistresService.create` и удаляет
строку; ответ расширяется до `{ status, sinistreId?: string }`. Та же
обвязка (`drainPendingDossier(tx, userId)`) вызывается в ветке
`resetPassword`, которая подтверждает ещё не подтверждённый аккаунт.
Чистка — каскадом с `User` в существующем `cleanupExpired`
(`expiredUnconfirmed`), отдельного прогона не нужно.
**Почему:** 1:1-таблица с каскадом держит инвариант «все три поля или
ничего» схемой, а не тремя nullable-колонками на `User`; удаляется вместе с
неподтверждённым аккаунтом автоматически (критерий «удалена через 7 дней»).
Создание при подтверждении, а не при первом входе: пользователь известен
уже здесь, и входа может не быть неделю.
**Отброшено:** параметры в ссылке подтверждения — подпись ссылки не
покрывает их, и письмо с коммуной и датой в URL оседает в логах почтовых
систем; `sessionStorage` — не переживает смену браузера и устройства, а
письмо открывают с телефона; создавать синистр до подтверждения — сирота в
базе у несуществующего человека.
**Как применять:** `AuthModule` импортирует `SinistresModule` (у того нет
зависимости на auth — цикла нет). `data-model.md` § 5 и § 7 — тем же
коммитом. У `GET /auth/me` ничего не меняется.

### Создание с защитой от двойника: `POST /sinistres` с `confirmNew`

**Решение:** `CreateSinistreDto` получает `confirmNew?: boolean`.
`SinistresService.create` перед записью читает синистры пользователя с теми
же `codeInsee` и `risque`:

- есть с той же `eventDate` → возвращается существующий, контроллер отвечает
  `200` (не `201`);
- есть с другой датой и `confirmNew` не задан → `409` с телом
  `{ code: 'DOSSIER_EXISTANT', existing: { id, eventDate } }`
  (`SinistreConflict` в contracts); с `confirmNew: true` — создаётся новый;
- иначе — `201`, как сегодня.

**Почему:** правило живёт в единственной точке создания и достаётся
бесплатно форме `/sinistres/nouveau` и созданию из аперçу; для перехода
«подтверждение → создание» конфликт невозможен (у нового аккаунта синистров
нет), и та же функция просто создаёт. `409` — осознанный, с телом, не из
`P2002` (правило `apps/api/CLAUDE.md`): уникального индекса нет и не нужно,
два синистра с разными датами законны.
**Отброшено:** отдельный `GET /sinistres?codeInsee&risque` «проверить
заранее» — две поездки и гонка между ними; unique `(userId, codeInsee,
risque)` — запрещает законный второй дом.
**Как применять:** чтение и запись — в одной транзакции (образец
`updateStep`); тело `409` содержит только id и дату — данные самого
пользователя. Клиент: `ApiError` со статусом `409` и телом конфликта →
экран с двумя кнопками, «créer» повторяет запрос с `confirmNew: true`.

> Реализация отличается: «та же коммуна» — с коммунами, слившимися в неё
> (`codesMergedInto`); проверка идёт до построения плана и повторяется под
> `withAdvisoryLock` по пользователю — одной транзакции на READ COMMITTED
> мало, два одновременных запроса создавали два досье.

### Web: страница `/dossier`, параметры в адресе, один компонент плана

**Решение:** клиентская страница `/dossier?commune=&risque=&date=`
(`useSearchParams` под `<Suspense>`, как страницы с токеном);
`useQuery(queryKeys.dossierApercu(params))` через `apiFetch` (публичный).
Три параметра разбирает и собирает один хелпер `src/lib/dossier-params.ts`
(парсинг из `URLSearchParams`, сериализация в query, проверка `isIsoDate` и
`RisqueCatnat`); его же используют `/inscription` и `/connexion`, чтобы
параметры пережили переходы. Неполные или отклонённые сервером параметры →
на той же странице форма недостающего (`CommuneSelect`, `RadioGroup` риска,
`<input type="date">` — компоненты из `/sinistres/nouveau`), отправка —
`router.replace` с полным адресом. С `arrete !== null` дата не
спрашивается: поле даты показывается заполненным первым днём периода с
`min`/`max` периода.

Экран синистра `sinistre-detail.tsx` (407 строк, всё в одном файле) делится
на презентационные компоненты в `src/components/plan/`: `DossierEntete`
(H1, статус, даты), `DeclarationDeadlineBlock`, `PlanList` (`<ol>`) и
`PlanStepItem`, принимающие `StepView` и **необязательные** колбэки
`onMark`; без колбэков компонент — режим чтения: кнопок нет, контейнер пуст с
подписью. `/sinistres/[id]` и `/dossier` собирают экран из них; второй
вёрстки плана не появляется.
**Почему:** PRD требует ту же раскладку по турам 13g и 14 в двух режимах —
единственный способ не разойтись это один компонент и режим по наличию
действий. Параметры в адресе — требование PRD («адрес и есть сохранение»).
**Отброшено:** серверный компонент для страницы досье — публичный запрос
без сессии можно было бы сделать на сервере Next, но форма недостающих
полей и уточнение даты всё равно клиентские, а SEO не в скоупе; дублировать
`StepItem` «для публичного режима» — прямое нарушение главного правила.
**Как применять:** `tests/support/pages.ts` получает `/dossier` с
`mockApi` на `GET /dossier/apercu**` (как у `veilleConfirmation`) — общие
сьюты axe, reflow и reduced-motion покрывают страницу даром; состояния
(attendu / publié / refusé / expiré / недостающие поля) — свой спек
`tests/dossier/`. «Enregistrer ce dossier»: если `getAccessToken()` или
`refreshSession()` дают сессию — `createSinistre` сразу (с обработкой `409`
выше) и переход на `/sinistres/[id]`; иначе `router.push` на
`/inscription?commune=&risque=&date=`.

### Web: регистрация и вход с параметрами, `suivant` после входа

**Решение:** `/inscription` читает `dossierParams` из адреса, показывает их
над формой строкой «Votre dossier : Inondation · Nîmes · 13 septembre» и
отправляет `dossier` в `POST /auth/register`; ссылка «Déjà un compte ? Se
connecter» переносит те же параметры в `/connexion`. `/connexion` после
успешного входа: если параметры есть — `createSinistre` с обработкой `409`
и переход на синистр; если есть `suivant` — переход на него; иначе
`/espace-personnel`, как сегодня. Страница подтверждения при `sinistreId` в
ответе ведёт ссылкой «Se connecter» на `/connexion?suivant=/sinistres/<id>`.
`suivant` принимается только как относительный путь, начинающийся с `/` и не
с `//` — иначе игнорируется.
**Почему:** подтверждение не открывает сессию (решение user-account: кнопка
подтверждает, вход отдельно), поэтому «страница подтверждения ведёт на
экран синистра» выполняется через вход с возвратом. Open redirect через
`suivant` закрывается проверкой формы пути, не списком.
**Отброшено:** автоматический вход при подтверждении — меняет модель
сессии user-account ради одного перехода; хранить `sinistreId` в cookie —
второй носитель.
**Как применять:** `LOGIN_PATH` остаётся в `session.ts`; имя параметра —
константа рядом (`LOGIN_NEXT_PARAM = 'suivant'`), не строка по компонентам.

### Web: главная — поле коммуны, блок ответа, строка подписки; `/veille` уходит

**Решение:** главная становится клиентским экраном `CommuneReponse`:
`CommuneSelect` (одиночный, уже есть) → при выборе
`useQuery(queryKeys.communeArretes(code))` на `GET /dossier/arretes` → блок
ответа `ReponseCommune` в `src/components/reponse-commune.tsx` — список
entries карточками (риск, период, дата публикации, ссылка Légifrance, срок
декларации бейджем `DeadlineBadge form="row"` или «délai expiré», отказ —
словами) с кнопкой-ссылкой `Link` на `/dossier?...` у каждой, либо «aucun
arrêté récent» с кнопкой «Préparer mon dossier» (`/dossier?commune=`);
под списком — `VeilleInlineForm` (email + кнопка), которая зовёт тот же
`POST /veille` с `communeCodes: [code]`. Мутация подписки и валидация email
выносятся из `veille-form.tsx` в `src/lib/api/veille.ts`
(`subscribeVeille`) рядом с `unsubscribeVeille`. Страница `/veille`
(`page.tsx`, `veille-form.tsx`) и её спек удаляются; в `next.config.ts` —
`redirects: [{ source: '/veille', destination: '/', permanent: true }]`;
подстраницы `/veille/confirmation`, `/veille/desinscription/*`,
`/veille/changement` не трогаются (на них ссылаются письма через константы
contracts). Объясняющий текст главной остаётся ниже блока; раздел «Et
ensuite ?» удаляется — его первый шаг и есть поле.
**Почему:** блок ответа — тот же, что станет попапом коммуны на карте (PRD
карты, «suivre cette commune»), поэтому он отдельный компонент с пропсом
`commune`, а не часть страницы. Редирект, а не 404: адрес мог быть сохранён
в закладках и опубликован.
**Отброшено:** второе поле коммуны для подписки — коммуна уже выбрана;
модальное окно для ответа — на 360 px список под полем читается без
диалога и без focus trap.
**Как применять:** `tests/support/pages.ts`: `home` получает `mockApi` на
`GET /dossier/arretes**` только в спеке главной (общие сьюты открывают
главную без выбора коммуны — запросов нет). Анонс результата — заранее
смонтированный `role="status"` («N arrêtés trouvés pour Nîmes»). Кнопка
досье — `size="touch"` (главное действие экрана).

### Web: шапка с состоянием сессии

**Решение:** в `layout.tsx` рядом с названием — клиентский `SessionNav`:
на монтировании один `refreshSession()` (общий in-flight promise, второго
запроса рядом с guard'ом страницы не будет) и подписка на изменение токена;
`session.ts` получает `subscribeAccessToken(listener)` — `setAccessToken` и
`clearAccessToken` оповещают. Без сессии — ссылка «Se connecter»
(`LOGIN_PATH`), с сессией — «Mon espace» (`/espace-personnel`). Пока ответ
не пришёл — «Se connecter» (не пустота: ссылка верна в обоих состояниях,
а на странице входа вошедшего встречает его же кабинет).
**Почему:** одна попытка refresh на загрузку страницы — цена, которую
user-account уже принял за память вместо localStorage; анонимный посетитель
получает `401` за миллисекунды. Подписка на модуль, а не контекст React —
`session.ts` уже модульное состояние по решению user-account.
**Отброшено:** middleware Next — cookie API ему не видна (user-account);
показывать обе ссылки — две двери вместо одной.
**Как применять:** спек шапки — `mockSession` из `tests/support/`
(`install()` даёт 200 на refresh), проверка обеих ссылок; `nav`
с `aria-label` (`fr.layout.mainNav`), skip-link остаётся первым.

### Contracts

**Решение:** в `@mon-sinistre/contracts`: `StepKind`; `StepView` и `Step
extends StepView`; `DossierApercu`, `CommuneArretes`, `CommuneArrete`;
`SinistreConflict`; `COMMUNE_ARRETES_WINDOW_MONTHS = 12`;
`AccountConfirmationResponse.sinistreId?`; тип тела регистрации с
`dossier?`; `CreateSinistreInput.confirmNew?`. Путь `/dossier` в contracts не
попадает: на него не ссылается ни одно письмо — он живёт в web рядом с
`LOGIN_PATH`.
**Почему:** правило проекта — типы и пороги один раз; тексты UI в contracts
не попадают.

### Тесты (ТЗ § 9, критерии PRD)

**Решение:**

- API unit: `match-arrete.spec.ts` (вынос — поведение `create` не меняется),
  `to-sinistre-detail.spec.ts` расширяется на `toStepView`, `step-template.seed`
  — четыре контейнера помечены, остальные `ACTION`.
- API int: `test/integration/dossier/` — `arretes` (окно 12 месяцев:
  13-й месяц не виден; преемник; `REFUSE` назван; срок у `RECONNU`;
  несколько рисков у entry), `apercu` (attendu / publié / refusé /
  expiré; `count()` по `Sinistre`, `Step`, `VeilleFormEmail`, `MailLog`
  до и после — нули разницы); `sinistres` — три случая двойника;
  `auth` — регистрация с `dossier` + подтверждение создаёт синистр и чистит
  `DossierEnAttente`; `cleanupExpired` уносит строку каскадом; подтверждённый
  адрес с `dossier` отвечает `204` и ничего не пишет.
- Web (`test:web`, моки): главная (ответ по коммуне в трёх состояниях,
  строка подписки), `/dossier` (четыре состояния, недостающие поля,
  контейнеры пусты, одна кнопка), шапка (обе ссылки), редирект `/veille`,
  `/connexion?suivant=` с чужим хостом игнорируется.
- E2E (`test:e2e`): `parcours-sinistre.spec.ts` дополняется вторым
  сценарием «главная → коммуна → aucun arrêté → Préparer mon dossier →
  Enregistrer → inscription с параметрами → подтверждение → вход →
  синистр с теми же полями»; сев e2e (`e2e-referential.ts`) получает один
  arrêté `RECONNU` для сценария «publié» (хелпер `arrete.ts` уже есть).

**Почему:** критерии PRD машинно-проверяемы ровно в этих слоях; сквозной
путь — единственное место, где проверяется, что три параметра пережили
регистрацию, письмо и вход.

## Ограничения и риски

- **IP за прокси.** `@nestjs/throttler` считает по `req.ip`; за reverse
  proxy без `trustProxy` у `FastifyAdapter` все посетители — один IP, и
  глобальный лимит в 100/мин закроет сайт первому же наплыву. Это уже
  относится к `/communes` и `/veille`, фича лишь добавляет два публичных
  маршрута; решается настройкой адаптера при деплое (`new
FastifyAdapter({ trustProxy: true })` за своим прокси), деплой по слову
  владельца.
- **Окно 12 месяцев** считается от `todayInParis()` арифметикой месяцев
  `resolveDeadline(today, -12, 'MONTHS')` — та же функция, что у сроков
  страховщика, конец февраля обрабатывается ею.
- **Entry с несколькими рисками** (редкая формулировка JO) даёт на главной
  одну карточку и одну кнопку, выбор риска переносится на страницу досье;
  если окажется частым — карточка на риск, решение фазы.
- **Бэкфилл `Step.kind`** — единственное место, где миграция трогает копии
  планов; `data-model.md` § 5 фиксирует это исключение явно, чтобы следующая
  миграция не сочла его прецедентом для дат.
- **Ветка «подтверждённый адрес + dossier»** молча отбрасывает параметры
  (anti-enumeration важнее); человек с аккаунтом, забывший о нём, получит
  письмо «у вас уже есть аккаунт», войдёт — и параметров у него не будет.
  Сценарий PRD «есть аккаунт, не вошёл» покрыт ссылкой «Se connecter» с
  параметрами до отправки формы; после отправки они теряются осознанно.
- **Логи**: `AllExceptionsFilter` уже режет query string (`request.url.split('?')`),
  Fastify-логгер выключен; новый модуль ничего не логирует кроме
  `resolveRule` (код правила и якорь — не персональные данные). Проверяется
  существующим спеком фильтра, дополнительного механизма не нужно.
- **Удаление `/veille`** ломает внешние ссылки на форму, если они где-то
  опубликованы, — редирект на главную это покрывает; `fr.veille.page.*` и
  спек формы уходят вместе со страницей, строки, общие с подстраницами
  (`fr.veille.confirmation.*`), остаются.
- **`Step extends StepView`** меняет только декларацию типа; сборка web и
  API против contracts проверяет это компилятором, но спеки web, сравнивающие
  объекты `Step` целиком с фикстурами, получат новое поле `kind` — фикстуры
  обновить в той же фазе.
