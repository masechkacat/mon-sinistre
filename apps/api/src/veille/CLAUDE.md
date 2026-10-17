# CLAUDE.md — `src/veille`

Подписка на уведомления об arrêté по коммунам и изменение состава
подтверждённой подписки. Решения — `docs/research/veille-subscription-lifecycle.md`
и `docs/research/veille-commune-change.md`. Семантика ответов — в
`@ApiOperation` контроллера, механика веток — в докблоках методов; здесь
только то, что из кода не видно, и что нельзя завести второй раз.

## Точки входа

| Эндпоинт                          | Метод                            | Что не видно из кода                                                                            |
| --------------------------------- | -------------------------------- | ----------------------------------------------------------------------------------------------- |
| `POST /veille`                    | `VeilleService.subscribe`        | `204` и `429` не зависят от адреса — enumeration-оракула нет                                    |
| `GET /veille/confirmation?token=` | `getConfirmationStatus`          | токен голым `@Query`, не DTO                                                                    |
| `POST /veille/confirmation`       | `confirm`                        | `classifyConfirmation` — единственный источник `pending \| active \| invalid` для обоих         |
| `POST /veille/desinscription`     | `unsubscribe`                    | под `@ThrottleByToken`; `POST /veille/changement` — без него (почему — research «Контракт API») |
| `GET`/`POST /veille/changement`   | `getChangeStatus`, `applyChange` | удаление заявки — сам атомарный захват, второго поиска по хешу нет                              |

## Инварианты

- **Токен в query, не в сегменте пути**: `AllExceptionsFilter` логирует путь
  без query, токен в `/:token` утёк бы в лог при первом сбое.
- `Veille`: `pending` → `active` → удалена, третьего пути нет; заявка
  `VeilleChange` 1:1 к `Veille`, исчезает применением, просрочкой или
  каскадом отписки — одним приёмом (`deleteMany`/`onDelete: Cascade`).
- Коды коммун дедуплицируются до сверки со справочником (`findMany` с
  `effectiveTo: null`); неизвестный код — `400` до вставки.
- Счётчик `VeilleFormEmail` переживает удаление подписки; его чистка —
  `deleteStaleFormEmailCounters`.
- `VeilleService.sendFormMail` — единственная точка лимита
  (`VEILLE_FORM_EMAIL_DAILY_LIMIT`) и отправки писем формы; композиция —
  колбэком за гейтом лимита.
- `mintUnsubscribeToken` — единственная чеканка `VeilleUnsubscribeToken`;
  её зовут и `rotateAndSendChangeMail`, и монитор JORF.
- `VeilleTokenDto` наследует общий `TokenDto` (`src/common/http/`).
- `*-mail.ts` — по одной сборке на письмо; письмо изменения состава уходит на
  любую повторную форму подтверждённого адреса, ссылка ведёт на заявку, не
  применяет её.
