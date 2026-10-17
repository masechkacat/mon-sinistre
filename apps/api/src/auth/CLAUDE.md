# CLAUDE.md — `src/auth`

Аккаунт пострадавшего: регистрация, подтверждение, вход, сессия, сброс и смена
пароля, удаление, часовая чистка. Решения — `docs/research/user-account.md`.
Механика каждой ветки — в докблоке метода; здесь только то, что из кода не
видно, и что нельзя завести второй раз.

## Точки входа

| Эндпоинт                            | Метод                                                      | Что не видно из кода                                                                                                   |
| ----------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `POST /auth/register`               | `AuthService.register`                                     | три ветки по состоянию адреса той же формы, что `VeilleService.upsertSubscription`                                     |
| `POST /auth/confirmation`           | `AuthService.confirm`                                      | идемпотентен: `confirmTokenHash` не стирается                                                                          |
| `POST /auth/password-reset`         | `AuthService.requestPasswordReset`                         | письмо после записи, не в транзакции с ней                                                                             |
| `POST /auth/password-reset/confirm` | `AuthService.resetPassword`                                | тратит строку, гасит все сессии, подтверждает неподтверждённый аккаунт                                                 |
| `POST /auth/login`                  | `LocalAuthGuard` → `LocalStrategy` → `validateCredentials` | гвард читает тело до пайпа, поэтому стратегия нормализует адрес сама                                                   |
| `POST /auth/refresh`                | `AuthService.refresh`                                      | токен только из cookie; ротация — условный `updateMany` в транзакции, гонка решается в базе                            |
| `POST /auth/logout`                 | `AuthService.logout`                                       | строка удаляется, cookie чистится тем же `path=/auth`                                                                  |
| `GET /auth/me`, `DELETE /auth/me`   | `currentUser`, `deleteAccount`                             | удаление физическое, каскадом; `P2025` здесь — только гонка с удалением между guard'ом и запросом                      |
| `@Cron(EVERY_HOUR)`                 | `AuthService.cleanupExpired`                               | единственный часовой прогон фичи, каждая ветка под `runGuarded`; взведение расписания сторожит `auth-schedule.spec.ts` |

## Инварианты

- **Anti-enumeration**: `register`, `password-reset`, `confirm`, `login`,
  `refresh` отвечают одинаково на все причины отказа. Временной канал не
  закрыт у `requestPasswordReset` (неизвестный адрес отвечает сразу) — известный
  пробел, PRD его не требует.
- **`revokedAt` ставит только ротация**; всё остальное (`logout`, чистка,
  каскад) строку удаляет. Поэтому `count === 0` при найденной строке читается
  по возрасту `revokedAt`: моложе `REFRESH_ROTATION_GRACE_MS` — вторая вкладка,
  старше — replay, `endAllSessions`.
- Оба JWT несут `typ`; стратегии принимают только свой; `env.validation.ts`
  отказывает старту при `JWT_SECRET === JWT_REFRESH_SECRET`.
- Срок refresh — `SESSION_INACTIVITY_DAYS` из contracts (web показывает это
  число людям), не переменная окружения; `RefreshToken.expiresAt` читается из
  `exp` подписанного JWT.
- Глобальный `JwtAuthGuard` (`APP_GUARD`): `@Public()` — единственный способ
  открыть эндпоинт; на классе только там, где публичны все методы, в
  `AuthController` — на каждом отдельно.
- `AuthService.sendAccountMail` — единственная точка лимита
  (`ACCOUNT_EMAIL_LIMIT`, счётчик `AccountFormEmail` по `hashEmail`) и отправки
  всех писем фичи; композиция — колбэком за гейтом лимита, в его транзакции.
- `validateCredentials` — единственная точка `LoginAttempt`
  (`LOGIN_ATTEMPT_LIMIT`, contracts); порог гасит только неудачи, верный пароль
  обнуляет счётчик; счёт под `withAdvisoryLock`.
- `drainPendingDossier` — единственное превращение `DossierEnAttente` в синистр;
  зовут `confirm` и `resetPassword`.
- Общее с veille: `TokenDto`, `awaitingConfirmation`/`expiredUnconfirmed`
  (`src/common/time/`), `registerCookiePlugin` (`src/config/`).
- `IsAccountPassword` — единственный валидатор пароля (правило CNIL из
  contracts); `mails/*-mail.ts` — по одной сборке на письмо.
- `ACCOUNT_MAIL_UNSUBSCRIBE_PATH` — путь без страницы: одноразовый токен
  другого письма тратился бы предзагрузкой `List-Unsubscribe`, а `route.ts` не
  уживается с `page.tsx` в одном сегменте. Обработчик —
  `apps/web/src/app/compte/desabonnement/route.ts`.
