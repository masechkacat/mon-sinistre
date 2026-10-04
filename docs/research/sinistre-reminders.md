# Research: Напоминания по шагам синистра

**PRD**: docs/prd/sinistre-reminders.md (план фаз пишется после этого отчёта)
**Дата**: 2026-10-04
**Входные данные**: ТЗ §§ 3.2, 6, 7, 9; `docs/research/data-model.md` §§ 1, 5, 6
(`ReminderLog` спроектирован там 02.08.2026); `docs/research/sinistre-plan.md`
(outbox письма владельцу, статусы на чтении, «сегодня» в Europe/Paris);
`docs/research/veille-subscription-lifecycle.md` (one-click отписка);
`docs/research/emails.md` (каркас письма, `List-Unsubscribe`). Стек: NestJS
12.1 на Fastify, `@nestjs/schedule` 12.0, Prisma 7.10, Next.js 16.2, TanStack
Query 5. Новых зависимостей — ни одной.

## Решения

### Схема: `ReminderLog` по data-model § 6, три колонки `User`, отложенный индекс `Step`

**Решение:** таблица `ReminderLog` ровно в форме `data-model.md` § 6:
`stepId → Step (cascade)`, `kind` (enum `ReminderKind { SCALE, OVERDUE }`),
`offsetDays int null` (факт: за сколько дней до даты ушло письмо; у `OVERDUE`
null), `plannedDate date` (для какой даты шага напоминали), `sentOn date`
(парижский день отправки). Две условные уникальности — SQL руками в
миграции: `unique(stepId, kind, offsetDays, plannedDate) where kind = 'SCALE'`
и `unique(stepId, sentOn) where kind = 'OVERDUE'`. Там же — отложенный
частичный индекс `Step(plannedDate) where persistedStatus is null`, который
§ 5 обещал фазе напоминаний.

На `User` три колонки: `remindersDisabledAt timestamptz null` (null =
напоминания включены — умолчание PRD), `reminderUnsubscribeTokenHash text
null unique` (null, пока ни одно письмо-напоминание не ушло) и
`reminderFailures int default 0` (неудачных попыток отправки этому человеку
подряд; прогон без повода для него счётчик не трогает, см. «Прогон»).

**Почему:** строка `ReminderLog` — факт отправки, а не код причины: при смене
шкалы история остаётся читаемой, а пересчёт `plannedDate` (rectificatif,
перепривязка после отказа) открывает новую серию для новой даты — ровно
критерий PRD «порог срабатывает заново по новой дате», и ровно решение
data-model от 02.08.2026. Уникальности дают идемпотентность ТЗ § 9 на уровне
базы, а не только кода. `remindersDisabledAt` — отметка времени, а не boolean,
по образцу `confirmedAt`: бесплатная история «с какого дня», та же семантика
«null = действует». Хеш токена nullable, чтобы миграция не выдумывала токены
существующим аккаунтам: он чеканится первым письмом, как у veille — при
отправке. Счётчик сбоев на `User`, а не отдельная таблица: единственный
читатель — порог алерта, строки-факты для него не нужны.
**Отброшено:** outbox-таблица «письмо дня» (`ReminderMail(userId, day,
sentAt, attempts)`) — вторая таблица ради «одного письма в день», которое
`ReminderLog.sentOn` уже даёт; и её `attempts` считал бы повторы внутри дня,
которых при одном прогоне в сутки не бывает. Писать строки `ReminderLog` до
отправки (outbox, как `VeilleNotification`) — тогда `offsetDays` и состав
письма расходятся с днём реальной отправки, а уникальность по `offsetDays`
начинает мешать досылке.
**Как применять:** миграция `add_reminder_log` — enum, таблица, два
`CREATE UNIQUE INDEX … WHERE kind = '…'`, индекс `Step`, три колонки `User`.
`data-model.md` §§ 5, 6 правятся тем же коммитом (колонки `User`, индекс
`Step` больше не «отложен»).

### Отбор поводов: чистая функция, пороги из contracts, шкала по коду правила

**Решение:** `selectReminders(candidates, today): ReminderReason[]` в
`src/reminders/select-reminders.ts` — чистая функция над шагами с их логами,
без Prisma; `today` приходит из `todayInParis()`. На вход — шаг
(`plannedDate`, `persistedStatus`, код `DeadlineRule` или null) и его
`ReminderLog` для текущей `plannedDate`. Правила:

- шаг без `plannedDate` или с `persistedStatus` — не повод (снятие отметки
  возвращает его в отбор само собой: отбор не хранит состояния);
- шкала: `DECLARATION_REMINDER_OFFSETS_DAYS`, если
  `deadlineRule.code === DECLARATION_ASSUREUR_CODE`
  (`src/deadline-rules/deadline-rule.seed.ts`), иначе
  `REMINDER_OFFSETS_DAYS`; по названию шага ничего не распознаётся;
- `SCALE` (`today ≤ plannedDate`): `remaining = daysBetween(today,
plannedDate)`; `next` = наибольший порог шкалы, строго меньший минимального
  `offsetDays` среди `SCALE`-логов этой `plannedDate` (нет логов — наибольший
  порог шкалы); повод, если `next` существует и `remaining ≤ next`; в лог
  пишется фактический `remaining`;
- `OVERDUE` (`plannedDate < today`): повод, если `OVERDUE`-логов этой
  `plannedDate` меньше `OVERDUE_REMINDER_MAX_COUNT` и последний `sentOn`
  старше `today − OVERDUE_REMINDER_INTERVAL_DAYS` (или логов нет).

**Исправлено при реализации (фаза 2, issue #208):** интервал просрочки
включителен — повод возвращается на седьмой день после письма («прошло не
меньше интервала», PRD), а не на восьмой.

**Почему:** «письмо, ушедшее при остатке r, закрывает все пороги ≥ r» — это и
есть формулировка PRD «одно письмо закрывает все такие пороги», и она даёт
все три свойства разом: устойчивость к простою (пропущенный день догоняется
следующим утром), синистр посреди шкалы (создан за 9 дней — утром письмо с 8,
потом 7, 3, 1 — критерий PRD дословно) и идемпотентность повторного прогона
(после письма при остатке 8 `next` = 7, `8 ≤ 7` ложно). `OVERDUE` считается от
последнего факта, а не от «дня после даты»: шаг, просроченный ещё до создания
синистра (событие десять дней назад, шаг «photographier» с offset 0),
получает первое письмо следующим утром, а не никогда. Остаток 0 (дата —
сегодня) — повод `SCALE`, не `OVERDUE`: срок ещё не прошёл, письмо говорит
«dernier jour».
**Отброшено:** «повод = день, когда остаток равен порогу» — простой в этот
день теряет письмо, а синистру посреди шкалы пришлось бы досылать пороги
отдельными письмами, что PRD выносит из скоупа. Признак «кто действует» в
шаблоне — PRD его не ввёл (решение 04.10.2026: напоминать обо всех шагах с
датой).
**Как применять:** кандидаты читаются одним запросом с горизонтом
`plannedDate ≤ today + max(...REMINDER_OFFSETS_DAYS,
...DECLARATION_REMINDER_OFFSETS_DAYS)` (число не пишется — считается из
констант), `persistedStatus: null`, `sinistre.user.remindersDisabledAt: null`,
с `deadlineRule { code, sourceUrl, sourceVerifiedAt }`, `reminderLogs`,
`sinistre { id, eventDate, risque, commune { name, departementName }, user
{ id, email } }`. Группировка по `user.id` — в сервисе, после отбора.
Следствие правил, которое стоит знать плану: шаги первых дней (offset 0–7 от
`DATE_SINISTRE`) попадают под порог 30 сразу, поэтому первое письмо приходит
утром после создания синистра и перечисляет их — это не «сводка в день
создания» из «Не в скоупе», а штатный повод шкалы.

**Исправлено при реализации (фаза 1, issue #207):** `sourceUrl` и
`sourceVerifiedAt` читаются с самого `Step`, не с `deadlineRule` — письмо
цитирует ту версию правила, по которой шаг датирован. Подпись риска —
`fr.sinistres.risques` по `Sinistre.risque`.

### Прогон: `RemindersService` в `src/reminders/`, 07:00 Europe/Paris, запись после отправки

**Решение:** новый модуль `src/reminders/` (`RemindersModule`,
`RemindersService`, `RemindersController`, `select-reminders.ts`,
`reminder-mail.ts`), не часть `jorf/` (2 300 строк) и не `sinistres/`
(контроллер досье). `@Cron('0 7 * * *', { timeZone: 'Europe/Paris' })` на
`run(options)`; `options.now` — только для тестов, как у `todayInParis`.
Флаг `running`, как у монитора. Цикл: кандидаты → группировка по
пользователю → для каждого в своём `try/catch`: ротация токена → сборка
письма из **текущего** состояния шагов → `MailService.send` → одна транзакция:
вставка строк `ReminderLog` (`sentOn = today`) и `reminderFailures = 0`. На
исключении (сборка или отправка): `reminderFailures += 1`, лог с `user.id` и
`errorSummary`; когда счётчик становится равен
`NOTIFICATION_ATTEMPTS_BEFORE_ALERT` (`src/jorf/mail/drain-outbox.ts`) —
`MonitorAlert { kind: NOTIFICATION_STUCK, arreteId: null, detail: 'rappels:
utilisateur <id> не отправлено после N попыток' }` и письмо администратору.

**Почему:** сбой одного получателя не трогает остальных (ТЗ § 6), а
несделанная запись сама по себе — досылка: завтра отбор снова увидит те же
поводы (критерий PRD «его повод уходит следующим прогоном, если шаг всё ещё
не отмечен»). Счётчик на пользователе, а не на строке, потому что строк до
отправки нет; порог — тот же, что у двух outbox'ов, своего числа не
заводится. 07:00 — после утреннего прогона монитора (06:00): письмо
учитывает найденные ночью arrêtés; в тот же тик их объединять нельзя —
монитор ходит дважды в сутки, а напоминание одно.
**Отброшено:** `drainOutbox` из `src/jorf/mail/` — он группирует по
`arreteId` и живёт на строках-до-отправки; подгонять его под группировку по
пользователю значит переписать оба его адаптера ради цикла в двадцать строк.
`MonitorLock` для межпроцессной блокировки — его имя и TTL принадлежат
ingest'у, а второй процесс API в деплое не планируется (риск ниже).
`runGuarded` — он для нескольких независимых `deleteMany` одного тика, здесь
же изоляция нужна на получателя, не на шаг чистки.
**Как применять:** `notifyAdmin` (`JorfMonitorService`, приватный) выносится
в `AdminAlertService` (`src/jorf/alerts/admin-alert.service.ts`,
`exports` `JorfModule`): чтение `ADMIN_EMAIL`, `monitorAlertMailFor`,
`try/catch` с логом — одна копия на оба модуля. Спека расписания —
`reminders-schedule.spec.ts` по образцу `auth-schedule.spec.ts` (считаются
запросы, не шпионится метод). Логи: «reminders: run done — users=N mails=M
failed=K»; имён шагов, адресов и названий коммун в логе нет.

### Токен выключения: ротация на отправке, хеш в базе, два эндпоинта в `reminders`

**Решение:** токен — `generateSecureToken`/`hashSecureToken`
(`src/common/security/secure-token.ts`), хеш в
`User.reminderUnsubscribeTokenHash`, plaintext существует только в момент
сборки письма: перед каждым письмом-напоминанием токен **ротируется** в
транзакции (`updateMany where { id, remindersDisabledAt: null }` → `count
=== 0` значит, человек выключил напоминания между отбором и отправкой —
письмо не уходит), как `rotateUnsubscribeToken` у veille. Эндпоинты — в
`RemindersController`:

| метод и путь                   | кто                               | тело → ответ                                   |
| ------------------------------ | --------------------------------- | ---------------------------------------------- |
| `POST /rappels/desinscription` | `@Public()`, `@ThrottleByToken()` | `{ token }` (`TokenDto`) → 204 всегда          |
| `PATCH /rappels`               | `JwtAuthGuard`                    | `{ enabled: boolean }` → `RemindersPreference` |

`POST` — `updateMany where { reminderUnsubscribeTokenHash: hash } data
{ remindersDisabledAt: now }`: неизвестный, уже использованный после ротации
и чужой токен отвечают одинаково (anti-enumeration, как
`VeilleService.unsubscribe`). `PATCH` пишет `remindersDisabledAt` по
`req.user.id`; `GET /auth/me` начинает отдавать `remindersEnabled`.

**Почему:** хранить токен хешем — правило data-model § 6, а восстановить
plaintext из хеша нельзя, поэтому стабильный хешированный токен невозможен:
либо ротация на отправке (есть, проверена на veille, та же `secure-token`),
либо новая схема (HMAC от `userId` с новым секретом в окружении —
предусловие для Ralph и второй криптопримитив ради переключателя). Вред
утечки токена — выключенные напоминания, видимые и обратимые в кабинете;
доступа к кабинету и адреса он не даёт (критерий PRD). Оба эндпоинта в одном
модуле: запись `remindersDisabledAt` живёт в одном сервисе, `auth` только
читает поле — иначе две записи одного флага в двух модулях.
**Отброшено:** ротация по расписанию отдельно от письма — ссылка в письме
обязана совпадать с хешем в базе на момент отправки; `ACCOUNT_MAIL_UNSUBSCRIBE_PATH`
для напоминаний — его `route.ts` отвечает no-op `200`, и докблок константы
прямо запрещает ему обрастать страницей; письмо-напоминание — регулярное, его
ссылка обязана что-то делать.
**Как применять:** contracts — `REMINDER_UNSUBSCRIBE_PATH =
'/compte/rappels/desinscription'` (докблок по образцу `VEILLE_*_PATH`),
`OVERDUE_REMINDER_MAX_COUNT = 4` рядом с `OVERDUE_REMINDER_INTERVAL_DAYS`
(решение владельца 04.10.2026, не юридическое число),
`CurrentUserResponse.remindersEnabled: boolean`, `RemindersPreference
{ enabled: boolean }`. Путь с токеном собирает `reminderUnsubscribePathFor`
по образцу `unsubscribePathFor` (`src/veille/veille-confirmation-mail.ts`).
DTO `PATCH` — `class-validator` `@IsBoolean()`; DTO `POST` наследует
`TokenDto`, как `VeilleTokenDto`.

### Письмо: один композитор, блоки каркаса, формулировка по коду правила

**Решение:** `reminderMailFor(to, token, today, sinistres)` в
`src/reminders/reminder-mail.ts` → `ComposeMailInput`; одно письмо на
человека, внутри — по блоку на синистр: `paragraph` (коммуна через
`communeLabel`, риск, дата события `formatFrenchDate`), `list` строк по шагам,
`link` на `${SINISTRE_PATH}/${id}`. Строка шага: название, дата, и одно из —
«dans N jours» / «dernier jour» (`remaining = 0`) / «en retard de N jours».
Для шага `DECLARATION_ASSUREUR` остаток выносится отдельным `paragraph`
(«il vous reste N jours pour déclarer…»), за ним `externalLink` на
`sourceUrl` с датой сверки и, при `possiblyOutdated` из `toSourceReference`
(`src/common/source-reference.ts`), пометка «à vérifier» и предложение сверить
с договором (`fr.mail.jorf.notification` уже содержит такую фразу —
переиспользовать, не переписывать). Просроченный `DECLARATION_ASSUREUR`:
«le délai est dépassé — contactez votre assureur sans attendre», без оценки
последствий. Просроченный шаг страховщика: «le délai prévu est dépassé — il
est utile de relancer votre assureur». Кто действует — по коду правила:
набор `INSURER_RULE_CODES` рядом с кодами в `deadline-rule.seed.ts`
(`INFORMATION_ASSUREUR`, `PROVISION_INDEMNITE`, `PROPOSITION_INDEMNISATION`,
`REPARATION_MISSIONNEE`, `VERSEMENT_INDEMNITE`); остальное — действие
человека. Тема: с поводом по сроку декларации — «Il vous reste N jours pour
déclarer votre sinistre», иначе «Vos prochaines étapes». `reason` подвала:
«vous suivez un dossier de sinistre sur Mon Sinistre»; `unsubscribePath` —
`reminderUnsubscribePathFor(token)`. Все строки — ветка `fr.mail.reminders` в
`src/i18n/fr.ts`.

**Исправлено при реализации (фаза 1, issue #206):** фразы «à vérifier» и
предложения сверить с договором в `fr.mail.jorf.notification` нет — там только
`deadline` и `legifranceLink`; переиспользовать было нечего, обе фразы
заведены в `fr.mail.reminders.declaration`. Там же шаг `DECLARATION_ASSUREUR`
не попадает в `list`: его абзац называет действие словами и несёт ту же дату,
а строка списка сказала бы единственный срок письма второй раз.

**Исправлено при реализации (фаза 2, issue #209):** строка просроченного шага
страховщика — «en retard de N jours — il est utile de relancer votre
assureur»: «le délai prévu est dépassé» сказало бы «en retard» второй раз.
Тема получила `subject.declarationOverdue` и называет ближайший ещё не
истёкший срок декларации, а истёкший — только когда других нет: `Math.min` по
остаткам со знаком написал бы «Il vous reste −2 jours».

**Почему:** каркас рендерит блоки в text и HTML сам, равенство ссылок двух
версий — по построению (`src/mail/mail-message.ts`), отдельно его доказывать
не надо. Должник срока — свойство нормы, а не шаблона: правило
`INFORMATION_ASSUREUR` обязывает страховщика, где бы ни стоял шаг; и в MVP
это единственный датируемый шаг страховщика — три якоря вех
(`DATE_ETAT_ESTIMATIF` и далее) никогда не разрешаются
(`docs/research/sinistre-plan.md`, «Ограничения и риски»), так что
«напоминать обо всех шагах с датой» на практике касается шагов человека и
одного шага страховщика.
**Отброшено:** письмо на каждый синистр — PRD требует одно в сутки; остаток
дней считать в письме заново — считает отбор, письмо печатает `remaining` из
повода (одна арифметика, `daysBetween` из `step-status.ts`).
**Как применять:** спека композитора рядом (`reminder-mail.spec.ts`) — по
образцу `sinistre-arrete-mail.spec.ts`: состав блоков, ссылка на синистр,
наличие `externalLink` на норму для шага декларации, пометка устаревания,
`dernier jour` при нуле.

### Web: route handler и страница через общие части с veille, переключатель в кабинете

**Решение:** `src/app/compte/rappels/desinscription/route.ts` (`POST` —
one-click → `apiFetch('/rappels/desinscription')`, `GET` → 307 на
`…/confirmer?token=`) и `confirmer/page.tsx` с одной кнопкой — то же
устройство, что `veille/desinscription` («One-click отписка (RFC 8058)» в
research veille). Чтобы не класть вторую копию, обе части обобщаются:
фабрика `oneClickUnsubscribeHandlers({ unsubscribe, confirmPath })` в
`src/lib/one-click-unsubscribe.ts` (возвращает `POST`/`GET`), и компонент
`TokenConfirmScreen` (`src/components/token-confirm-screen.tsx`: `mutationFn`,
строки экрана, `AnnouncedResult` + `MessageScreen` + `Button`) — veille
переводится на них тем же коммитом. В `espace-personnel.tsx` — раздел
«Rappels par e-mail»: фраза состояния из `remindersEnabled` (`GET /auth/me`,
уже запрошен) и одна кнопка «Désactiver les rappels» / «Réactiver les
rappels» через `useMutation(PATCH /rappels)` с инвалидацией
`queryKeys.currentUser()`; результат объявляется через заранее смонтированный
`role="status"` (правило `apps/web/CLAUDE.md`). Слой — `src/lib/api/reminders.ts`
(`updateReminders`, `unsubscribeReminders`).

**Почему:** кнопка-действие с явной подписью, а не switch: аудитория —
люди в стрессе и пожилые, «Désactiver les rappels» однозначнее переключателя
без подписи состояния; и новый UI-компонент (shadcn `switch` ставится через
CLI — сеть, которой у Ralph нет) не нужен. Фабрика и общий экран — иначе
`dry-reviewer` увидит два `route.ts` и два компонента, различающихся одним
URL.
**Отброшено:** страница по `ACCOUNT_MAIL_UNSUBSCRIBE_PATH` — см. выше;
переключатель в `GET /auth/me` + `PATCH /auth/me` — запись флага ушла бы в
`auth`, а по токену — в `reminders`.
**Как применять:** тесты — `tests/compte/rappels-desinscription-route.spec.ts`
(POST → 200 при успехе API, не-200 при сбое; GET → 307 без изменения
состояния), `rappels-desinscription-confirmer.spec.ts` (кнопка, объявление
результата, axe), дополнение `espace-personnel.spec.ts` (переключение,
`mockSession` + `page.route` на `/auth/me` и `/rappels`); `pages.ts` получает
новую запись для сквозных a11y-проверок.

## Тесты по ТЗ § 9 — где что живёт

| требование                                               | спека                                                                                            |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| отбор поводов по порогам, обе шкалы, `FAIT`/без даты     | `src/reminders/select-reminders.spec.ts` (юнит, без базы)                                        |
| синистр посреди шкалы 8 → 7 → 3 → 1; смена `plannedDate` | там же                                                                                           |
| просрочка: первый прогон, интервал, предел 4             | там же                                                                                           |
| не больше одного письма в день, объединение синистров    | `test/integration/reminders/reminders.int-spec.ts` (`RecordingTransport`, `run({ now })` дважды) |
| изоляция сбоя получателя, досылка, алерт после 4         | там же (транспорт, падающий на одном адресе)                                                     |
| условные уникальности, каскад `Step → ReminderLog`       | `test/integration/reminders/reminder-log-schema.int-spec.ts`                                     |
| токен: 204 на любой токен, ротация, `PATCH /rappels`     | `reminders.int-spec.ts`                                                                          |
| расписание взведено                                      | `src/reminders/reminders-schedule.spec.ts`                                                       |
| логи без адресов                                         | `captureLogs().expectNoTraceOf(email)` в int-спеке                                               |

## Ограничения и риски

- **Один процесс API.** Защита от двойного прогона — флаг `running` в
  процессе; два экземпляра API отправили бы два письма (уникальности
  `ReminderLog` остановят только вторую запись, не второе письмо). Станет
  актуально при горизонтальном масштабировании — тогда общий лизинг-лок
  выносится из `JorfMonitorService` в `src/common/`.
- **Ротация убивает ссылку предыдущего письма**: one-click из позавчерашнего
  письма отвечает 204, но ничего не меняет (хеш другой). Для ежедневных
  писем приемлемо — то же поведение у veille; человек с кнопкой в кабинете
  не зависит от письма.
- **Первое письмо — утром после создания синистра** (шаги первых дней под
  порогом 30). PRD «Не в скоупе» исключает письмо в день создания, не на
  следующий; если владелец сочтёт это шумом, правится шкала в contracts, не
  отбор.
- Алерт приходит на четвёртую неудачу, то есть **не раньше** четвёртого дня.
  Это медленнее двух дней у outbox'ов монитора (два тика в сутки) —
  осознанно: одно письмо в день — требование ТЗ § 6.
- `ReminderLog` не чистится: каскад с `Step` при удалении синистра или
  аккаунта, иначе строки живут вечно. Объём — порядка десятка строк на шаг
  за весь срок досье; чистка не нужна, пока не появится читатель истории.
- Переход на летнее/зимнее время: `@Cron` с `timeZone` и `todayInParis`
  работают в одном поясе, день не съезжает; проверяется существующей
  спекой `today-in-paris`.
- **Предусловий для Ralph нет**: ни зависимостей, ни переменных окружения;
  миграция идёт через `prisma migrate dev` на локальной базе, как раньше.
- `data-model.md` §§ 5–6 и `apps/api/src/auth/CLAUDE.md` (пункт о
  `ACCOUNT_MAIL_UNSUBSCRIBE_PATH` получает ссылку на путь напоминаний)
  правятся в коммитах миграции и эндпоинтов соответственно — иначе карта
  данных и правила модуля начнут врать следующей сессии.
