# Research: Дизайн-система — фундамент и бейдж дедлайна

**PRD**: docs/prd/design-system.md (план фаз пишется после этого отчёта)
**Дата**: 2026-10-04

Снапшот на дату. Источник значений — чистовик Claude Design
<https://claude.ai/artifact/2t7HDyqpTr7v1PLwdUsAsK>; что из него переносится
буквально, а что нет, сказано в PRD. Уже решённое и не переисследуемое:
темы на `prefers-color-scheme` без переключателя, Playwright + axe как
тест-инфраструктура, обход «каждая страница × обе темы», локализация в
`fr.ts` и правило литералов — `web-foundation.md`; статусы шагов на чтении и
«сегодня» в Europe/Paris — `sinistre-plan.md`.

## Решения

### Размещение шрифтов

**Решение:** берём `next/font/local` (встроен в Next 16.2), без новых
зависимостей. Файлы — в `apps/web/src/app/fonts/` рядом с текстами лицензий:
Luciole Regular/Bold/Italic/BoldItalic в woff2 из `Luciole_webfonts.zip`
(luciole-vision.com, © Laurent Bourcellier & Jonathan Perez, CC BY 4.0,
сверено 04.10.2026); Newsreader — один вариативный файл roman
(оси `opsz`, `wght`) из `fonts/variable` репозитория
github.com/productiontype/Newsreader (Production Type, SIL OFL 1.1, сверено
04.10.2026). `fonts.ts` экспортирует `luciole` с переменной `--font-sans` и
`newsreader` с `--font-heading`; Geist и импорт `next/font/google` удаляются,
`global-error.tsx` применяет оба семейства сам, как сейчас Geist.
**Почему:** `next/font/local` отдаёт файлы с нашего origin с хешем и
`preload`, считает `size-adjust` для запасного шрифта (Luciole шире Geist —
без этого текст прыгает при загрузке) и не делает ни одного внешнего запроса.
Вариативный Newsreader с `opsz` сам подбирает рисунок для H1 (~30 px) и
числа бейджа (~68 px) — `font-optical-sizing: auto` по умолчанию.
**Отброшено:** Google Fonts — передача IP третьей стороне (RGPD, PRD);
ручной `@font-face` в `globals.css` — нет метрик запасного шрифта и preload;
курсивы Newsreader — не используются ни в одном месте системы.
**Как применять:** `localFont({ src: [...], variable: '--font-sans',
display: 'swap' })`; `display: 'swap'` обязателен — невидимый текст на
несколько секунд для аудитории в стрессе хуже, чем смена рисунка. Файлы
лицензий (`LICENSE-luciole.txt`, `OFL-newsreader.txt`) лежат рядом с woff2 и
попадают в репозиторий. Проверить при добавлении: в архиве Luciole есть
woff2 (иначе woff — `next/font/local` принимает оба) и табличные цифры по
умолчанию (`font-variant-numeric: tabular-nums` ставим в любом случае).

### Токены: имена, значения, слой shadcn

**Решение:** семь ролей чистовика объявляются один раз как CSS-переменные с
французскими именами (`--fond`, `--papier`, `--encre`, `--secondaire`,
`--filet`, `--vermillon`, `--petrole`; в тёмной теме плюс `--texte-sur-fond`,
`--secondaire-sur-fond`, `--filet-sur-fond`), значения — hex из чистовика
без пересчёта в oklch. Переменные shadcn, которыми уже пользуются компоненты,
получают значения из ролей, а не вторые литералы:

| shadcn                               | светлая          | тёмная                 |
| ------------------------------------ | ---------------- | ---------------------- |
| `--background`                       | fond             | fond                   |
| `--foreground`                       | encre            | texte sur fond         |
| `--card`, `--popover`                | papier           | papier (как в светлой) |
| `--card-foreground`                  | encre            | encre                  |
| `--muted`, `--secondary`, `--accent` | fond             | fond                   |
| `--muted-foreground`                 | secondaire       | secondaire sur fond    |
| `--border`, `--input`                | filet            | filet sur fond         |
| `--primary` / `--primary-foreground` | pétrole / papier | texte sur fond / encre |
| `--ring`                             | pétrole          | texte sur fond         |
| `--destructive`                      | vermillon        | vermillon              |
| `--radius`                           | 0.25rem          | —                      |

В `@theme inline` добавляются `--color-vermillon` и `--color-petrole`, чтобы
бейдж и правила-тесты говорили на языке ролей, а не shadcn. Токены
`--sidebar-*` и `--chart-*` удаляются: в `src/` их никто не читает.

> **Исправлено при реализации (issue 228, 04.10.2026).** Значения ролей,
> которых здесь не было: светлая — fond `#e6e4e0`, papier `#f5f3ef`, encre
> `#4a3426`, secondaire `#7a5f50`, filet `#d2c8bf`, vermillon `#a8321f`,
> pétrole `#1f4e5f`; тёмная — fond `#1e1917`, texte sur fond `#efe6d9`,
> secondaire sur fond `#c4b4a3`, filet sur fond `#55483f`. Три строки таблицы
> выше не прошли axe и WCAG 1.4.11, решения:
>
> 1. **`--destructive` в тёмной теме — `vermillon sur fond` `#d9634b`**
>    (4.8:1 на fond), четвёртая роль «sur fond»: ошибки полей лежат прямо на
>    фоне, а vermillon чистовика даёт там 2.6:1. На `papier` правило
>    поверхности возвращает vermillon. Семейство «sur fond» — не восьмая роль
>    системы, а её тёмная проекция, как и три роли чистовика.
> 2. **`--border` и `--input` в тёмной теме расходятся:** `--border` (линии,
>    разделители) — filet sur fond, `--input` (рамки полей и бумажных кнопок)
>    — filet, 10.6:1: граница элемента управления обязана держать 3:1.
>    Контурная кнопка должна брать рамку из `--input`, не из `--border`, —
>    задача про `Button`.
> 3. **`--muted`/`--secondary`/`--accent` — производная `--surface-tint`**,
>    `color-mix` поверхности с её чернилами (8 % в светлой, 10 % в тёмной,
>    7 % на papier): ховер `outline`/`ghost` и фон чипов коммун должны
>    отличаться от фона, а чистовик промежуточного тона не называет. Это
>    правило вывода, не новый литерал.
>
> Правило `[data-surface='papier']` объявлено в `globals.css` этой же
> задачей (иначе `--destructive` на листе остался бы светлым); атрибут на
> `Card`, `Alert`, попапах и поповерах — задача про поверхность, как в плане.
> **Почему:** компоненты shadcn (`bg-card`, `text-muted-foreground`,
> `border-border`) перекрашиваются без правки — это и есть «существующие
> страницы перекрашиваются через токены» из PRD. Радиус 4 px — перфорированная
> бумага почти без скругления; текущие 10 px из другого материала.
> **Отброшено:** переименовать классы компонентов под роли — трогает каждый
> файл; oklch-перевод значений — теряется прямая сверка с чистовиком.
> **Как применять:** `:root { --fond: #e6e4e0; … --background: var(--fond); … }`,
> тёмные значения — в существующем `@media (prefers-color-scheme: dark)`.
> Тест токенов (ниже) читает те же переменные через `getComputedStyle`.

### Поверхность «papier» в тёмной теме

**Решение:** атрибут `data-surface="papier"` на каждом бумажном контейнере
(Card, бейдж, бумажная кнопка) и одно правило в `globals.css`:
`[data-surface='papier'] { --foreground: var(--encre); --muted-foreground:
var(--secondaire); --border: var(--filet); --primary: var(--petrole);
--primary-foreground: var(--papier); --ring: var(--petrole); }`.
**Почему:** правило чистовика «всё на papier не меняет значений» означает,
что внутри листа переменные «sur fond» должны вернуться к светлым. Один
селектор делает это для всех утилит сразу: `text-foreground` внутри карточки
читает encre, снаружи — texte sur fond. В светлой теме правило тождественно
и ничего не меняет. Отсюда же бумажная кнопка на тёмном fond: `--primary`
вне листа равен texte sur fond, внутри — pétrole, и `Button` остаётся как
есть. Ссылка `text-primary` на fond в тёмной теме получает тот же светлый тон
с подчёркиванием — чистовик, раздел 07.
**Отброшено:** `dark:`-варианты классов в каждом компоненте — удваивают
классы и ломаются при первом новом компоненте; отдельные утилиты
`text-card-foreground` везде — то же.
**Как применять:** Card ставит атрибут сам; бейдж и бумажная кнопка — тоже.
Тест: на тестовой странице в тёмной теме вычисленный `color` текста внутри
`[data-surface='papier']` равен encre, снаружи — texte sur fond.

### Разрушающие действия без киновари

**Решение:** вариант `destructive` у `Button` удаляется; удаление синистра и
аккаунта идёт через `variant="outline"` с тем же `AlertDialog`-подтверждением.
`--destructive` остаётся токеном состояний: `text-destructive` в ошибках
полей, `Alert variant="destructive"`, заголовок зоны удаления. Заливки
`bg-destructive/*` и рамки `border-destructive/*` на панелях и кнопках
убираются (панель удаления в `espace-personnel.tsx` держится рамкой `filet` и
заголовком vermillon).
**Почему:** правило PRD «vermillon никогда на интерактиве, включая удаление»;
ошибка поля и алерт — состояние, требующее действия, то есть ровно случай
киновари. Отдельный «outline в encre» под именем destructive — вариант без
отличий, лишняя сущность.
**Отброшено:** оставить `destructive` как alias outline — две точки для одного
решения.
**Как применять:** `grep -rn 'destructive' apps/web/src` даёт полный список
мест (три кнопки, одна панель, два алерта, ошибки полей); меняются только
кнопки и панель.

### Остаток дней шага — в API, не на клиенте

**Решение:** `Step` в contracts получает `daysLeft: number | null` (null без
`plannedDate`), `toStepResponse` считает его тем же `daysBetween(today, …)`,
что `declarationDeadlineOf`, от того же `todayInParis`. Для состояния «date à
venir» `Step` получает `delay: { value: number; unit: DurationUnit } | null`
из правила `DeadlineRule` шага — так в тексте «30 jours après l'arrêté» число
приходит из справочника, а не из компонента.
**Почему:** статусы считаются на чтении в API по календарному дню Europe/Paris
(sinistre-plan.md); клиент не знает «сегодня» и не должен держать второй
календарь. `DeclarationDeadline.daysLeft` уже устроен так — шаги просто
догоняют его.
**Отброшено:** считать дни в браузере от `new Date()` — часовой пояс и часы
пользователя расходятся с API, бейдж и напоминания называли бы разные числа.
**Как применять:** contracts → `npm run build:contracts`; API — одно поле в
маппере и его spec; `to-sinistre-detail.spec.ts` проверяет `daysLeft` для
даты в прошлом, сегодня, будущем и null без даты.

### Порог киновари — константа contracts

**Решение:** `DEADLINE_URGENT_THRESHOLD_DAYS = 7` в `packages/contracts/src/enums.ts`
рядом с `SOON_THRESHOLD_DAYS`, с комментарием «продуктовое решение владельца
04.10.2026, не юридический срок».
**Почему:** правило корневого CLAUDE.md — пороги в contracts, в приложениях не
дублируются; шкала напоминаний 21/14/7/3/1 — другая вещь (PRD), привязывать
цвет к ней нельзя: изменение писем не должно перекрашивать экран.
**Отброшено:** `DECLARATION_REMINDER_OFFSETS_DAYS[2]` как источник семёрки —
скрытая связь.

### Состояние бейджа — чистая функция клиента

**Решение:** `apps/web/src/lib/deadline-badge.ts`: enum `DeadlineBadgeState`
(`norme`, `derniereSemaine`, `demain`, `aujourdhui`, `enRetard`, `fait`,
`sansObjet`, `dateAVenir`) и функция `deadlineBadgeState({ status, daysLeft })`:
`FAIT` → fait; `NON_APPLICABLE` → sansObjet; `daysLeft === null` → dateAVenir;
`< 0` → enRetard; `0` → aujourdhui; `1` → demain;
`≤ DEADLINE_URGENT_THRESHOLD_DAYS` → derniereSemaine; иначе norme. Порядок
проверок — статусы раньше чисел: сделанный шаг с датой в прошлом — fait, а не
en retard.
**Почему:** восемь состояний PRD выводятся из двух полей ответа API; функция
без DOM тестируется как `formatDateFr` — Playwright-тестом без браузера.
**Отброшено:** состояние в contracts — это понятие интерфейса, API его не
знает; состояние как часть `StepStatus` — ломает хранимые статусы.
**Как применять:** тест перечисляет граничные пары: 8 → norme, 7 →
derniereSemaine, 1 → demain, 0 → aujourdhui, −1 → enRetard, FAIT с −3 → fait.

### Компонент бейджа

**Решение:** серверный компонент `apps/web/src/components/deadline-badge.tsx`
с двумя формами (`form: 'hero' | 'row'`) и одним состоянием на входе;
материал — CSS: перфорация `radial-gradient` точками по верхней кромке,
второй лист — `box-shadow` со смещением, штемпель — рамка и `rotate(-4deg)`,
sans objet — `border-dashed`. Число — `font-heading` (Newsreader) с
`data-slot="deadline-number"`, всё остальное — Luciole. Порядок чтения для
скринридера совпадает с видимым: слово состояния, число дней, дата, название
шага; крупное число не дублируется скрытым текстом, оно и есть текст.
**Почему:** состояние уже вычислено, интерактива внутри нет — серверный
компонент без хуков; CSS-материал перекрашивается токенами в обеих темах, в
отличие от SVG-ассета. Второй лист и перфорация не несут смысла —
декоративны, в DOM их нет.
**Отброшено:** `Badge` из shadcn — пилюля, не бумага; картинка листка — не
темируется и не масштабируется при 200 %.
**Как применять:** `hero` встаёт в `DeclarationDeadlineBlock` вместо трёх
строк текста, `row` — в карточку шага вместо строки статуса и `datePrevue`;
`SourceNote` остаётся под бейджем. Короткая дата «jeu. 15 oct.» и части
шапки («OCT.», «15», «JEUDI») — новые хелперы в `src/i18n/date.ts` на
`Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC' })` и `formatToParts`, по
образцу `formatDateFr`; `toLocaleDateString` в компонентах по-прежнему нет.

### Типографическая шкала

**Решение:** базовый размер — 16 px (`text-base`), ничего ниже 13 px
(`0.8125rem`) даже в капители шапки бейджа; пропорции уровней — с чистовика:
H1 Newsreader 700 ≈ 1.875rem, число hero ≈ 4.25rem, число row ≈ 3.25rem,
J-n 1.75rem, дата бейджа 1.0625rem, подписи 0.875rem, шапка/подпись капителью
0.8125rem с разрядкой `tracking-wider`. Цифры везде `tabular-nums`.
`font-heading` применяется ровно в двух местах: `PageTitle` и число бейджа.
**Почему:** 14 px текста на чистовике — масштаб холста (PRD); аудитория
пожилая, правило `apps/web` требует подпись кнопки 16 px. Размер цели
`touch` поднимается с 44 до 48 px (`h-12`), как на чистовике, — строже, не
слабее.
**Отброшено:** перенос px с чистовика как есть.
**Как применять:** `PageTitle` получает `font-heading`; тест «Newsreader в
двух местах» обходит текстовые узлы тестовой страницы и сверяет
`font-family`.

### Тесты: контраст, снимки, правила по исходникам

**Решение:**

- Контраст страниц — уже есть: `a11y.spec.ts` гоняет axe `color-contrast`
  по каждой странице в обеих темах. Чтобы состояния бейджа попали в этот
  обход, добавляется тестовая страница `/test-bejdz` (под `TEST_ROUTES`, как
  `/test-erreur`) со всеми восемью состояниями обеих форм, кнопкой и ссылкой
  на fond и на papier; она регистрируется в `tests/support/pages.ts` и
  бесплатно получает axe, reflow 320 px и reduced-motion.
- Контраст пар токенов — отдельный тест без браузера на формуле WCAG 2.x
  (относительная яркость, `tests/support/contrast.ts`, ~20 строк, без
  зависимостей): перечисляет пары чистовика и пороги 4.5:1 / 3:1 для обеих
  тем, значения читает из `globals.css`. Ловит смену токена до того, как её
  заметит axe на какой-то одной странице.
- Снимки — `expect(locator).toHaveScreenshot()` по каждому состоянию и форме
  в обеих темах, плюс те же снимки с `filter: grayscale(1)` через
  `page.addStyleTag` — эталон «различимо по слову и форме». Эталоны лежат в
  `tests/components/deadline-badge.spec.ts-snapshots/` и привязаны к
  chromium/linux — CI в проекте нет, прогон локальный, шрифты свои, поэтому
  снимки воспроизводимы. `animations: 'disabled'`, фиксированный viewport.
- Правила по исходникам — Playwright-тест, читающий `src/**` через `fs` (как
  `i18n.spec.ts` читает ESLint): hex-литералы и `black`/`white` допустимы
  только в блоке ролей `globals.css`; строки `vermillon`/`destructive` не
  встречаются в `button.tsx` и в классах ссылок; `fonts.googleapis.com` и
  `fonts.gstatic.com` не встречаются нигде, а на главной `page.on('request')`
  не видит запросов к ним.

**Почему:** всё строится на уже установленных Playwright 1.62 и
`@axe-core/playwright` 4.12; новых зависимостей нет. Снимки — единственный
способ проверить «гаснет, а не подсвечивается» и «форма, не цвет» машинно.
**Отброшено:** jest-axe/vitest для контраста — не рендерят темы
(web-foundation.md); eslint-плагин для hex-литералов — новая зависимость ради
одного grep.
**Как применять:** тестовая страница строится из того же `deadlineBadgeState`
и фикстур `tests/support/sinistres.ts`; при смене эталона снимки обновляются
осознанно (`--update-snapshots`) и попадают в тот же коммит, что изменение.

### Déclaration d'accessibilité

**Решение:** маршрут `/accessibilite`, запись в `legalPages` (футер и тесты
подхватывают реестр сами), контент в `fr.ts` по шести разделам модели RGAA
4.1.2 (accessibilite.numerique.gouv.fr/obligations/declaration-accessibilite,
сверено 04.10.2026): état de conformité, résultats des tests, contenus non
accessibles, établissement de la déclaration, retour d'information et contact,
voies de recours (Défenseur des droits: форма, délégué, адрес Libre réponse
71120, 75342 Paris CEDEX 07). `LegalSection` расширяется необязательными
ссылками `{ text, href }` — для формы Défenseur des droits и адреса контакта.

> Расхождение с PRD: PRD называет статус «partiellement conforme». По
> определению RGAA «conformité partielle» требует валидного аудита с ≥ 50 %
> соблюдённых критериев, а без аудита статус — «non conforme». Полного аудита
> по 106 критериям RGAA нет; axe покрывает автоматизируемую часть WCAG, не
> RGAA. Берём честный статус **«non conforme»** с пояснением, что сделано
> (axe по WCAG 2.1 AA в обеих темах, клавиатура, reflow, reduced-motion) и
> что аудит RGAA запланирован; дата установления — дата первой публикации
> страницы. Статус меняется только после аудита, правкой `fr.ts`.

Авторство шрифтов — новый раздел «Crédits» в mentions légales: «Police
Luciole © Laurent Bourcellier & Jonathan Perez, luciole-vision.com, licence
CC BY 4.0. Police Newsreader © Production Type, SIL Open Font License 1.1.»
**Почему:** CC BY требует указать автора, источник и лицензию — для сайта это
mentions légales; déclaration называет Luciole как меру для слабовидящих, не
как кредит. Реестр `legalPages` — единственный список, иначе страница была бы
недостижима и непротестирована (комментарий в `legal-pages.ts`).
**Отброшено:** статический HTML или отдельный шаблон страницы — `LegalPage`
уже есть; «partiellement conforme» — см. врезку.
**Как применять:** плейсхолдеры контакта — в том же формате
«[… — à compléter avant publication]», что в mentions légales, чтобы
предпубликационная проверка находила их одним grep.

## Ограничения и риски

- Светлый лист на тёмном фоне ярче, чем ждут пользователи тёмной темы;
  принято в PRD осознанно (одна бумага). Если жалобы будут — приглушение
  papier на ступень обсуждалось (12d-2) и отклонено из-за filet 1.3:1 в FAIT.
- Luciole v2.001: проверить состав `Luciole_webfonts.zip` (woff2, диакритика
  œ/Œ, табличные цифры) при добавлении файлов — сайт версию и формат не
  называет. Если табличных цифр нет — числа бейджа всё равно Newsreader
  (у него `tnum` есть), а J-n в Luciole выравнивать нечему: один символ.
- Newsreader вариативный ~200 КБ: один файл на все кегли, но тяжелее
  статического 700; статический bold без `opsz` даёт один рисунок на 30 и
  68 px. Остаёмся на вариативном, замеряем в Lighthouse при реализации.
- Снимки Playwright зависят от платформы: эталоны — chromium/linux; на другой
  ОС тест падает по дизайну, а не по ошибке.
- Удаление `destructive`-варианта кнопки меняет вид удаления синистра и
  аккаунта — существующие спеки на эти экраны ищут кнопки по тексту, не по
  цвету; проверить при реализации.
- `delay` у `Step` — новое поле ответа API; добавление обратно совместимо,
  но `to-sinistre-detail.spec.ts` и фикстуры web (`tests/support/sinistres.ts`)
  обязаны получить его в том же коммите, иначе типы contracts не соберутся.
- Экраны не пересобираются: бейдж заменяет текст статуса и даты в текущей
  карточке шага; композиция экрана синистра — следующая итерация трека.
