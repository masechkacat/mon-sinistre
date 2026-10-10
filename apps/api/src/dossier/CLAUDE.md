# CLAUDE.md — `src/dossier`

Досье до аккаунта: что видит посетитель, который ещё не зарегистрировался.
Решения фичи — `docs/research/dossier-preliminaire.md`, план по фазам —
`docs/plan/dossier-preliminaire.md`.

## Правила модуля

- **Только чтение**: ни строки в базе, ни письма.
- **Своей доменной логики модуль не держит** — всё приходит из
  `src/sinistres/` (`planDossier`, `toStepView`, `declarationDeadlineOf`) и
  `src/deadline-rules/` (`resolveDeclaration`, `resolveDeadline`). Иначе
  публичный аперçу и созданный синистр разошлись бы в датах. Срок декларации
  в ответе по коммуне собирается из них на месте: `Step`, из которого его
  читает `declarationDeadlineOf`, у публичного ответа нет.
- `@Public()` стоит на классе: закрытых маршрутов здесь не появится —
  закрытый ресурс живёт в `src/sinistres/`.
