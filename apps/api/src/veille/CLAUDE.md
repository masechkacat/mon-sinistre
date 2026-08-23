# CLAUDE.md — `src/veille`

Подписка на уведомления об arrêté по выбранным коммунам. Решения фичи —
`docs/research/veille-subscription-lifecycle.md`; план по фазам —
`docs/plan/veille-subscription-lifecycle.md`. Изменение состава коммун уже
подтверждённой подписки — `docs/research/veille-commune-change.md`, план —
`docs/plan/veille-commune-change.md`.

## Точки входа

Семантика ответов каждого эндпоинта — в его `@ApiOperation`
(`veille.controller.ts`), здесь не пересказывается. Что оттуда не видно:

- `POST /veille` → `VeilleService.subscribe`; `204` и `429` зависят только от
  запроса, не от адреса, — enumeration-оракула здесь нет.
- `GET /veille/confirmation?token=…` → `VeilleService.getConfirmationStatus`;
  токен читается голым `@Query('token')`, не DTO — почему, сказано у
  обработчика.
- `POST /veille/confirmation` → `VeilleService.confirm`; каскад
  переходов — `classifyConfirmation` в сервисе, единственный источник решения
  `pending | active | invalid` для обоих эндпоинтов confirmation.
- `POST /veille/desinscription` → `VeilleService.unsubscribe`; каскад
  `VeilleCommune` сносится вместе с `Veille`. Единственный маршрут под
  `@ThrottleByToken` (`src/common/http/token-throttler.guard.ts`) — почему, сказано
  у декоратора.
- `GET /veille/changement?token=…` → `VeilleService.getChangeStatus`; почему
  один `findFirst`, а не `findUnique` — докблок метода.
- `POST /veille/changement` → `VeilleService.applyChange`; удаление заявки —
  сам атомарный захват (докблок метода), второго поиска по хешу заводить не
  нужно. Без `@ThrottleByToken` — почему, research «Контракт API».
- `dto/veille-token.dto.ts` (`VeilleTokenDto`) — одна DTO с полем `token` для
  обоих `POST`; сама валидация — в общем `TokenDto` (`src/common/http/token.dto.ts`,
  общий с account-подтверждением, `src/auth/`), второй копии правила не
  заводить.
- `veille-confirmation-mail.ts` — единственная сборка письма подтверждения;
  её же зовёт спека рядом, второго описания того же письма не заводить.
- `veille-change-mail.ts` — единственная сборка письма изменения состава
  (уходит подтверждённому адресу на любую повторную форму, в том числе с
  прежним составом; ссылка ведёт на заявку `VeilleChange`, не применяет её
  сама); её же зовёт
  спека рядом, второго описания того же письма не заводить.
- `veille-token.ts` — единственный способ получить пару токен/хеш
  (`generateVeilleToken`) и пересчитать хеш по токену (`hashVeilleToken`,
  используется и статусом подтверждения, и отпиской — оба ищут `Veille` по
  своему хешу): `randomBytes(32).base64url` в письмо, `sha256` hex в базу.
  Сама механика — в `src/common/security/secure-token.ts` (общая с токеном
  подтверждения аккаунта, `src/auth/`); этот файл — только переименование под
  привычные здесь имена, второй генерации не заводить.
- `veille-email-hash.ts` (`hashVeilleFormEmail`) — тонкий ре-экспорт общей
  HMAC-утилиты `hashEmail` (`src/common/security/email-hash.ts`, общая со счётчиками
  аккаунта, `src/auth/`) под привычным здесь именем; получает
  `VeilleFormEmail.emailHash` на `VEILLE_EMAIL_HASH_SECRET`, второй свёртки
  адреса не заводить. `VeilleService.sendFormMail` — единственная точка проверки лимита
  (`VEILLE_FORM_EMAIL_DAILY_LIMIT`, скользящие 24 часа) и точка отправки
  писем формы: все три письма (создание, `resendConfirmationMail`,
  `rotateAndSendChangeMail`) уходят через неё, не через `MailService.send()`
  напрямую. Композиция — callback за гейтом лимита; почему — docblock
  `sendFormMail`.

## Почему токен живёт в query, а не в сегменте пути

`AllExceptionsFilter` логирует путь запроса без query-строки (и только для
5xx, `apps/api/CLAUDE.md`). Токен в `/veille/confirmation?token=…` эту
гарантию наследует бесплатно; тот же токен в `/veille/confirmation/:token`
утёк бы в лог при первом же случайном сбое эндпоинта.

## Ветка `subscribe` реализует все три сценария research

Ветвление, гонка `P2002` и перевыпуск ссылок повторных писем — в
docblock'ах `VeilleService.upsertSubscription`, `claimUnconfirmed` и
`resendConfirmationMail`, здесь не пересказывается. Ветка подтверждённого
адреса (заявка `VeilleChange`, а не письмо «déjà inscrit·e») — docblock'и
`upsertChangeRequest` (запись заявки, гонка с каскадом отписки) и
`rotateAndSendChangeMail` (ротация токенов и перечитывание состава внутри
одной транзакции); заявка живёт 1:1 к `Veille`
(`docs/research/veille-commune-change.md`, `data-model.md` § 6) и не влияет
на действующий состав до подтверждения по отдельной ссылке (фаза 2).

Коды коммун дедуплицируются до сверки со справочником — иначе повторённый в
форме код читался бы как несуществующий (сравнение шло бы с длиной исходного
массива). Сверка — один `findMany` с `effectiveTo: null`; неизвестный код
отвечает `400` до всякой попытки вставки, поэтому FK-нарушение
(`VeilleCommune_codeInsee_fkey`) в этом пути никогда не срабатывает.

## Жизненный цикл подписки и что переживает её удаление

`Veille` проходит `pending` → `active` → удалена — третьего способа исчезнуть
нет. Механика обоих путей удаления (отписка, часовая чистка просроченной
неподтверждённой) — докблоки `unsubscribe` и `deleteExpiredUnconfirmed`;
почему обе чистки висят на одном `@Cron` и почему каждая изолирована от
соседних — докблок `VeilleService.cleanupExpired`. Здесь не пересказывается.

Счётчик писем формы (`VeilleFormEmail`) удаление подписки переживает: чем он
за неё держится и на каком сроке уходит сам — докблок
`deleteStaleFormEmailCounters`.

## Жизненный цикл заявки на изменение состава

Заявка `VeilleChange` (1:1 к `Veille`, см. выше) исчезает одним из трёх
путей — применена (`applyChange` удаляет строку внутри той же транзакции, что
переписывает `VeilleCommune`), просрочена (третья guarded-ветка
`cleanupExpired` — докблок `deleteExpiredChanges`, почему без индекса) или
снесена каскадом вместе с подпиской при отписке. Все три — один и тот же
приём (`deleteMany`/`onDelete: Cascade`), второй код чистки не заводить;
`deleteExpiredChanges` не читает и не пишет `Veille`/`VeilleCommune`, поэтому
подписка при просрочке заявки продолжает жить в прежнем составе.
