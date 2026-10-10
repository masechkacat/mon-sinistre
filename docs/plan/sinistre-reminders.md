# Plan: Напоминания по шагам синистра

**PRD**: docs/prd/sinistre-reminders.md
**Research**: docs/research/sinistre-reminders.md (04.10.2026). Технические
решения (`ReminderLog` по data-model § 6, чистый отбор поводов, прогон 07:00
Europe/Paris с записью после отправки, ротация токена выключения, эндпоинты
`/rappels`, общие с veille части web) приняты там; задачи ниже их применяют,
а не перевыбирают. Отступления реализации фиксируются врезкой «Исправлено при
реализации» в самом отчёте.
**Дата**: 2026-10-04

Новых зависимостей и переменных окружения нет; предусловий владельца до
автономного прогона — ни одного.

## Фаза 1: Письмо по шкале уходит (Tracer Bullet)

**Цель:** сквозной путь contracts → база → API: у человека есть шаг с датой
в пределах шкалы, утренний прогон отбирает повод и присылает одно письмо на
все его синистры; повторный прогон в тот же день молчит.
**Затрагивает:** contracts, db, api
**Задачи:**

- [ ] Contracts: `OVERDUE_REMINDER_MAX_COUNT = 4` рядом с
      `OVERDUE_REMINDER_INTERVAL_DAYS`, `REMINDER_UNSUBSCRIBE_PATH =
    '/compte/rappels/desinscription'` с докблоком по образцу `VEILLE_*_PATH`.
      **Проверяется тестами (до кода):** `npm run build:contracts` — API
      собирается против новых констант; спека отбора (ниже) импортирует
      предел из contracts, а не своё число.
- [ ] Миграция `add_reminder_log`: enum `ReminderKind`, таблица `ReminderLog`
      (`stepId` cascade, `kind`, `offsetDays` null, `plannedDate`, `sentOn`),
      два условных unique SQL руками (`SCALE`: `stepId, kind, offsetDays,
    plannedDate`; `OVERDUE`: `stepId, sentOn`), частичный индекс
      `Step(plannedDate) where persistedStatus is null`, колонки `User`:
      `remindersDisabledAt`, `reminderUnsubscribeTokenHash` (null, unique),
      `reminderFailures` (default 0). `data-model.md` §§ 5–6 — тем же
      коммитом. **Проверяется тестами (до кода):**
      `test/integration/reminders/reminder-log-schema.int-spec.ts` — дубль
      `SCALE` с теми же `offsetDays`/`plannedDate` отклоняется, дубль
      `OVERDUE` с тем же `sentOn` отклоняется, две `OVERDUE` разных дней
      проходят, `User.reminderUnsubscribeTokenHash` уникален, удаление
      синистра и аккаунта уносит строки лога каскадом.
- [ ] `src/reminders/select-reminders.ts` — чистая функция
      `selectReminders(candidates, today)` для `SCALE`: шкала по
      `deadlineRule.code === DECLARATION_ASSUREUR_CODE`, `next` — наибольший
      порог ниже минимального `offsetDays` в логах этой `plannedDate`, повод
      при `remaining ≤ next`. **Проверяется тестами (до кода):**
      `select-reminders.spec.ts` — шаг за 30/14/3 дня даёт повод, за 15 нет;
      шаг декларации за 21/14/7/3/1, не за 30; `FAIT`, `NON_APPLICABLE` и шаг
      без даты не повод, снятая отметка возвращает; синистр за 9 дней до
      срока: повод при 8, затем 7, 3, 1 и ни разу при 21/14; после письма при
      8 тот же день повода нет; лог с другой `plannedDate` не считается —
      порог срабатывает заново по новой дате; остаток 0 — повод `SCALE`.
- [ ] `src/reminders/reminder-mail.ts` — `reminderMailFor(to, token, today,
    sinistres)` и ветка `fr.mail.reminders`: блок на синистр (коммуна,
      риск, дата события, список шагов «dans N jours» / «dernier jour»,
      ссылка `${SINISTRE_PATH}/${id}`), для `DECLARATION_ASSUREUR` отдельный
      абзац остатка, `externalLink` на норму с датой сверки и пометкой при
      `possiblyOutdated` (`toSourceReference`), тема по наличию повода
      декларации, `unsubscribePath` через `reminderUnsubscribePathFor(token)`.
      **Проверяется тестами (до кода):** `reminder-mail.spec.ts` — состав
      блоков для двух синистров, ссылка на каждый, абзац и `externalLink`
      для шага декларации с датой сверки, пометка при устаревшем правиле,
      «dernier jour» при нуле, путь отписки с токеном, тема меняется.
- [ ] `RemindersModule` + `RemindersService.run({ now })`: `@Cron('0 7 * * *',
    Europe/Paris)`, флаг `running`, запрос кандидатов с горизонтом из
      констант и `remindersDisabledAt: null`, группировка по пользователю,
      ротация `reminderUnsubscribeTokenHash` в транзакции (`count === 0` →
      письма нет), `MailService.send`, затем одна транзакция: строки
      `ReminderLog` с `sentOn = today`. Регистрация в `AppModule`; строка о
      модуле в `apps/api/CLAUDE.md`. **Проверяется тестами (до кода):**
      `reminders-schedule.spec.ts` (расписание взведено, по образцу
      `auth-schedule.spec.ts`); `reminders.int-spec.ts` с
      `RecordingTransport` — два синистра одного человека с поводами дают
      одно письмо, в котором названы оба; текстовая версия содержит те же
      ссылки на синистры, что HTML; второй `run` тем же `now` письма не шлёт;
      строки `ReminderLog` записаны с фактическим `offsetDays`; хеш токена в
      базе соответствует ссылке письма; `captureLogs().expectNoTraceOf(email,
    названиеШага)`.

**Когда готова:** `run` утром после создания синистра присылает одно письмо
со всеми шагами в пределах шкалы; `run` второй раз в тот же день не шлёт
ничего; `ReminderLog` хранит факт с `offsetDays` и `plannedDate`.

## Фаза 2: Просрочка, изоляция сбоя, алерт администратору

**Цель:** просроченные шаги напоминают о себе раз в неделю не больше
предела; сбой одного адреса не трогает остальных и после четырёх прогонов
становится алертом.
**Затрагивает:** api
**Задачи:**

- [ ] `OVERDUE` в `selectReminders`: `plannedDate < today`, логов этой
      `plannedDate` меньше `OVERDUE_REMINDER_MAX_COUNT`, последний `sentOn`
      старше `today − OVERDUE_REMINDER_INTERVAL_DAYS` либо логов нет.
      **Проверяется тестами (до кода):** `select-reminders.spec.ts` — повод
      в первый прогон после даты и для шага, просроченного ещё до создания
      синистра; через 3 дня после письма повода нет, через 7 есть; пятого
      повода нет; перенос `plannedDate` открывает новую серию.
- [ ] Формулировки просрочки в `reminderMailFor`: «en retard de N jours»;
      `DECLARATION_ASSUREUR` — срок истёк, обратиться к страховщику без
      промедления, без оценки последствий; коды из `INSURER_RULE_CODES`
      (`deadline-rule.seed.ts`) — срок прошёл, уместно relancer страховщика,
      без требований от имени пользователя. **Проверяется тестами (до
      кода):** `reminder-mail.spec.ts` — три формулировки по коду правила;
      в тексте о декларации нет слов о последствиях (проверка по строкам
      локализации, не по регулярному выражению на французский).
- [ ] `AdminAlertService` (`src/jorf/alerts/admin-alert.service.ts`,
      `exports` `JorfModule`): `notifyAdmin` переезжает из
      `JorfMonitorService` без изменения поведения. **Проверяется тестами
      (до кода):** спеки монитора, покрывающие письмо администратору,
      остаются зелёными на новом провайдере; спека сервиса — молчит без
      `ADMIN_EMAIL`, ловит сбой отправки в лог.
- [ ] Изоляция сбоя в `run`: `try/catch` на пользователя, `reminderFailures
    += 1` при исключении сборки или отправки, сброс в 0 в транзакции
      успешной отправки, при равенстве `NOTIFICATION_ATTEMPTS_BEFORE_ALERT` —
      `MonitorAlert NOTIFICATION_STUCK` без `arreteId` и письмо через
      `AdminAlertService`. **Проверяется тестами (до кода):**
      `reminders.int-spec.ts` — транспорт, падающий на одном адресе: второй
      получает письмо, у первого нет строк лога и `reminderFailures = 1`;
      следующий `run` присылает ему письмо, если шаг не отмечен; четыре
      прогона подряд со сбоем создают ровно один алерт и одно письмо
      администратору, пятый — ничего нового; лог без адреса.

**Когда готова:** просроченный шаг получает письма с недельным интервалом
ровно четыре раза и остаётся `EN_RETARD` в ответе `GET /sinistres/:id`;
падение отправки одному адресу не меняет письма остальным и всплывает
алертом после четвёртого прогона.

## Фаза 3: Выключатель в API — по токену и по сессии

**Цель:** ссылка из письма и кнопка кабинета управляют одним флагом;
выключенные напоминания не уходят, письмо о публикации arrêté уходит.
**Затрагивает:** contracts, api
**Задачи:**

- [ ] Contracts: `CurrentUserResponse.remindersEnabled: boolean`,
      `RemindersPreference { enabled: boolean }`; `AuthService.currentUser`
      отдаёт флаг из `remindersDisabledAt`. **Проверяется тестами (до
      кода):** `test/integration/auth/me.int-spec.ts` — новый аккаунт
      отвечает `remindersEnabled: true`, с проставленной датой — `false`.
- [ ] `POST /rappels/desinscription` в `RemindersController` (`@Public()`,
      `@ThrottleByToken()`, DTO наследует `TokenDto`): `updateMany` по хешу
      → `remindersDisabledAt = now`, всегда 204. Пункт о
      `ACCOUNT_MAIL_UNSUBSCRIBE_PATH` в `src/auth/CLAUDE.md` получает ссылку
      на путь напоминаний. **Проверяется тестами (до кода):**
      `reminders.int-spec.ts` — токен из письма выключает; неизвестный токен
      и токен, вытесненный ротацией, отвечают 204 и ничего не меняют;
      токен как `Bearer` даёт 401 и не содержит адреса; выключенный
      пользователь не получает письма при следующем `run`, а ожидающая
      `SinistreNotification` того же пользователя уходит при прогоне
      монитора; ротация при `remindersDisabledAt` не null отменяет письмо.
- [ ] `PATCH /rappels` под `JwtAuthGuard`, DTO `@IsBoolean()`, ответ
      `RemindersPreference`. **Проверяется тестами (до кода):**
      `reminders.int-spec.ts` — `enabled: false` выключает, `true` включает
      обратно и следующий `run` снова шлёт письмо; без `Bearer` 401; чужой
      пользователь не затронут.

**Когда готова:** после `POST` по токену из письма `run` молчит для этого
человека, `PATCH { enabled: true }` возвращает письма со следующего прогона;
`GET /auth/me` показывает текущее состояние.

## Фаза 4: Web — выключение по ссылке из письма

**Цель:** ссылка «Ne plus recevoir de messages» из письма-напоминания
работает: one-click из почтового клиента выключает без входа, человек
видит страницу с одной кнопкой.
**Затрагивает:** web
**Задачи:**

- [ ] `src/lib/api/reminders.ts` (`unsubscribeReminders`,
      `updateReminders`) и фабрика `oneClickUnsubscribeHandlers({ unsubscribe,
    confirmPath })` в `src/lib/one-click-unsubscribe.ts`;
      `veille/desinscription/route.ts` переводится на неё.
      **Проверяется тестами (до кода):** `tests/veille` route-спека остаётся
      зелёной; спека фабрики — `POST` отвечает 200 при успехе API и не-200
      при сбое, `GET` отвечает 307 на `confirmPath` с тем же токеном и не
      зовёт API.
- [ ] `src/app/compte/rappels/desinscription/route.ts` на фабрике.
      **Проверяется тестами (до кода):**
      `tests/compte/rappels-desinscription-route.spec.ts` — те же четыре
      утверждения на новом пути.
- [ ] `TokenConfirmScreen` (`src/components/token-confirm-screen.tsx`:
      `mutationFn`, строки, `AnnouncedResult` + `MessageScreen` + `Button`);
      `VeilleDesinscriptionConfirmer` переводится на него.
      **Проверяется тестами (до кода):** спека страницы veille остаётся
      зелёной.
- [ ] Страница `…/desinscription/confirmer` на `TokenConfirmScreen`, строки
      `fr.compte.rappels.desinscription`, запись в `tests/support/pages.ts`.
      **Проверяется тестами (до кода):**
      `tests/compte/rappels-desinscription-confirmer.spec.ts` — открытие
      страницы не зовёт API; кнопка размера `touch` зовёт `POST`, результат
      объявляется через `role="status"`, фокус уходит на результат; сбой API
      показывает `RequestError`; axe без ошибок, проход с клавиатуры, обе
      темы; все строки из `fr.ts`.

**Когда готова:** `GET` по ссылке письма показывает страницу с одной
кнопкой и ничего не меняет; нажатие и one-click `POST` выключают
напоминания через API; страница проходит axe и клавиатуру.

## Фаза 5: Web — переключатель в кабинете

**Цель:** человек видит в кабинете, включены ли напоминания, и включает их
обратно одной кнопкой.
**Затрагивает:** web
**Задачи:**

- [ ] Раздел «Rappels par e-mail» в `espace-personnel.tsx`: фраза состояния
      по `remindersEnabled` из уже запрошенного `GET /auth/me`, кнопка
      «Désactiver les rappels» / «Réactiver les rappels» на
      `useMutation(updateReminders)` с инвалидацией
      `queryKeys.currentUser()`, результат — через заранее смонтированный
      `role="status"`, строки в `fr.compte.espacePersonnel.rappels`.
      Визуальная проверка по правилу `apps/web/CLAUDE.md` (`/ui-review`) — часть
      задачи. **Проверяется тестами (до
      кода):** `tests/compte/espace-personnel.spec.ts` — с `mockSession` и
      `page.route` на `/auth/me` и `/rappels`: состояние показано текстом,
      нажатие шлёт `PATCH` с противоположным значением, после ответа фраза
      и подпись кнопки меняются, изменение объявлено; сбой показывает
      `RequestError`; axe без ошибок, кнопка достижима с клавиатуры, обе темы.

**Когда готова:** выключенные по ссылке напоминания видны в кабинете как
выключенные и включаются одной кнопкой; страница кабинета проходит axe.
