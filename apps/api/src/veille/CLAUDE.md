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
- `veille-token.ts` — единственный способ получить пару токен/хеш
  (`generateVeilleToken`) и пересчитать хеш по токену (`hashVeilleToken`,
  используется и статусом подтверждения, и отпиской — оба ищут `Veille` по
  своему хешу): `randomBytes(32).base64url` в письмо, `sha256` hex в базу,
  второй генерации не заводить.

## Почему токен живёт в query, а не в сегменте пути

`AllExceptionsFilter` логирует путь запроса без query-строки (и только для
5xx, `apps/api/CLAUDE.md`). Токен в `/veille/confirmation?token=…` эту
гарантию наследует бесплатно; тот же токен в `/veille/confirmation/:token`
утёк бы в лог при первом же случайном сбое эндпоинта.

## Ветка `subscribe` реализует пока одну треть сценария

`VeilleService.subscribe` пишет `Veille` + `VeilleCommune` только для адреса,
которого ещё нет в базе. Две другие ветки research (неподтверждённый адрес
переписывает состав, подтверждённый получает письмо «déjà inscrit·e») — фаза 3.
До неё вторая форма тем же адресом падает на уникальном индексе `email`;
`subscribe` ловит `P2002` (`isUniqueViolationOn`, `src/prisma/prisma-error.ts`)
и просто ничего не делает — ответ `204` тот же, что у новой подписки, а строка в
базе остаётся той, что создала первая форма. Не переводить эту ошибку через
общий маппинг Prisma: `409` на этом эндпоинте был бы enumeration-оракулом.

Отсюда же дыра, которую закрывает та же фаза 3. Письмо уходит после записи
(`MailService.send`, единственная точка выхода почты — `src/mail/CLAUDE.md`):
сбой провайдера не откатывает подписку и отдаёт `500`, потому что по research
повтор формы должен попасть в ветку 2 и перевыпустить письмо. Пока ветки 2 нет,
повтор попадает в проглоченный `P2002`, и адрес не может подписаться до
истечения `confirmExpiresAt`. Компенсирующего удаления здесь нет намеренно: оно
противоречило бы решению research и удалялось бы вместе с фазой 3.

Коды коммун дедуплицируются до сверки со справочником — иначе повторённый в
форме код читался бы как несуществующий (сравнение шло бы с длиной исходного
массива). Сверка — один `findMany` с `effectiveTo: null`; неизвестный код
отвечает `400` до всякой попытки вставки, поэтому FK-нарушение
(`VeilleCommune_codeInsee_fkey`) в этом пути никогда не срабатывает.
