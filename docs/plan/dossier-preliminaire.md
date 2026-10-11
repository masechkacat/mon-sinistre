# Plan: Предварительное досье без аккаунта

**PRD**: docs/prd/dossier-preliminaire.md
**Research**: docs/research/dossier-preliminaire.md (10.10.2026). Технические
решения (публичный модуль `src/dossier/`, аперçу из функций `create`,
`StepKind`, `DossierEnAttente`, `409` двойника, страница `/dossier`, общие
компоненты плана, главная с полем коммуны, шапка с сессией) приняты там;
задачи ниже их применяют, а не перевыбирают. Отступления реализации
фиксируются врезкой «Исправлено при реализации» в самом отчёте.
**Дата**: 2026-10-10

Новых зависимостей и переменных окружения нет; предусловий владельца до
автономного прогона — ни одного.

## Фаза 1: Аперçу досье отдаётся без аккаунта (Tracer Bullet)

**Цель:** сквозной путь contracts → база → API: `GET /dossier/apercu` по
коммуне, риску и дате отдаёт план с теми же датами, статусом и сроком, что
получил бы созданный синистр, — и не пишет ни строки. Шаблон знает, какой
шаг контейнер.
**Затрагивает:** contracts, db, api
**Задачи:**

- [ ] Contracts: `enum StepKind { ACTION, PHOTOS, JUSTIFICATIFS, OBJETS,
    DECLARATION }`; `StepView` (`name`, `description`, `kind`, `anchor`,
      `plannedDate`, `status`, `daysLeft`, `delay`, `source`, `order`) и
      `Step extends StepView`; `DossierApercu` по research; `SinistreConflict`;
      `COMMUNE_ARRETES_WINDOW_MONTHS = 12` с докблоком «продуктовое число».
      **Проверяется тестами (до кода):** `npm run build:contracts` — API и
      web собираются; существующие спеки web с фикстурами `Step` получают
      `kind` и остаются зелёными.
- [ ] Миграция `add_step_kind`: enum Prisma `StepKind`, колонка `kind` с
      `@default(ACTION)` у `StepTemplate` и `Step`, бэкфилл `Step.kind` у
      `fromTemplate = true` по `"order"` ∈ {1 → PHOTOS, 5 → JUSTIFICATIFS,
      7 → DECLARATION, 9 → OBJETS}, индекс `ArreteEntry(codeInsee)`.
      `data-model.md` §§ 3, 4, 5 — тем же коммитом, с явной врезкой про
      исключение бэкфилла. **Проверяется тестами (до кода):** schema
      int-spec — синистр с шагами, созданный до миграции (сырой `INSERT` без
      `kind`), после неё имеет `PHOTOS` на шаге 1 и `ACTION` на шаге 2;
      `StepTemplate` без `kind` вставляется как `ACTION`.
- [ ] Seed: `STEP_TEMPLATE_SEED` получает `kind` у четырёх шагов, upsert
      обновляет колонку; `buildStepSnapshot` копирует `kind`.
      **Проверяется тестами (до кода):** `step-template.seed.spec.ts` —
      ровно четыре шага с `kind !== ACTION`, по одному на каждое из четырёх
      значений, остальные девять — `ACTION`; повторный seed идемпотентен;
      `build-step-snapshot.spec.ts` — `kind` шаблона попадает в снапшот.
- [ ] Вынос общих частей из `SinistresService`: `matchArreteFor(prisma,
    { codeInsee, risque, eventDate })` в `src/sinistres/match-arrete.ts`,
      `resolveStepRule` в `src/sinistres/resolve-step-rule.ts`,
      `toStepView(row, today)` в `to-sinistre-detail.ts` (обёртка
      `toStepResponse` добавляет `id`, `sinistreId`, `completedAt`,
      `fromTemplate`); `declarationDeadlineOf` принимает ряд `StepView`.
      **Проверяется тестами (до кода):** существующие int-спеки
      `sinistres` зелёные без правок (поведение `create` не меняется);
      `to-sinistre-detail.spec.ts` — `toStepView` без `id` даёт те же
      `status`/`daysLeft`/`source`, что `toStepResponse`.
- [ ] Модуль `src/dossier/`: `DossierController` под `@Public()` на классе,
      `GET /dossier/apercu` с `@Query() dto: CreateSinistreDto`,
      `DossierService.apercu` по research (match → anchorDates → snapshot →
      `sinistreStatus`, без `prisma.sinistre.create`); `CLAUDE.md` модуля.
      **Проверяется тестами (до кода):**
      `test/integration/dossier/apercu.int-spec.ts` — Z: коммуна без arrêté
      → `status: AVANT_ARRETE`, `arrete: null`, `declarationDeadline: null`,
      шаги `DATE_PUBLICATION_ARRETE` без `plannedDate`; O: entry `RECONNU`
      с периодом, покрывающим дату, → `ARRETE_PUBLIE`, `arrete.publishedAt`,
      `declarationDeadline.date` = публикация + 30 дней по правилу
      `DECLARATION_ASSUREUR`, `daysLeft` отрицателен для публикации два
      месяца назад; M: `RECONNU` и `REFUSE` за один период → `RECONNU`;
      только `REFUSE` → `ARRETE_REFUSE` без срока; B: дата = `eventEnd`
      входит, `eventEnd + 1` — нет; коммуна со старым кодом INSEE находит
      entry преемника; I: четыре контейнера несут свой `kind`, в ответе нет
      `id`; E: неизвестная коммуна → `400`, дата в будущем → `400`, риск вне
      enum → `400`, запрос без `Authorization` → `200`; `count()` по
      `Sinistre`, `Step`, `MailLog` до и после запроса равны.

**Когда готова:** `GET /dossier/apercu?codeInsee=30189&risque=INONDATION&eventDate=…`
без токена отвечает планом с теми же датами, что `POST /sinistres` тем же
пользователем через секунду, а таблицы `Sinistre` и `Step` после него пусты.

## Фаза 2: Ответ по коммуне

**Цель:** `GET /dossier/arretes` отдаёт arrêtés коммуны за 12 месяцев с
исходом, периодом, ссылкой и сроком декларации у каждого — данные блока
ответа главной и будущего попапа карты.
**Затрагивает:** contracts, api
**Задачи:**

- [ ] Contracts: `CommuneArrete`, `CommuneArretes` по research.
      **Проверяется тестами (до кода):** `npm run build:contracts`.
- [ ] `src/communes/codes-merged-into.ts`: `codesMergedInto(prisma, code)` —
      `code` и его предшественники (research, врезка 11.10.2026).
      **Проверяется тестами (до кода):**
      `codes-merged-into.spec.ts` — Z: код без предшественников → `[code]`;
      O: одно слияние; M: цепочка A → B → C даёт для C все три, запрос на
      хоп; цикл в справочнике не зацикливает и даёт `[code]`.
- [ ] `DossierService.arretes(codeInsee)` и `GET /dossier/arretes`: entries
      по `{code} ∪ predecessors` с `arrete.publishedAt ≥ resolveDeadline(today,
    -COMMUNE_ARRETES_WINDOW_MONTHS, 'MONTHS')`, сортировка `publishedAt desc`,
      `risques` через `classifyRisques`, `declarationDeadline` у `RECONNU`
      через `DeadlineRuleService.resolveActive` + `resolveDeadline` +
      `daysBetween` + `toSourceReference`. **Проверяется тестами (до кода):**
      `test/integration/dossier/arretes.int-spec.ts` — Z: коммуна без
      arrêté → `arretes: []`, `commune` заполнена; O: один `RECONNU` → срок,
      `daysLeft`, `source.url` правила; M: два arrêté разных рисков — порядок
      по дате публикации, у каждого свой срок; entry с формулировкой
      «inondations, coulées de boue et mouvements de terrain» → два
      значения в `risques`; B: публикация ровно 12 месяцев назад видна, на
      день раньше — нет; `REFUSE` → `declarationDeadline: null`, `outcome`
      назван; преемник: entry со старым кодом виден у нового; E: неизвестная
      коммуна → `400`, код не той длины → `400`; `MailLog` и счётчики
      неизменны; спек `AllExceptionsFilter` — путь в логе без query string
      (существующий, подтверждает критерий логов).

**Когда готова:** `GET /dossier/arretes?codeInsee=30189` без токена отдаёт
список arrêtés за год с остатком дней у признанных и отказом у отказанных.

## Фаза 3: Защита от двойника при создании синистра

**Цель:** `POST /sinistres` сам узнаёт существующее досье: точный повтор
отдаёт его, совпадение коммуны и риска спрашивает подтверждения, остальное
создаётся как прежде.
**Затрагивает:** contracts, api
**Задачи:**

- [ ] Contracts: `CreateSinistreInput.confirmNew?: boolean`, `SinistreConflict
    { code: 'DOSSIER_EXISTANT'; existing: { id; eventDate } }`.
      **Проверяется тестами (до кода):** `npm run build:contracts`.
- [ ] `CreateSinistreDto.confirmNew` (`@IsOptional() @IsBoolean()`);
      `SinistresService.create` в транзакции читает синистры пользователя по
      `(codeInsee, risque)` и возвращает `{ sinistre, created }`; контроллер
      отвечает `200` на существующий, `201` на созданный, `409` с телом
      `SinistreConflict` при другой дате без `confirmNew`. Swagger —
      `@ApiConflictResponse`. **Проверяется тестами (до кода):**
      `test/integration/sinistres/create-duplicate.int-spec.ts` — O: повтор
      трёх полей → `200`, тот же `id`, `count(Sinistre)` не растёт; M: та же
      коммуна и риск, другая дата → `409` с `existing.id` и
      `existing.eventDate`, ничего не создано; с `confirmNew: true` → `201`,
      два синистра; другой риск той же коммуны → `201` без вопроса; другая
      коммуна → `201`; E: чужой синистр с теми же полями не считается
      (`userId` в `where`) → `201`; `confirmNew: 'oui'` → `400`
      (`forbidNonWhitelisted` и тип); S: форма `/sinistres/nouveau` без
      `confirmNew` получает то же правило — существующий int-spec создания
      зелёный.

**Когда готова:** два `POST /sinistres` с одинаковым телом дают один синистр;
с другой датой второй отвечает `409`, а с `confirmNew: true` — `201`.

## Фаза 4: Три параметра доезжают до синистра через подтверждение email

**Цель:** регистрация принимает досье, подтверждение создаёт синистр и
называет его id; неподтверждённая регистрация уносит параметры с собой.
**Затрагивает:** contracts, db, api
**Задачи:**

- [ ] Contracts: тело `POST /auth/register` с `dossier?: CreateSinistreInput`
      (без `confirmNew`), `AccountConfirmationResponse.sinistreId?: string`.
      **Проверяется тестами (до кода):** `npm run build:contracts`.
- [ ] Миграция `add_dossier_en_attente`: таблица `DossierEnAttente`
      (`userId` PK → `User` cascade, `codeInsee` → `Commune` restrict,
      `risque RisqueCatnat`, `eventDate date`, `createdAt`); `data-model.md`
      §§ 5, 7 — тем же коммитом. **Проверяется тестами (до кода):** schema
      int-spec — удаление `User` уносит строку; вторая строка на того же
      `userId` отклоняется; удаление коммуны под строкой не проходит.
- [ ] `RegisterDto.dossier` (`@IsOptional() @ValidateNested() @Type(() =>
    CreateSinistreDto)`); `AuthService.register`: новый адрес — вставка,
      неподтверждённый — upsert, подтверждённый — не трогается, ответ `204`
      во всех трёх. **Проверяется тестами (до кода):**
      `test/integration/auth/register-dossier.int-spec.ts` — O: новый адрес с
      `dossier` → строка `DossierEnAttente`; M: повторная регистрация
      неподтверждённым адресом с другой датой → строка переписана; E:
      подтверждённый адрес с `dossier` → `204`, строки нет, тело ответа
      неотличимо от регистрации без `dossier`; `dossier` с датой в будущем →
      `400`; `dossier` с лишним полем → `400`.
- [ ] `drainPendingDossier(tx, userId)` в `AuthService`: в транзакции
      `confirm` после перехода в `confirmed` — читает строку, зовёт
      `SinistresService.create` (без `confirmNew`: у нового аккаунта
      синистров нет), удаляет строку, кладёт `sinistreId` в ответ; та же
      обвязка в ветке `resetPassword`, подтверждающей аккаунт; `AuthModule`
      импортирует `SinistresModule`. **Проверяется тестами (до кода):**
      `test/integration/auth/confirm-dossier.int-spec.ts` — O: подтверждение
      → `{ status: 'confirmed', sinistreId }`, синистр с теми же тремя полями
      и статусом по привязке (с entry `RECONNU` в базе — `ARRETE_PUBLIE` и
      срок), строка `DossierEnAttente` удалена; M: повторное подтверждение
      тем же токеном → `confirmed` без `sinistreId` и без второго синистра;
      Z: подтверждение без строки → ответ как сегодня; S: сброс пароля на
      неподтверждённом аккаунте с досье создаёт синистр; E: истёкший токен →
      `invalid`, строка остаётся до чистки.
- [ ] Чистка: `cleanupExpired` уже удаляет неподтверждённых старше
      `ACCOUNT_CONFIRM_TTL_DAYS` — каскад покрывает досье; `auth/CLAUDE.md`
      дополняется абзацем о `DossierEnAttente`. **Проверяется тестами (до
      кода):** существующий int-spec чистки — неподтверждённый `User` с
      `DossierEnAttente` старше 7 дней исчезает вместе со строкой; моложе —
      обе остаются.

**Когда готова:** `POST /auth/register` с `dossier`, затем
`POST /auth/confirmation` отвечают `sinistreId`, и `GET /sinistres/:id` под
сессией этого пользователя показывает те же коммуну, риск и дату.

## Фаза 5: Web — страница досье в режиме чтения

**Цель:** `/dossier?commune=&risque=&date=` показывает тот же экран, что
синистр, без действий над шагами; недостающие параметры страница просит на
месте; экран синистра собран из тех же компонентов.
**Затрагивает:** web
**Задачи:**

- [ ] Разбор `sinistre-detail.tsx` на `src/components/plan/`: `DossierEntete`,
      `DeclarationDeadlineBlock`, `PlanList`, `PlanStepItem` принимают
      `StepView` и необязательные `onMark`; без `onMark` — кнопок нет,
      шаг с `kind !== ACTION` рендерится пустым контейнером с подписью
      `fr.dossier.conteneur[kind]`; `/sinistres/[id]` собирается из них с
      колбэками. **Проверяется тестами (до кода):** существующие спеки
      `/sinistres/[id]` зелёные без правок (режим редактирования не
      изменился, кнопки отметки у контейнеров остаются); `tests/components/
    plan.spec.ts` — в режиме чтения в `<ol>` нет ни одной `button`,
      контейнер содержит подпись и не содержит бейджа «FAIT».
- [ ] `src/lib/dossier-params.ts`: `parseDossierParams(searchParams)` →
      `{ commune?, risque?, date? }` с проверкой `isIsoDate` и `RisqueCatnat`,
      `dossierSearch(params)` → строка query. **Проверяется тестами (до
      кода):** `tests/app/dossier-params.spec.ts` — Z: пусто → все
      `undefined`; O: три верных → три поля; E: `risque=FEU` и `date=hier`
      отбрасываются, остальные остаются; сериализация и разбор взаимно
      обратны.
- [ ] Слой API: `fetchDossierApercu(params)` через `apiFetch`, ключ
      `queryKeys.dossierApercu(commune, risque, date)`; страница
      `/dossier` (`useSearchParams` под `<Suspense>`): при полных параметрах
      — `useQuery` и экран из компонентов фазы, кнопка «Enregistrer ce
      dossier» (`size="touch"`, пока ведёт на `/inscription?…`, логика
      сессии — фаза 6); шапка: статус attendu / publié / refusé, ключевые
      даты, при `arrete` — ссылка Légifrance; `declarationDeadline.daysLeft
    < 0` → «délai expiré» словами без числа; `tests/support/pages.ts`
      получает `/dossier` с `mockApi` на `GET /dossier/apercu**`.
      **Проверяется тестами (до кода):** `tests/dossier/dossier.spec.ts` —
      четыре состояния по мокам (attendu: шаги якоря публикации «date à
      venir»; publié: бейдж срока и ссылка; refusé: отказ словами, бейджа
      нет; expiré: слова, числа нет); контейнеры пусты; ровно одна `button`
      на странице; общие сьюты axe/reflow/reduced-motion зелёные в обеих
      темах при 360 px.
- [ ] Форма недостающих полей на той же странице: `CommuneSelect`,
      `RadioGroup` риска и `<input type="date">` из `/sinistres/nouveau`
      (вынести общие части формы в `src/components/sinistre-fields.tsx`,
      копий не заводить); при `arrete` поле даты предзаполнено
      `arrete.eventStart` с `min`/`max` периода; `400` от API → та же форма
      с объяснением; отправка — `router.replace` на полный адрес;
      `risque` отсутствует, а в адресе есть `risques=A,B` от главной →
      радио ограничено этими значениями. **Проверяется тестами (до кода):**
      `dossier.spec.ts` — Z: `/dossier` без параметров → форма, запроса к API
      нет; O: только `commune` → форма с риском и датой; с `risque` и `date`
      после отправки адрес содержит все три; B: дата вне `min`/`max`
      отклоняется полем; E: `400` от мока → форма, не `RequestError`;
      S: открытие адреса в новом контексте браузера (`browser.newContext`)
      даёт тот же экран.

**Когда готова:** `/dossier?commune=30189&risque=INONDATION&date=2026-09-13`
в чистом браузере показывает план с единственной кнопкой, а `/dossier`
без параметров — форму трёх полей; axe без ошибок в обеих темах.

## Фаза 6: Web — сохранение досье: регистрация, вход, вошедший, двойник

**Цель:** «Enregistrer ce dossier» доводит до синистра во всех трёх случаях
PRD, страница подтверждения ведёт на него, двойник спрашивает.
**Затрагивает:** web
**Задачи:**

- [ ] Слой API: `createSinistre` принимает `confirmNew`, `ApiError` отдаёт
      тело `409` как `SinistreConflict`; компонент `DossierExistant` (две
      кнопки: открыть / créer quand même) в `src/components/plan/`;
      `/sinistres/nouveau` использует его же. **Проверяется тестами (до
      кода):** `tests/sinistres/doublon.spec.ts` — мок `409` → экран с датой
      существующего и двумя кнопками; «ouvrir» ведёт на `/sinistres/<id>`
      без второго `POST`; «créer» шлёт `POST` с `confirmNew: true`; мок `200`
      на `POST` → переход на существующий.
- [ ] Кнопка «Enregistrer ce dossier»: `getAccessToken()` или
      `refreshSession()` → `createSinistre` и переход; иначе `router.push`
      на `/inscription?` + `dossierSearch(params)`. **Проверяется тестами
      (до кода):** `dossier.spec.ts` — с `mockSession` нажатие шлёт `POST
    /sinistres` с тремя полями и ведёт на `/sinistres/<id>`; без сессии
      (refresh → `401`) — адрес становится `/inscription?commune=…`.
- [ ] `/inscription`: читает параметры, показывает строку «Votre dossier :
      …» (`fr.dossier.resume`), шлёт `dossier` в `POST /auth/register`;
      ссылка «Déjà un compte ? Se connecter» несёт те же параметры.
      **Проверяется тестами (до кода):** `tests/auth/inscription-dossier.spec.ts`
      — O: тело запроса содержит `dossier` с тремя полями; Z: без параметров
      тело без `dossier`, строки резюме нет; I: `href` ссылки входа
      содержит те же три параметра.
- [ ] `/connexion`: константа `LOGIN_NEXT_PARAM = 'suivant'` рядом с
      `LOGIN_PATH`; после входа — при параметрах досье `createSinistre` с
      обработкой `409` и переход; при `suivant` — переход, если путь
      начинается с `/` и не с `//`; иначе `/espace-personnel`. Страница
      подтверждения при `sinistreId` ведёт на
      `/connexion?suivant=/sinistres/<id>`. **Проверяется тестами (до
      кода):** `tests/auth/connexion-suivant.spec.ts` — O: вход с
      параметрами → `POST /sinistres` и `/sinistres/<id>`; `suivant=/sinistres/x`
      → туда; E: `suivant=//evil.example` и `suivant=https://evil.example` →
      `/espace-personnel`; `compte-confirmation.spec.ts` — мок ответа с
      `sinistreId` → `href` ссылки входа содержит `suivant`.

**Когда готова:** в чистом браузере путь `/dossier?…` → «Enregistrer» →
регистрация с заполненными полями проходит с моками, а под `mockSession`
кнопка создаёт синистр за один клик.

## Фаза 7: Web — главная: поле коммуны, ответ, подписка; `/veille` уходит

**Цель:** главная начинается с вопроса о коммуне и ведёт к досье или к
подписке с одного экрана; страницы формы `/veille` больше нет.
**Затрагивает:** web
**Задачи:**

- [ ] Слой API: `fetchCommuneArretes(code)` и `queryKeys.communeArretes(code)`;
      `subscribeVeille(email, communeCodes)` в `src/lib/api/veille.ts` —
      мутация и `validateEmail` переезжают из `veille-form.tsx`.
      **Проверяется тестами (до кода):** `tests/app/veille-api.spec.ts` —
      тело `POST /veille` содержит `communeCodes: ['30189']` и
      нормализованный email.
- [ ] `src/components/reponse-commune.tsx` (`ReponseCommune({ commune })`):
      карточка на entry — риск (`fr.sinistres.risque.options[...]` по
      `risques`, сырая формулировка в `title`), период, дата публикации,
      ссылка Légifrance, `DeadlineBadge form="row"` у `RECONNU` или «délai
      expiré», отказ словами; `Link` «Ouvrir mon dossier» (`size="touch"`) на
      `/dossier?commune&risque&date=eventStart` (несколько `risques` →
      `risques=A,B` без `risque`); пусто → «aucun arrêté récent» и «Préparer
      mon dossier» (`/dossier?commune=`); заранее смонтированный
      `role="status"`. **Проверяется тестами (до кода):**
      `tests/home/reponse-commune.spec.ts` по мокам — Z: пустой ответ →
      текст и кнопка «Préparer»; O: один `RECONNU` → бейдж с `daysLeft`,
      `href` кнопки содержит три параметра; M: два arrêté → две кнопки в
      порядке ответа; `REFUSE` → слово «refus», бейджа нет; `daysLeft: -3` →
      «expiré» без «-3»; `risques: [A, B]` → `href` с `risques=`; анонс
      «N arrêtés» в `role="status"`.
- [ ] `VeilleInlineForm({ commune })`: `EmailField` + кнопка «Être prévenu»
      → `subscribeVeille`, успех — `AnnouncedResult` «письмо отправлено»,
      цель обработки и ссылка на politique de confidentialité как у прежней
      формы. **Проверяется тестами (до кода):** `tests/home/veille-inline.spec.ts`
      — O: отправка → `POST /veille` с кодом коммуны и экран успеха; E:
      пустой и невалидный email → ошибки поля, запроса нет; `429` → сообщение
      лимита как раньше.
- [ ] Главная: `CommuneSelect` в верхнем экране, `ReponseCommune` под ним
      после выбора, объясняющий текст ниже, раздел «Et ensuite ?» удалён;
      удаление `app/veille/page.tsx`, `veille-form.tsx`, `tests/veille/
    veille.spec.ts` и строк `fr.veille.page.*`/`fr.veille.form.*`, не
      используемых подстраницами; `next.config.ts` — `redirects`
      `/veille → /` (`permanent: true`); `tests/support/pages.ts` — `veille`
      удалена, подстраницы остаются. **Проверяется тестами (до кода):**
      `tests/home/home.spec.ts` — S: выбор коммуны → `GET /dossier/arretes`
      и блок ответа; до выбора запросов нет; `tests/pages/redirect.spec.ts`
      — `GET /veille` → `308` на `/`; `/veille/confirmation?token=invalide`
      по-прежнему `200`; общие сьюты axe/reflow/reduced-motion на главной
      зелёные при 360 px; `i18n` спек — строк вне `fr.ts` нет.

**Когда готова:** на главной выбор коммуны показывает её arrêtés с кнопками
досье и строкой подписки, `/veille` уводит на главную, а подстраницы писем
открываются как прежде; axe без ошибок.

## Фаза 8: Web — шапка с сессией и сквозной путь

**Цель:** с главной кликами достижимы вход, кабинет, подписка и досье; весь
путь от главной до синистра проверен против реального API и базы.
**Затрагивает:** web, api (сев e2e)
**Задачи:**

- [ ] `session.ts`: `subscribeAccessToken(listener)` — `setAccessToken` и
      `clearAccessToken` оповещают; хук `useSession()` в `src/lib/api/`
      (один `refreshSession()` на монтировании, состояние по подписке).
      **Проверяется тестами (до кода):** `tests/auth/session.spec.ts`
      дополняется — после `logout` подписчик получает `null`; с
      `mockSession` хук даёт `authenticated` после одного запроса refresh
      (счётчик перехватов = 1 при двух потребителях на странице).
- [ ] `SessionNav` в `layout.tsx`: `<nav aria-label={fr.layout.mainNav}>`
      со ссылкой «Se connecter» (`LOGIN_PATH`) без сессии и «Mon espace»
      (`/espace-personnel`) с ней; skip-link остаётся первым фокусируемым.
      **Проверяется тестами (до кода):** `tests/layout/header.spec.ts` — без
      сессии (`401` на refresh) ссылка на `/connexion`; с `mockSession` —
      на `/espace-personnel`; с главной за два клика достижимы
      `/espace-personnel`, а из ответа по коммуне — `/dossier` и подписка
      (S, критерий PRD № 1); общие сьюты axe на всех страницах реестра
      зелёные с новой шапкой в обеих темах.
- [ ] Сев e2e (`test/helpers/e2e-referential.ts`): один arrêté `RECONNU`
      по коммуне сева с периодом в прошлом; второй сценарий в
      `e2e/parcours-sinistre.spec.ts`: главная → коммуна → «aucun arrêté»
      для коммуны без arrêté → «Préparer mon dossier» → риск и дата →
      «Enregistrer» → `/inscription` с резюме → письмо из outbox →
      подтверждение (ответ с `sinistreId`) → «Se connecter» → вход →
      `/sinistres/<id>` с теми же тремя полями; третий сценарий: коммуна с
      arrêté → карточка с бейджем → «Ouvrir mon dossier» → досье «publié»
      с датой первого дня периода. **Проверяется тестами (до кода):** сами
      сценарии `test:e2e`; `test:web` их не видит.

**Когда готова:** `npm run test:e2e` проходит три сценария, а на любой
странице шапка ведёт вошедшего в кабинет и гостя на вход; `/ui-review`
главной, `/dossier` и шапки пройден в обеих темах.

## Сверка с критериями готовности PRD

| критерий PRD                                                  | фаза    |
| ------------------------------------------------------------- | ------- |
| шапка, достижимость с главной                                 | 8       |
| главная: одно поле, arrêtés за 12 мес, кнопка у каждого       | 2, 7    |
| «aucun arrêté récent», подписка, кнопка                       | 7       |
| отказ назван в ответе                                         | 2, 7    |
| подписка из строки, `/veille` редирект, подстраницы           | 7       |
| кнопка у arrêté → первый день периода; «Préparer» просит поля | 5, 7    |
| параметры из адреса, новый браузер                            | 5       |
| publié / attendu / refusé / RECONNU важнее                    | 1, 5    |
| преемник в ответе и досье                                     | 1, 2    |
| истёкший срок словами                                         | 1, 5, 7 |
| контейнеры пусты, одно действие                               | 1, 5    |
| не создают записей и писем                                    | 1, 2    |
| Enregistrer без сессии → регистрация → синистр → ссылка       | 4, 6    |
| переход на вход сохраняет поля                                | 6       |
| Enregistrer в сессии                                          | 6       |
| привязка и статус как у `nouveau`                             | 4       |
| двойник: три случая                                           | 3, 6    |
| неподтверждённая удалена через 7 дней с полями                | 4       |
| неверные параметры → объяснение и поля                        | 5       |
| шаблон различает вид, четыре контейнера, экран прежний        | 1, 5    |
| логи без коммуны, даты, email                                 | 2       |
| axe, клавиатура, 360 px, строки в `fr.ts`                     | 5, 7, 8 |
