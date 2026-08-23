# CLAUDE.md — `src/auth`

Аккаунт пострадавшего: регистрация, подтверждение, вход, сессия, сброс пароля.
Решения фичи — `docs/research/user-account.md`; разбивка по фазам —
`docs/plan/user-account.md`. Модуль реализует регистрацию, подтверждение,
вход, ротацию refresh, выход, чтение текущего пользователя, удаление
аккаунта (фаза 2), запрос сброса пароля, смену пароля по токену и повторную
регистрацию — как неподтверждённым, так и подтверждённым адресом (фаза 3,
закрыта), лимит писем аккаунта, лимит попыток входа и часовую чистку
(фаза 4, закрыта).

## Точки входа

- `POST /auth/register` → `AuthService.register`; всегда `204`, каким бы ни
  оказался адрес — anti-enumeration (PRD, «Ограничения»). Ветвление — той же
  формы, что `VeilleService.upsertSubscription`: нового адреса нет — создание;
  адрес уже в `User` неподтверждённым — перезапись; адрес подтверждён —
  строка оставлена как есть, письмо «у вас уже есть аккаунт» —
  `alreadyRegisteredMailFor` ниже. Механика каждой ветки — в докблоках
  `register` и `claimUnconfirmedAccount`, здесь не пересказывается.
- `POST /auth/confirmation` → `AuthService.confirm`; мутация — визит по
  ссылке (`GET`, например предзагрузка почтовым клиентом) её не активирует, у
  эндпоинта нет `GET`-пары в отличие от `veille`. Идемпотентен: повторный
  вызов тем же токеном отвечает `{ status: 'confirmed' }` снова, не ошибкой —
  `confirmTokenHash` при активации не стирается, поэтому уже подтверждённый
  аккаунт остаётся `confirmed` и после `confirmExpiresAt`. Неизвестный и
  просроченный неподтверждённый токен дают одинаковый `{ status: 'invalid' }`
  — причина не раскрывается (anti-enumeration, тот же принцип, что у
  `VeilleService.confirm`). Окно подтверждения сравнивается с «сейчас» в одном
  месте на оба модуля — `awaitingConfirmation`
  (`src/common/confirmation-window.ts`). `dto/account-token.dto.ts` (`AccountTokenDto`) —
  пустой класс, наследующий валидацию тела у общего `TokenDto`
  (`src/common/token.dto.ts`, общий с `VeilleTokenDto`); второй копии правила
  не заводить, DTO смены пароля по токену (фаза 3) наследует от того же
  `TokenDto`.
- `is-account-password.decorator.ts` (`IsAccountPassword`) — единственный
  валидатор пароля модуля (правило CNIL cas n° 2 из `@mon-sinistre/contracts`,
  единое французское сообщение из `fr.auth.password.requirements`); DTO сброса
  пароля (фаза 3) переиспользует его, второй не заводить.
- `account-confirmation-mail.ts` (`confirmationMailFor`) — единственная
  сборка письма подтверждения; спека рядом её и зовёт, второго описания не
  заводить. `account-already-registered-mail.ts` (`alreadyRegisteredMailFor`)
  — тем же образом единственная сборка письма «у вас уже есть аккаунт»,
  ссылка — `ACCOUNT_FORGOT_PASSWORD_PATH` (contracts, докблок объясняет
  отличие от `ACCOUNT_RESET_PATH`). `AuthService.sendAccountMail` —
  единственная точка проверки лимита (`ACCOUNT_EMAIL_LIMIT`, скользящие 24
  часа, счётчик `AccountFormEmail` по HMAC-хешу адреса — `hashEmail`,
  `src/common/email-hash.ts`) и точка отправки всех трёх писем фичи
  (подтверждение, «у вас уже есть аккаунт», сброс пароля); один счётчик на
  все три, не отдельный на каждое (`docs/research/user-account.md`), но
  регистрационные письма берут из него лишь `ACCOUNT_REGISTRATION_MAIL_LIMIT`
  — зачем этот резерв, сказано у константы в contracts. Письмо собирается
  `compose`-колбэком **за** проверкой лимита и в её транзакции, поэтому
  ротация токена подтверждения не переживает подавленное письмо (докблоки
  `sendAccountMail` и `register`). Та же форма, что
  `VeilleService.sendFormMail` — письма veille и account считаются раздельно,
  в разных таблицах.
- Генерация и хеширование токена подтверждения — `generateSecureToken`/
  `hashSecureToken` (`src/common/secure-token.ts`, общий с veille):
  `randomBytes(32).base64url` в письмо, `sha256` hex в базу; второй генерации
  здесь не заводить.
- `POST /auth/password-reset` → `AuthService.requestPasswordReset`; always
  `204`, whatever the address turns out to be — anti-enumeration, same
  principle as `register` above. An unknown address does nothing and returns
  at once; a known one — confirmed or not, the confirmation flow above is a
  separate concern — gets a fresh `PasswordReset` row, then its mail. The
  mail is sent after the write, never inside a transaction with it (why —
  `register`'s docblock, same constraint); a delivery failure leaves a row
  whose token nobody holds, which is harmless: it expires on its own, the
  hourly cleanup (phase 4) sweeps it, and a successful reset spends it with
  the rest. `P2003` on the insert — the account deleted between the
  lookup and the write — answers the same as an unknown address, same
  reasoning as `issueTokens`'s own `P2003` handling above. `password-reset-mail.ts`
  (`passwordResetMailFor`) is the one build of that mail; it reuses
  `fr.mail.account.reason` rather than restating why the person is on the
  list.
- `POST /auth/password-reset/confirm` → `AuthService.resetPassword`; the
  endpoint that spends the row above and sets a new password. The atomic
  claim, the anti-enumeration answer, the session revoke, the spending of
  the account's other outstanding rows and the confirmation of a
  not-yet-confirmed account are all in the method's own docblock, not
  repeated here. `dto/reset-password.dto.ts`
  (`ResetPasswordDto`) extends the shared `TokenDto` and reuses
  `IsAccountPassword` for the new password — same policy and message as
  `RegisterDto`, second copy not warranted.
- `POST /auth/login` → `LocalAuthGuard` (`local-auth.guard.ts`, оборачивает
  `passport-local`) → `LocalStrategy` (`local.strategy.ts`) →
  `AuthService.validateCredentials`. Гвард выполняется раньше пайпа — тело
  запроса он читает сырым, а не через провалидированный `LoginDto`, поэтому
  `LocalStrategy.validate` нормализует адрес сам (`normalizeEmail`,
  `src/common/normalize-email.decorator.ts`) и сам же берёт поля из тела
  (`passReqToCallback`): запасной источник passport-local — query string — не
  используется, пароль в URL попал бы в access-логи. `LoginDto` в сигнатуре
  контроллера остаётся только ради `forbidNonWhitelisted` и Swagger. Один
  ответ `401` на все три причины отказа — неизвестный адрес, неверный
  пароль, неподтверждённый аккаунт (`fr.auth.login.invalid`) —
  anti-enumeration, тот же принцип, что у `register`/`confirm` выше;
  `validateCredentials` сверяет пароль даже для неизвестного адреса
  (`dummyPasswordHash`), чтобы отсутствующая строка не отвечала заметно
  быстрее существующей. Тот же метод — единственная точка счётчика
  `LoginAttempt` (лимит попыток входа, фаза 4): порог `LOGIN_ATTEMPT_LIMIT` и
  его основание — `packages/contracts/src/password.ts`, рядом с
  `PASSWORD_RULES_SOURCE` (та же délibération). Хеш адреса — тот же `hashEmail`
  и тот же секрет, что у лимита писем выше; строка пишется только на отказ.
  **Порог гасит только неудачи**: пароль сверяется раньше счётчика, верный
  проходит и счётчик обнуляет (как и завершённый сброс пароля в
  `resetPassword`) — иначе десять чужих неудач в час держали бы владельца
  снаружи бесконечно; «почему» целиком — в докблоке `validateCredentials`.
  Счёт и вставка — под `withAddressLock` (`src/common/address-lock.ts`), общей
  обвязкой атомарности счётчиков по адресу. `AUTH_FORM_RATE_LIMIT`
  (`auth.controller.ts`) — жёсткий `@Throttle` по IP поверх на публичных
  эндпоинтах, которые никому не пишут, `AUTH_MAIL_RATE_LIMIT` — вшестеро
  строже, на тех двух, что шлют письмо на произвольный адрес (`register`,
  `password-reset`); «почему» у каждой константы своё. Успешный вход — `AuthService.login`: access
  (`JWT_SECRET`, `ACCESS_TOKEN_EXPIRY`) в теле ответа, refresh
  (`JWT_REFRESH_SECRET`, срок — `SESSION_INACTIVITY_DAYS` из contracts, не
  переменная окружения: это число web показывает людям) — httpOnly-cookie
  `refresh_token` (`path=/auth`, `SameSite=Strict`, `secure` по
  `HTTPS_ENABLED` — в production он обязателен, `env.validation.ts`
  отказывает старту без него; подписана `COOKIE_SECRET`); `RefreshToken.expiresAt`
  читается из `exp` только что подписанного JWT, не пересчитывается заново —
  строка не может разойтись с токеном, чей хеш она хранит. Оба JWT несут
  `typ` (`TOKEN_TYPE`, `auth.service.ts`): `JwtStrategy` принимает только
  `access`, `refresh` — только `refresh`, а `env.validation.ts` вдобавок
  отказывает старту при `JWT_SECRET === JWT_REFRESH_SECRET` — два замка на
  одну дверь «30-дневная cookie как bearer».
- `POST /auth/refresh` → `AuthService.refresh`. Без тела — токен только из
  cookie `refresh_token`; отсутствующая или не прошедшая проверку подписи
  (`req.unsignCookie`) отвечает `401` (`fr.auth.session.expired`) прямо в
  контроллере, до вызова сервиса. Ротация — одна транзакция: условный
  `updateMany` (`revokedAt: null` в `where`, не read-then-update) и вставка
  новой пары `issueTokens` (общий с `login`). Гонка двух предъявлений одного
  токена решается в базе: проигравший `updateMany` ждёт блокировки строки,
  и к моменту, когда он читает ноль, строка победителя уже закоммичена —
  ветка reuse ниже её не пропустит; сбой вставки откатывает и отзыв, токен
  остаётся действующим. **Инвариант: `revokedAt` ставит только ротация**, всё
  остальное, что кончает токен (`logout`, чистка цепочки, каскад удаления
  аккаунта), строку удаляет. Поэтому `count === 0` при найденной строке
  читается по `revokedAt`: моложе `REFRESH_ROTATION_GRACE_MS` — вторая вкладка
  или ретрай клиента, выдаётся своя свежая пара; старше — replay украденного
  токена, `endAllSessions` (приватный метод, общий со сбросом пароля ниже)
  сносит все живые строки пользователя и отвечает `401`.
  Неизвестный `tokenHash` (никогда не выпускался, либо удалён `logout`'ом;
  чистка просроченных строк по расписанию — `docs/plan/user-account.md`,
  фаза 4) отвечает тем же `401` без цепочки. Один ответ на все причины —
  истёкшая подпись, просроченный JWT, чужой `typ`, реюз, неизвестный токен,
  аккаунт удалён между отзывом и вставкой (`P2003` в `issueTokens`) — тот же
  anti-enumeration принцип, что у `login` выше. `setRefreshCookie` — общий
  приватный метод контроллера, ставит cookie одинаково после `login` и после
  `refresh`. `@Throttle(SESSION_RATE_LIMIT)` на `refresh` и `logout` поверх
  глобального лимита — почему именно на них, сказано у константы.
- `POST /auth/logout` → `AuthService.logout`. Без тела — токен так же только
  из cookie `refresh_token`. В отличие от `refresh`, невалидная (отсутствующая,
  нераспознанная подпись, просроченная) или неизвестная строка токена не
  отвечает `401` — эндпоинт всегда `204`: выход — не место для
  anti-enumeration-ответа `refresh`, вызывающему всё равно нечего узнать из
  различия. Строка удаляется (`deleteMany` по `tokenHash`, инвариант выше):
  запоздалый «тихий» refresh с той же cookie после выхода находит неизвестный
  токен, а не отозванный, и цепочку не гасит — сам факт выхода не сигнал
  кражи. Уходит только предъявленный токен (другие сессии остаются
  вошедшими). Cookie чистится всегда, тем же `clearCookie` с тем же
  `path=/auth`, что и её установка — иначе браузер не найдёт совпадающую
  cookie для удаления.
- Глобальный `JwtAuthGuard` (`jwt-auth.guard.ts`) — зарегистрирован как
  `APP_GUARD` в `app.module.ts`, оборачивает passport-стратегию `jwt`
  (`jwt.strategy.ts`, тот же `JWT_SECRET`, что подписывает access-токен в
  `AuthService.issueTokens`): без валидного `Authorization: Bearer` любой
  эндпоинт отвечает 401. `JwtStrategy.validate` сверх подписи и срока
  проверяет `typ`, `sub` и существование аккаунта — зачем, в его докблоке.
  `public.decorator.ts` (`@Public()`, метаданные + `Reflector`) —
  единственный способ исключить эндпоинт; `JwtAuthGuard.canActivate`
  проверяет её сначала на хендлере, потом на классе контроллера. На классе
  она висит только там, где публичны все точки входа (`CommunesController`,
  `HealthController`, `VeilleController`); в `AuthController` — на каждом
  публичном методе отдельно, чтобы новый хендлер модуля наследовал замок, а
  не исключение.
- `GET /auth/me` → `AuthController.me` → `AuthService.currentUser`;
  возвращает email владельца access-токена (espace personnel). Без
  `@Public()` — проходит через глобальный `JwtAuthGuard`, как любой новый
  эндпоинт по умолчанию. `req.user.id` берётся из `JwtUser`
  (`jwt.strategy.ts`, тот же тип, что кладёт guard на запрос); стратегия уже
  убедилась, что аккаунт есть, так что `P2025` → `404` из `findUniqueOrThrow`
  остаётся только гонке с удалением между guard'ом и запросом — второй ветки
  «не найден» здесь не заводить.
- `DELETE /auth/me` → `AuthController.deleteAccount` → `AuthService.deleteAccount`
  (RGPD, PRD «Ограничения»). Немедленное и физическое удаление —
  `prisma.user.delete`, не soft-delete; `RefreshToken` уходит каскадом по схеме
  (`onDelete: Cascade`), второй запрос на отзыв здесь не нужен. Подтверждение
  действия («вы уверены?») — забота web (`docs/plan/user-account.md`, фаза 5);
  эндпоинт сам ничего не переспрашивает. Cookie `refresh_token` чистится тем
  же приватным `clearRefreshCookie`, что у `logout`, независимо от того, была
  ли она вообще предъявлена. Повторный вызов на уже удалённом аккаунте —
  `401` от `JwtStrategy`, как у `GET /auth/me`.
- `AuthService.cleanupExpired` — `@Cron(EVERY_HOUR)`, единственный часовой
  прогон чистки фичи (`docs/research/user-account.md`, «Чистка: один
  cron-час»): неподтверждённые `User` старше `ACCOUNT_CONFIRM_TTL_DAYS`
  (каскад сносит их `RefreshToken`/`PasswordReset`, тот же
  `expiredUnconfirmed` из `src/common/confirmation-window.ts`, что и у
  veille), просроченные `PasswordReset`, истёкшие `RefreshToken`, счётчики
  `AccountFormEmail`/`LoginAttempt` старше своего окна (`DAY_MS`/`HOUR_MS`,
  те же, что у `sendAccountMail` и `validateCredentials` выше). Каждый
  `deleteMany` идёт через `runGuarded` (`src/common/scheduled-cleanup.ts`,
  общий с `VeilleService.cleanupExpired`) — падение одного не стоит хода
  остальным; второй копии этой обвязки не заводить. Что расписание вообще
  взведено, проверяет единственная спека модуля, поднимающая планировщик, —
  `auth-schedule.spec.ts` (её докблок объясняет, почему без неё удаление
  `@Cron` оставило бы прогон зелёным).
- `@fastify/cookie` регистрируется общей функцией `registerCookiePlugin`
  (`src/config/fastify-cookie.ts`) — и в `main.ts`, и в `createIntTestApp`
  (`src/app.int-helper.ts`): без неё `reply.setCookie` не существует ни в
  проде, ни в интеграционных тестах.
- `ACCOUNT_MAIL_UNSUBSCRIBE_PATH` (contracts) — выделенный путь без страницы:
  ни одноразовый токен другого письма того же аккаунта (предзагрузка ссылок
  `List-Unsubscribe` некоторыми почтовыми клиентами потратила бы токен
  подтверждения или сброса раньше владельца), ни страничный путь вроде
  `ACCOUNT_CONFIRM_PATH` или главной (`route.ts` не уживается с `page.tsx` в
  одном сегменте Next.js — обработчика там никогда не будет). Обработчик —
  `apps/web/src/app/compte/desabonnement/route.ts`: `POST` отвечает пустым
  `200`, `GET` уводит человека на главную.

## Anti-enumeration: временная асимметрия по времени ответа

Одна оставшаяся пара веток занимает разное время — известный, пока не
закрытый пробел: PRD требует неразличимости ответа (кода и тела), временной
канал в это требование не входит и тестами не проверяется.

- `register`: все три ветки — новый адрес, неподтверждённый, подтверждённый —
  теперь ждут `mail.send()` (как у трёх веток `upsertSubscription` в veille),
  асимметрии между ними нет.
- `requestPasswordReset`: ветка известного адреса создаёт `PasswordReset` и
  ждёт `mail.send()`, ветка неизвестного отвечает сразу — неизвестному адресу
  писать попросту нечего, а встречной задачи, которая создала бы ему письмо
  ради выравнивания времени, в плане фичи нет.
