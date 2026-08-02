'use strict';

/**
 * Тесты чистых функций Ralph Loop.
 *
 * Запуск: npm run test:tooling (или `node --test .claude/`).
 *
 * Здесь только то, что не ходит в сеть и в git: разбор названий milestone,
 * очередь, распознавание трейлера, валидация конфига. Всё остальное в
 * `ralph.js` — обёртки над `git`/`gh`, они проверяются прогоном `--dry-run`.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  RalphStop,
  branchName,
  buildPrompt,
  checkIterationCommit,
  checkLinearAdvance,
  checkSameBranch,
  closesIssue,
  fieldKey,
  filterQueue,
  milestonePrefix,
  phaseLabel,
  pickMilestone,
  prTitle,
  validateConfig,
} = require('./ralph.js');

const REPO = 'masechkacat/mon-sinistre';

/** Конфиг-минимум: тесты правят от него только то, что проверяют. */
function config(overrides = {}) {
  return {
    feature: 'commune-referential',
    phases: [3],
    project: {
      number: 2,
      owner: 'masechkacat',
      statusField: 'Status',
      inReviewOption: 'In Review',
      doneOption: 'Done',
    },
    ...overrides,
  };
}

const board = (entries) =>
  new Map(entries.map(([number, status]) => [number, { itemId: 'x', status }]));

// ─── названия milestone и веток ───────────────────────────────────────────────

test('phaseLabel вынимает название фазы из milestone', () => {
  assert.equal(
    phaseLabel('[commune-referential] Фаза 3: Поиск без учёта регистра'),
    'Поиск без учёта регистра',
  );
});

test('phaseLabel отдаёт заголовок целиком, если формат чужой', () => {
  assert.equal(phaseLabel('Разное'), 'Разное');
});

test('phaseLabel не спотыкается о двоеточие в названии', () => {
  assert.equal(
    phaseLabel('[f] Фаза 2: Импорт COG: первый заход'),
    'Импорт COG: первый заход',
  );
});

test('branchName выводится из фичи и фазы', () => {
  assert.equal(
    branchName('commune-referential', 3),
    'commune-referential/phase-3',
  );
});

test('pickMilestone находит фазу по префиксу', () => {
  const list = [
    { title: '[commune-referential] Фаза 1: Prisma' },
    { title: '[commune-referential] Фаза 3: Поиск' },
  ];
  assert.equal(
    pickMilestone(list, 'commune-referential', 3),
    '[commune-referential] Фаза 3: Поиск',
  );
});

test('pickMilestone не путает фазу 1 с фазой 11', () => {
  const list = [
    { title: '[f] Фаза 11: Одиннадцатая' },
    { title: '[f] Фаза 1: Первая' },
  ];
  assert.equal(pickMilestone(list, 'f', 1), '[f] Фаза 1: Первая');
  assert.equal(pickMilestone(list, 'f', 11), '[f] Фаза 11: Одиннадцатая');
});

test('pickMilestone не берёт фазу чужой фичи', () => {
  const list = [{ title: '[other-feature] Фаза 3: Чужая' }];
  assert.throws(() => pickMilestone(list, 'commune-referential', 3), RalphStop);
});

test('pickMilestone останавливает цикл при двух подходящих milestone', () => {
  const list = [{ title: '[f] Фаза 3: Один' }, { title: '[f] Фаза 3: Другой' }];
  assert.throws(() => pickMilestone(list, 'f', 3), /несколько milestone/);
});

test('milestonePrefix совпадает с форматом скилла issues', () => {
  assert.equal(
    milestonePrefix('commune-referential', 3),
    '[commune-referential] Фаза 3:',
  );
});

// ─── ключ поля борда ──────────────────────────────────────────────────────────

test('fieldKey переводит название поля в ключ gh', () => {
  assert.equal(fieldKey('Status'), 'status');
  assert.equal(fieldKey('Start Date'), 'startDate');
  assert.equal(fieldKey('  Status  '), 'status');
});

// ─── очередь ──────────────────────────────────────────────────────────────────

test('filterQueue отдаёт issues по возрастанию номера, а не по дате', () => {
  const issues = [{ number: 15 }, { number: 12 }, { number: 13 }];
  assert.deepEqual(
    filterQueue(issues, board([]), config()).map((i) => i.number),
    [12, 13, 15],
  );
});

test('filterQueue пропускает карточки в In Review и Done', () => {
  const issues = [{ number: 12 }, { number: 13 }, { number: 14 }];
  const items = board([
    [12, 'In Review'],
    [13, 'Done'],
    [14, 'Todo'],
  ]);
  assert.deepEqual(
    filterQueue(issues, items, config()).map((i) => i.number),
    [14],
  );
});

test('filterQueue берёт issue, которого ещё нет на борде', () => {
  const issues = [{ number: 12 }];
  assert.equal(filterQueue(issues, board([]), config()).length, 1);
});

test('filterQueue опирается на значения из конфига, а не на «In Review»', () => {
  const cfg = config();
  cfg.project.inReviewOption = 'На ревью';
  const items = board([[12, 'На ревью']]);
  assert.deepEqual(filterQueue([{ number: 12 }], items, cfg), []);
});

// ─── трейлер Closes ───────────────────────────────────────────────────────────

test('closesIssue принимает трейлер в любом регистре', () => {
  assert.ok(closesIssue('feat: что-то\n\nCloses #12', 12));
  assert.ok(closesIssue('feat: что-то\n\ncloses #12', 12));
  assert.ok(closesIssue('feat: что-то\n\nCLOSES #12', 12));
});

test('closesIssue принимает синонимы GitHub', () => {
  for (const word of [
    'Close',
    'Closed',
    'Fix',
    'Fixes',
    'Fixed',
    'Resolve',
    'Resolves',
    'Resolved',
  ]) {
    assert.ok(closesIssue(`тело\n\n${word} #12`, 12), word);
  }
});

test('closesIssue принимает двоеточие — GitHub по нему issue закрывает', () => {
  assert.ok(closesIssue('feat: что-то\n\nCloses: #12', 12));
});

test('closesIssue не путает #1 с #12', () => {
  assert.ok(!closesIssue('feat: что-то\n\nCloses #1', 12));
  assert.ok(!closesIssue('feat: что-то\n\nCloses #120', 12));
});

test('closesIssue не засчитывает перечисление через запятую', () => {
  // GitHub требует ключевое слово каждому номеру: «Closes #12, #13» закроет
  // только #12 — цикл обязан считать так же, иначе #13 останется открытым.
  assert.ok(closesIssue('Closes #12, #13', 12));
  assert.ok(!closesIssue('Closes #12, #13', 13));
});

test('closesIssue требует пробел перед номером', () => {
  // «Closes#12» GitHub не распознаёт: пропустить такой коммит значит оставить
  // issue незакрытым после мержа.
  assert.ok(!closesIssue('Closes#12', 12));
});

test('closesIssue не срабатывает на простое упоминание issue', () => {
  assert.ok(!closesIssue('feat: правка рядом с #12', 12));
  assert.ok(!closesIssue('см. обсуждение в #12', 12));
});

test('closesIssue принимает формы owner/repo#N и ссылку — GitHub их закрывает', () => {
  assert.ok(closesIssue(`Closes ${REPO}#12`, 12, REPO));
  assert.ok(
    closesIssue(`Closes https://github.com/${REPO}/issues/12`, 12, REPO),
  );
});

test('closesIssue не засчитывает issue чужого репозитория', () => {
  // «Closes other/repo#12» закроет чужой issue, а наш останется открытым.
  assert.ok(!closesIssue('Closes other/repo#12', 12, REPO));
  assert.ok(
    !closesIssue('Closes https://github.com/other/repo/issues/12', 12, REPO),
  );
});

// ─── ветка после итерации ─────────────────────────────────────────────────────

test('checkSameBranch пропускает ветку фазы', () => {
  assert.doesNotThrow(() =>
    checkSameBranch(
      'commune-referential/phase-3',
      'commune-referential/phase-3',
    ),
  );
});

test('checkSameBranch останавливает цикл на посторонней ветке и detached HEAD', () => {
  // Коммит там прошёл бы все прочие проверки: дерево чистое, HEAD продвинулся
  // на один коммит с трейлером, а push ветки фазы молча не двигает ничего.
  assert.throws(
    () => checkSameBranch('hotfix', 'commune-referential/phase-3'),
    /hotfix/,
  );
  assert.throws(
    () => checkSameBranch('HEAD', 'commune-referential/phase-3'),
    RalphStop,
  );
});

// ─── проверка коммита итерации ────────────────────────────────────────────────

test('checkIterationCommit пропускает ровно один коммит с трейлером', () => {
  assert.doesNotThrow(() =>
    checkIterationCommit(1, 'feat: поиск\n\nCloses #12', 12, REPO),
  );
});

test('checkIterationCommit останавливает цикл на двух коммитах', () => {
  assert.throws(
    () => checkIterationCommit(2, 'feat: поиск\n\nCloses #12', 12, REPO),
    /2 коммит/,
  );
});

test('checkIterationCommit останавливает цикл, когда коммита нет', () => {
  assert.throws(() => checkIterationCommit(0, '', 12, REPO), RalphStop);
});

test('checkIterationCommit останавливает цикл на чужом номере issue', () => {
  assert.throws(
    () => checkIterationCommit(1, 'feat: поиск\n\nCloses #13', 12, REPO),
    /Closes #12/,
  );
});

test('checkLinearAdvance пропускает обычное продвижение ветки', () => {
  assert.doesNotThrow(() =>
    checkLinearAdvance(true, 'commune-referential/phase-3'),
  );
});

test('checkLinearAdvance останавливает цикл на переписанной истории', () => {
  // amend и reset --soft за начало итерации дают ровно один коммит в
  // `before..after` — счётчик их не отличает, а на непушенной ветке фазы push
  // пропустил бы переписанный коммит origin/main.
  assert.throws(
    () => checkLinearAdvance(false, 'commune-referential/phase-3'),
    /переписала историю/,
  );
});

// ─── валидация конфига ────────────────────────────────────────────────────────

test('validateConfig проставляет умолчания', () => {
  const cfg = validateConfig(config());
  assert.equal(cfg.maxIterations, 1);
  assert.equal(cfg.stallLimit, 2);
});

test('validateConfig не затирает заданные лимиты', () => {
  const cfg = validateConfig(config({ maxIterations: 5, stallLimit: 3 }));
  assert.equal(cfg.maxIterations, 5);
  assert.equal(cfg.stallLimit, 3);
});

test('validateConfig требует feature', () => {
  const cfg = config();
  delete cfg.feature;
  assert.throws(() => validateConfig(cfg), /feature/);
});

test('validateConfig требует непустой phases', () => {
  assert.throws(() => validateConfig(config({ phases: [] })), /phases/);
  assert.throws(() => validateConfig(config({ phases: 3 })), /phases/);
});

test('validateConfig отбивает лимиты не-числом и не-целые номера фаз', () => {
  assert.throws(
    () => validateConfig(config({ maxIterations: '5' })),
    /maxIterations/,
  );
  assert.throws(() => validateConfig(config({ stallLimit: 0 })), /stallLimit/);
  assert.throws(() => validateConfig(config({ phases: ['3'] })), /phases/);
});

test('validateConfig подставляет prType и отбивает пустой', () => {
  assert.equal(validateConfig(config()).prType, 'feat');
  assert.equal(validateConfig(config({ prType: 'chore' })).prType, 'chore');
  assert.throws(() => validateConfig(config({ prType: '' })), /prType/);
});

test('validateConfig требует секцию project целиком', () => {
  for (const key of [
    'number',
    'owner',
    'statusField',
    'inReviewOption',
    'doneOption',
  ]) {
    const cfg = config();
    delete cfg.project[key];
    assert.throws(() => validateConfig(cfg), new RegExp(key), `project.${key}`);
  }
});

// ─── промпт итерации ──────────────────────────────────────────────────────────

test('buildPrompt называет issue, ветку и файл правил', () => {
  const prompt = buildPrompt(
    config(),
    3,
    '[commune-referential] Фаза 3: Поиск',
    'commune-referential/phase-3',
    { number: 12, title: 'Тесты поиска' },
  );
  assert.match(prompt, /\.claude\/ralph\.md/);
  assert.match(prompt, /#12/);
  assert.match(prompt, /commune-referential\/phase-3/);
  assert.match(prompt, /Фаза: 3 — «Поиск»/);
});

test('prTitle берёт тип коммита из конфига', () => {
  const milestone = '[commune-referential] Фаза 3: Поиск';
  assert.equal(
    prTitle(validateConfig(config()), 3, milestone),
    'feat(commune-referential): фаза 3 — Поиск',
  );
  assert.equal(
    prTitle(validateConfig(config({ prType: 'chore' })), 3, milestone),
    'chore(commune-referential): фаза 3 — Поиск',
  );
});
