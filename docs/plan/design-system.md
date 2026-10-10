# Plan: Дизайн-система — фундамент и бейдж дедлайна

**PRD**: docs/prd/design-system.md
**Research**: docs/research/design-system.md (04.10.2026). Технические
решения (роли → переменные shadcn, `data-surface="papier"`, `next/font/local`,
`daysLeft`/`delay` в ответе API, порог в contracts, тесты контраста и
снимков, статус «non conforme» в déclaration) приняты там; задачи ниже их
применяют, а не перевыбирают. Отступления реализации фиксируются врезкой
«Исправлено при реализации» в самом отчёте.
**Дата**: 2026-10-04

Новых зависимостей и переменных окружения нет. Предусловие владельца
выполнено 04.10.2026: файлы шрифтов лежат в `apps/web/src/app/fonts/` —
`Luciole-{Regular,Bold,Italic,BoldItalic}.woff2` (v2.001,
`Luciole_webfonts.zip`, luciole-vision.com) и `Newsreader-variable.woff2`
(roman `[opsz,wght]` из `fonts/variable/woff2` репозитория
productiontype/Newsreader) с `LICENSE-luciole.txt` и `OFL-newsreader.txt`;
цикл сеть не поднимает и ничего не скачивает.

## Фаза 1: Бумага, чернила, шрифты на всех страницах (Tracer Bullet)

**Цель:** все существующие страницы в обеих темах стоят на новых токенах и
шрифтах и проходят axe; ни одна страница не пересобрана — перекрашены через
переменные. После фазы продукт выглядит по-своему, даже без бейджа.
**Затрагивает:** web
**Задачи:**

- [ ] `fonts.ts`: `luciole` (`--font-sans`, четыре начертания, `display:
'swap'`) и `newsreader` (`--font-heading`, вариативный roman) через
      `next/font/local`; Geist и импорт `next/font/google` удалены;
      `layout.tsx` и `global-error.tsx` применяют оба; `PageTitle` получает
      `font-heading`. **Проверяется тестами (до кода):**
      `tests/a11y/fonts.spec.ts` — на главной `page.on('request')` не видит
      `fonts.googleapis.com` / `fonts.gstatic.com`, у `body` вычисленное
      `font-family` начинается с Luciole, у `h1` — с Newsreader; тест по
      исходникам: строки `googleapis`/`gstatic` не встречаются в `src/`.
- [ ] `globals.css`: роли `--fond … --petrole` (светлая) и `--texte-sur-fond`,
      `--secondaire-sur-fond`, `--filet-sur-fond` (тёмная) hex-кодами с
      чистовика; переменные shadcn по таблице research; `--color-vermillon`,
      `--color-petrole` в `@theme inline`; `--radius: 0.25rem`; `--sidebar-*`
      и `--chart-*` удалены; клон в baseline jscpd пересобран, если блок
      исчез. **Проверяется тестами (до кода):**
      `tests/a11y/tokens.spec.ts` — пары чистовика (encre/papier,
      secondaire/papier, vermillon/papier, petrole/papier, papier/petrole,
      texte-sur-fond/fond, secondaire-sur-fond/fond, filet/fond тёмной) через
      формулу WCAG из `tests/support/contrast.ts` не ниже 4.5:1 (3:1 для
      рамок), значения читаются из `globals.css`; тест по исходникам —
      hex-литералы, `black`, `white` вне блока ролей `globals.css`
      отсутствуют; существующий `a11y.spec.ts` остаётся зелёным по всем
      страницам в обеих темах.
- [ ] Поверхность papier: `Card` ставит `data-surface="papier"`, правило
      `[data-surface='papier']` в `globals.css` возвращает `--foreground`,
      `--muted-foreground`, `--border`, `--primary`, `--primary-foreground`,
      `--ring` к значениям листа. **Проверяется тестами (до кода):**
      `tests/a11y/surface.spec.ts` — в тёмной теме на `/espace-personnel`
      (session-mock) вычисленный `color` текста внутри карточки равен encre,
      заголовка страницы вне карточки — texte sur fond; в светлой оба — encre;
      кнопка `default` вне карточки в тёмной теме имеет фон texte sur fond и
      текст encre, внутри карточки — фон petrole.
- [ ] `Button`: вариант `destructive` удалён, `touch` — 48 px (`h-12`);
      удаление синистра и аккаунта — `variant="outline"` с прежним
      `AlertDialog`; панель удаления в `espace-personnel.tsx` без
      `bg-destructive/*` и `border-destructive/*`, заголовок остаётся
      `text-destructive`. **Проверяется тестами (до кода):** тест по
      исходникам — `destructive` и `vermillon` не встречаются в `button.tsx`
      и в `link`-классах; спеки `compte/` и `sinistres/` находят кнопки
      подтверждения по тексту и проходят; у кнопки `touch` высота 48 px.

**Когда готова:** `npm run test:web` зелёный целиком: axe по каждой странице
в обеих темах, пары токенов не ниже порогов, шрифты только с собственного
origin, Newsreader на h1 и нигде больше на главной; визуальная проверка
каждой страницы в обеих темах выполнена (Playwright MCP), ревью через
`/ui-review` пройдено.

## Фаза 2: Остаток дней и порог — contracts и API

**Цель:** ответ API несёт всё, из чего клиент вычислит восемь состояний
бейджа без собственного календаря: `daysLeft` и `delay` у каждого шага,
порог киновари — одна константа contracts.
**Затрагивает:** contracts, api
**Задачи:**

- [ ] Contracts: `DEADLINE_URGENT_THRESHOLD_DAYS = 7` рядом с
      `SOON_THRESHOLD_DAYS` с докблоком «продуктовое решение владельца
      04.10.2026, не юридический срок»; `Step` получает `daysLeft: number |
null` и `delay: { value: number; unit: DurationUnit } | null`; фикстуры
      `apps/web/tests/support/sinistres.ts` и моки web получают оба поля в
      том же коммите (иначе типы не собираются). **Проверяется тестами (до
      кода):** `npm run build:contracts`, затем `tsc` API и web против новых
      типов.
- [ ] API: `toStepResponse` считает `daysLeft` через `daysBetween(today,
plannedDate)` от того же `todayInParis`, что `declarationDeadlineOf`,
      null без даты; `delay` берётся из `deadlineRule` шага (значение и
      единица), null у шага без правила; выборки `SinistresService`,
      отдающие шаги, подгружают правило. **Проверяется тестами (до кода):**
      `to-sinistre-detail.spec.ts` — `daysLeft` для даты вчера (−1), сегодня
      (0), через 7 (7), null без даты; `delay` равен правилу шага и null без
      правила; `daysLeft` шага срока декларации совпадает с
      `declarationDeadline.daysLeft`; e2e-спека `GET /sinistres/:id`
      проверяет оба поля в теле ответа.

**Когда готова:** `GET /sinistres/:id` возвращает у каждого шага `daysLeft` и
`delay`, тесты API зелёные, contracts экспортирует порог; web собирается без
изменений поведения.

## Фаза 3: Бейдж дедлайна на экране синистра

**Цель:** шапка синистра показывает бейдж-«шапку» срока декларации, каждый
шаг с датой — бейдж-«строку»; все восемь состояний различимы словом и формой
в обеих темах, прежнее текстовое отображение дат и статусов удалено.
**Затрагивает:** web
**Задачи:**

- [ ] `src/lib/deadline-badge.ts`: enum `DeadlineBadgeState` и
      `deadlineBadgeState({ status, daysLeft })` по порядку research
      (статусы раньше чисел), порог — из contracts. **Проверяется тестами
      (до кода):** `tests/components/deadline-badge-state.spec.ts` без
      браузера — 8 → norme, 7 → derniereSemaine, 1 → demain, 0 → aujourdhui,
      −1 → enRetard, FAIT с −3 → fait, NON_APPLICABLE → sansObjet, null →
      dateAVenir; при подмене порога граница сдвигается.
- [ ] `src/i18n/date.ts`: `formatDateShortFr` («jeu. 15 oct.») и
      `dateParts` (месяц капителью «OCT.», день «15», день недели «JEUDI»)
      на `Intl` с `timeZone: 'UTC'` и `formatToParts`. **Проверяется
      тестами (до кода):** в `i18n.spec.ts` рядом с `formatDateFr` —
      2026-10-15 → «jeu. 15 oct.» и части; границы 1 января и 31 декабря
      без сдвига дня.
- [ ] `src/components/deadline-badge.tsx`: формы `hero` и `row`, восемь
      состояний, `data-surface="papier"`, число в `font-heading` с
      `data-slot="deadline-number"`, материал CSS (перфорация, второй лист,
      штемпель, пунктир); строки состояний в `fr.ts` («dernière semaine»,
      «demain», «aujourd'hui, dernier délai», «en retard», «fait le …»,
      «sans objet», «date à venir», «N jours après l'arrêté» из `delay`);
      тестовая страница `/test-bejdz` под `TEST_ROUTES` со всеми состояниями
      обеих форм, кнопкой и ссылкой на fond и на papier, зарегистрирована в
      `tests/support/pages.ts`. **Проверяется тестами (до кода):**
      `tests/components/deadline-badge.spec.ts` — у каждого состояния текст
      содержит его слово и дату или объяснение; снимки
      `toHaveScreenshot` каждого состояния и формы в обеих темах, в цвете и
      с `filter: grayscale(1)`; тест «Newsreader в двух местах» — у всех
      текстовых узлов страницы, кроме `h1` и `[data-slot=deadline-number]`,
      `font-family` начинается с Luciole; тест по исходникам — `petrole` не
      встречается в `deadline-badge.tsx`; через реестр страниц — axe в обеих
      темах, reflow 320 px без горизонтальной прокрутки, reduced-motion.
- [ ] Интеграция в `sinistre-detail.tsx`: `hero` в `DeclarationDeadlineBlock`
      вместо строк `dateLimite`/`remaining`, `row` в карточке шага вместо
      `stepStatus` и `datePrevue`; `SourceNote` остаётся; неиспользуемые
      строки `fr.ts` удалены. **Проверяется тестами (до кода):** спеки
      `sinistres/` — по фикстурам с `daysLeft` 30, 7, 0, −3, FAIT и null
      страница показывает соответствующие слова состояний и даты, старых
      строк «Date prévue le …» и «Il reste N jours» в DOM нет; снимок карточки
      выполненного шага рядом с невыполненным — выполненный тусклее, без
      зелёного (`color`/`background-color` ни одного узла не в зелёном
      диапазоне оттенка); axe в обеих темах на `/sinistres/[id]`.

**Когда готова:** на экране синистра бейджи обеих форм во всех состояниях из
фикстур, прежнее отображение удалено, снимки-эталоны в репозитории, `npm run
test:web` зелёный; визуальная проверка экрана в обеих темах и при 200 %
выполнена, ревью `/ui-review` пройдено.

## Фаза 4: Déclaration d'accessibilité и crédits

**Цель:** публичная déclaration d'accessibilité доступна из футера каждой
страницы, честно описывает статус и проверки; авторство шрифтов опубликовано.
**Затрагивает:** web
**Задачи:**

- [ ] `LegalSection` принимает необязательные ссылки `{ text, href }`,
      `LegalPage` их рендерит; маршрут `/accessibilite` в `legalPages`;
      `fr.accessibilite` — шесть разделов модели RGAA 4.1.2 со статусом «non
      conforme» (research), перечнем проведённых проверок, контактом в
      формате плейсхолдера «[… — à compléter avant publication]», Défenseur
      des droits (форма, délégué, Libre réponse 71120, 75342 Paris CEDEX 07);
      `metadata.title`. **Проверяется тестами (до кода):** через реестр —
      axe в обеих темах, статус 200, клавиатура; `tests/pages/legal.spec.ts`
      — шесть заголовков разделов присутствуют в порядке модели, ссылка в
      футере на главной ведёт на `/accessibilite`, ссылка Défenseur des
      droits — внешняя и с текстом из `fr.ts`; `no-literal-string` проходит.
- [ ] Раздел «Crédits» в `fr.mentionsLegales`: Luciole © Laurent Bourcellier
      & Jonathan Perez, luciole-vision.com, CC BY 4.0; Newsreader ©
      Production Type, SIL OFL 1.1. **Проверяется тестами (до кода):**
      `tests/pages/legal.spec.ts` — на `/mentions-legales` есть заголовок
      «Crédits» и строка с «Luciole» и «CC BY 4.0».

**Когда готова:** `/accessibilite` в футере каждой страницы, проходит axe в
обеих темах и работает с клавиатуры, шесть разделов на месте, статус
совпадает с research; mentions légales содержат авторство Luciole; все
строки — в `fr.ts`.

## Сверка с критериями готовности PRD

| Критерий PRD                                     | Фаза |
| ------------------------------------------------ | ---- |
| Токены обеих тем, контраст пар                   | 1    |
| Нет литералов цвета вне токенов                  | 1    |
| Vermillon не на интерактиве, petrole не в бейдже | 1, 3 |
| Шрифты с собственного origin                     | 1    |
| Newsreader только H1 и число бейджа              | 1, 3 |
| Восемь состояний по остатку дней и статусу       | 2, 3 |
| Порог из константы contracts                     | 2, 3 |
| Слово состояния, снимки в сером                  | 3    |
| Экран синистра на бейджах, старое удалено        | 3    |
| Выполненный шаг тусклее, без зелёного            | 3    |
| Все страницы axe в обеих темах после токенов     | 1    |
| Déclaration из футера, шесть разделов            | 4    |
| Crédits Luciole в mentions légales               | 4    |
| 200 % и 320 px для строки                        | 3    |
| Строки в `fr.ts`, `no-literal-string`            | 3, 4 |
