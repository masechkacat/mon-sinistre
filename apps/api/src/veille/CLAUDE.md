# CLAUDE.md — `src/veille`

Подписка на уведомления об arrêté по выбранным коммунам. Решения фичи —
`docs/research/veille-subscription-lifecycle.md`; план по фазам —
`docs/plan/veille-subscription-lifecycle.md`.

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
  `VeilleCommune` сносится вместе с `Veille`.
- `dto/veille-token.dto.ts` (`VeilleTokenDto`) — одна DTO с полем `token` для
  обоих `POST`, второй такой же не заводить.
- `veille-confirmation-mail.ts` — единственная сборка письма подтверждения;
  её же зовёт спека рядом, второго описания того же письма не заводить.
- `veille-already-subscribed-mail.ts` — единственная сборка письма «déjà
  inscrit·e» (уходит подтверждённому адресу при повторной форме); её же
  зовёт спека рядом, второго описания того же письма не заводить.
- `veille-token.ts` — единственный способ получить пару токен/хеш
  (`generateVeilleToken`) и пересчитать хеш по токену (`hashVeilleToken`,
  используется и статусом подтверждения, и отпиской — оба ищут `Veille` по
  своему хешу): `randomBytes(32).base64url` в письмо, `sha256` hex в базу,
  второй генерации не заводить.
- `veille-email-hash.ts` (`hashVeilleFormEmail`) — единственный способ
  получить `VeilleFormEmail.emailHash` (HMAC-SHA256 на
  `VEILLE_EMAIL_HASH_SECRET`); второй свёртки адреса не заводить.
  `VeilleService.sendFormMail` — единственная точка проверки лимита
  (`VEILLE_FORM_EMAIL_DAILY_LIMIT`, скользящие 24 часа) и точка отправки
  писем формы: все три письма (создание, `resendConfirmationMail`,
  `sendAlreadySubscribedMail`) уходят через неё, не через
  `MailService.send()` напрямую. Композиция — callback за гейтом лимита;
  почему — docblock `sendFormMail`.

## Почему токен живёт в query, а не в сегменте пути

`AllExceptionsFilter` логирует путь запроса без query-строки (и только для
5xx, `apps/api/CLAUDE.md`). Токен в `/veille/confirmation?token=…` эту
гарантию наследует бесплатно; тот же токен в `/veille/confirmation/:token`
утёк бы в лог при первом же случайном сбое эндпоинта.

## Ветка `subscribe` реализует все три сценария research

Ветвление, гонка `P2002`, состав письма «déjà inscrit·e» и перевыпуск
ссылок повторных писем — в docblock'ах `VeilleService.upsertSubscription`,
`resubscribeUnconfirmed`, `resendConfirmationMail` и
`sendAlreadySubscribedMail`, здесь не пересказывается.

Коды коммун дедуплицируются до сверки со справочником — иначе повторённый в
форме код читался бы как несуществующий (сравнение шло бы с длиной исходного
массива). Сверка — один `findMany` с `effectiveTo: null`; неизвестный код
отвечает `400` до всякой попытки вставки, поэтому FK-нарушение
(`VeilleCommune_codeInsee_fkey`) в этом пути никогда не срабатывает.
