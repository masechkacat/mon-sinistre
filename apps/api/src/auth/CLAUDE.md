# CLAUDE.md — `src/auth`

Аккаунт пострадавшего: регистрация, подтверждение, вход, сессия. Решения
фичи — `docs/research/user-account.md`; разбивка по фазам —
`docs/plan/user-account.md`. Модуль пока (фаза 1) реализует регистрацию,
подтверждение и вход; остальные точки входа добавляются фаза за фазой,
документируются здесь по мере появления.

## Точки входа

- `POST /auth/register` → `AuthService.register`; всегда `204`, каким бы ни
  оказался адрес — anti-enumeration (PRD, «Ограничения»). Адрес, уже
  присутствующий в `User` (подтверждённый или нет), остаётся нетронутым: ни
  дублирующей строки, ни ошибки, ни второго письма. Переписать пароль
  неподтверждённого аккаунта и переслать письмо, либо отправить подтверждённому
  адресу письмо «у вас уже есть аккаунт» — `docs/plan/user-account.md`,
  фаза 3, пока не реализовано. Строка и письмо — одна транзакция: при сбое
  отправки аккаунт откатывается, и повтор формы регистрирует заново, а не
  попадает в ветку дубля без письма.
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
  заводить.
- Генерация и хеширование токена подтверждения — `generateSecureToken`/
  `hashSecureToken` (`src/common/secure-token.ts`, общий с veille):
  `randomBytes(32).base64url` в письмо, `sha256` hex в базу; второй генерации
  здесь не заводить.
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
  быстрее существующей. Успешный вход — `AuthService.login`: access
  (`JWT_SECRET`, `ACCESS_TOKEN_EXPIRY`) в теле ответа, refresh
  (`JWT_REFRESH_SECRET`, `REFRESH_TOKEN_EXPIRY`) — httpOnly-cookie
  `refresh_token` (`path=/auth`, `SameSite=Strict`, `secure` по
  `HTTPS_ENABLED` — в production он обязателен, `env.validation.ts`
  отказывает старту без него; подписана `COOKIE_SECRET`); `RefreshToken.expiresAt`
  читается из `exp` только что подписанного JWT, не пересчитывается заново —
  строка не может разойтись с токеном, чей хеш она хранит. Ротация и чтение
  cookie — `docs/plan/user-account.md`, фаза 2.
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

Ветка нового адреса (`register` создаёт строку и ждёт `mail.send()`) и ветка
уже занятого адреса (`isUniqueViolationOn` ловит `P2002` и отвечает сразу)
занимают разное время: у veille все три ветки `upsertSubscription`
дожидаются какой-нибудь отправки письма ради этого самого равенства, а здесь
переписать пароль и переслать письмо неподтверждённому адресу — фаза 3
(`docs/plan/user-account.md`), которой в этой фазе нет. До неё разница во
времени ответа отличает существующий адрес от нового; PRD требует
неразличимости ответа (кода и тела), временной канал — известный, пока не
закрытый пробел, а не то, что тесты этой фазы проверяют.
