# CLAUDE.md — `src/dossier`

Досье до аккаунта: что видит посетитель, который ещё не зарегистрировался.
Решения фичи — `docs/research/dossier-preliminaire.md`, план по фазам —
`docs/plan/dossier-preliminaire.md`.

## Правила модуля

- **Только чтение**: ни строки в базе, ни письма.
- **Своей доменной логики модуль не держит.** Даты, сроки и статусы — из
  `src/sinistres/` (`planDossier`, `toStepView`, `declarationDeadlineOf`,
  `legalStepDate`, `toDeclarationDeadline`) и `src/deadline-rules/`
  (`declarationRulesFor`), иначе публичный аперçу и созданный синистр
  разошлись бы в датах; коммуна и её предшественники — из `src/communes/`,
  классификация риска — `classifyRisques` из `src/jorf/parse/`. Своё здесь
  только чтение `ArreteEntry` за окно `COMMUNE_ARRETES_WINDOW_MONTHS` и
  сборка ответа.
- `@Public()` стоит на классе: закрытых маршрутов здесь не появится —
  закрытый ресурс живёт в `src/sinistres/`.
