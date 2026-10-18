#!/usr/bin/env node
/**
 * Ralph Loop — автономный прогон фазы плана.
 *
 * Каждая итерация = отдельный процесс `claude -p` с чистым контекстом, который
 * делает ровно один issue. Цикл живёт здесь, а не в Stop-хуке: хук вызывается
 * внутри завершающейся сессии, и запуск из него следующей сессии даёт не цикл,
 * а стек вложенных процессов.
 *
 * Запуск:  node .claude/ralph.js
 * Настройки: .claude/ralph.config.json
 * Правила для агента: .claude/ralph.md
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import * as metrics from './metrics.js';
import {
  acquireLock,
  isFinished,
  parseRunResult,
  readState,
  statePath,
  verificationRuns,
  writeState,
} from './ralph-state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const CONFIG_PATH = path.join(import.meta.dirname, 'ralph.config.json');

// Пределы выборок gh: при достижении цикл предупреждает, а не молча теряет хвост.
const BOARD_LIMIT = 500;
const ISSUE_LIMIT = 200;

/** `--dry-run` прогоняет всю обвязку, но не запускает claude и ничего не меняет. */
const DRY_RUN = process.argv.includes('--dry-run');
const VERIFY_CANDIDATE = process.argv.includes('--verify-candidate');

// ─── примитивы ────────────────────────────────────────────────────────────────

/** Внешняя команда без shell: аргументы не проходят через интерпретатор. */
function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
    ...opts,
  }).trim();
}

const git = (args) => run('git', args);
const currentBranch = () => git(['rev-parse', '--abbrev-ref', 'HEAD']);
const gh = (args) => run('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const ghJson = (args) => JSON.parse(gh(args) || 'null');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const warn = (m) => console.log(`\x1b[33m!\x1b[0m ${m}`);

/**
 * Остановка цикла. Бросается, а не `process.exit`: иначе проверки нельзя
 * покрыть тестами — они гасили бы тестовый процесс вместо возврата ошибки.
 * Печатает и выходит один обработчик внизу файла.
 */
class RalphStop extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'RalphStop';
    this.hint = hint;
  }
}

function fail(message, hint) {
  throw new RalphStop(message, hint);
}

function quiet(fn) {
  try {
    fn();
    return true;
  } catch {
    return false;
  }
}

// ─── конфигурация ─────────────────────────────────────────────────────────────

const isPositiveInt = (v) => Number.isInteger(v) && v >= 1;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH))
    fail(`Нет ${path.relative(ROOT, CONFIG_PATH)}`);
  return validateConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')));
}

/** Проверка и дефолты — отдельно от чтения файла, чтобы покрывалось тестами. */
function validateConfig(cfg) {
  if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg))
    fail('Конфигурация должна быть объектом');
  if (!cfg.feature) fail('В конфиге не указана feature');
  if (!Array.isArray(cfg.phases) || cfg.phases.length === 0) {
    fail('В конфиге не указаны phases', 'Например: "phases": [3]');
  }
  if (!cfg.project) {
    fail(
      'В конфиге нет секции project',
      'Без борда цикл не знает, какие issues уже взяты в работу.',
    );
  }
  for (const key of [
    'number',
    'owner',
    'statusField',
    'inReviewOption',
    'doneOption',
  ]) {
    if (!cfg.project[key]) fail(`В конфиге не указан project.${key}`);
  }
  if (typeof cfg.feature !== 'string') fail('feature должна быть строкой');
  if (!cfg.phases.every(isPositiveInt)) {
    fail('В phases допустимы только положительные целые номера фаз');
  }
  if (!isPositiveInt(cfg.project.number)) {
    fail('project.number должен быть целым числом ≥ 1');
  }

  cfg.maxIterations ??= 1;
  cfg.stallLimit ??= 2;
  cfg.iterationTimeoutMs ??= 7_200_000;
  // Тип проверяется после дефолтов: "5" из конфига прошло бы дальше и сломалось
  // бы уже в сравнении с числом — цикл шёл бы либо вечно, либо ни разу.
  for (const key of ['maxIterations', 'stallLimit', 'iterationTimeoutMs']) {
    if (!isPositiveInt(cfg[key])) fail(`${key} должен быть целым числом ≥ 1`);
  }
  if (cfg.maxTurns !== undefined && !isPositiveInt(cfg.maxTurns))
    fail('maxTurns должен быть целым числом ≥ 1');
  if (
    cfg.maxBudgetUsd !== undefined &&
    (!Number.isFinite(cfg.maxBudgetUsd) || cfg.maxBudgetUsd <= 0)
  )
    fail('maxBudgetUsd должен быть конечным числом > 0');
  if (
    !Array.isArray(cfg.verificationCommands) ||
    cfg.verificationCommands.length === 0 ||
    !cfg.verificationCommands.every(
      (args) =>
        Array.isArray(args) &&
        args.length === 3 &&
        args[0] === 'npm' &&
        args[1] === 'run' &&
        typeof args[2] === 'string' &&
        /^[a-z][a-z0-9:_-]*$/i.test(args[2]),
    )
  )
    fail('verificationCommands: непустой список ["npm", "run", "<script>"]');

  // Тип коммита в заголовке PR фазы: инфраструктурная фаза — не feat.
  cfg.prType ??= 'feat';
  if (typeof cfg.prType !== 'string' || !cfg.prType) {
    fail('prType должен быть непустой строкой (feat, chore, fix …)');
  }
  return cfg;
}

// ─── предполётные проверки ────────────────────────────────────────────────────

/**
 * Фаза без PRD, плана и research не годится для автономки: агент начнёт
 * принимать за человека решения, которые человек уже принял или ещё не принял.
 */
function preflight(cfg) {
  step('Предполётная проверка');

  const docs = [
    `docs/prd/${cfg.feature}.md`,
    `docs/plan/${cfg.feature}.md`,
    `docs/research/${cfg.feature}.md`,
  ];
  const missing = docs.filter((d) => !fs.existsSync(path.join(ROOT, d)));
  if (missing.length) {
    fail(
      `Фича «${cfg.feature}» не подготовлена: нет ${missing.join(', ')}`,
      'Сначала /prd → /plan-phase → /issues → /research, потом Ralph.',
    );
  }
  ok(`подготовка на месте: PRD, план, research`);
  validateVerificationScripts(
    cfg.verificationCommands,
    JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')),
  );
  ok('команды приёмки существуют в package.json');

  if (!quiet(() => gh(['auth', 'status']))) {
    fail('gh не авторизован', 'gh auth login');
  }

  const dirty = git(['status', '--porcelain']);
  if (dirty && !DRY_RUN) {
    fail(
      'Рабочее дерево не чистое — цикл не стартует поверх незакоммиченных правок',
      dirty.split('\n').slice(0, 5).join('\n   '),
    );
  }
  ok(
    dirty
      ? 'рабочее дерево не чистое (в dry-run не мешает)'
      : 'рабочее дерево чистое',
  );
}

function validateVerificationScripts(commands, manifest) {
  for (const [, , script] of commands) {
    if (
      !Object.hasOwn(manifest.scripts || {}, script) ||
      typeof manifest.scripts[script] !== 'string' ||
      !manifest.scripts[script].trim()
    )
      fail(`Команда приёмки npm run ${script} отсутствует в package.json`);
  }
}

/**
 * Обновление refs — перед каждой фазой, а не один раз на прогон: PR предыдущей
 * фазы мог быть смержен уже во время прогона, и ветка следующей ушла бы от
 * устаревшего origin/main — без кода фазы, которую цикл только что дождался.
 * Заодно освежается origin/{ветка} для `requireRemoteMerged`.
 */
function fetchOrigin() {
  if (DRY_RUN) {
    ok('origin не обновлялся — dry-run не трогает даже refs');
    return;
  }
  git(['fetch', 'origin', '--quiet']);
  ok('origin обновлён');
}

// ─── GitHub: milestone, issues, борд ──────────────────────────────────────────

function repoSlug() {
  return gh([
    'repo',
    'view',
    '--json',
    'nameWithOwner',
    '-q',
    '.nameWithOwner',
  ]);
}

/** Milestone ищется по формату из скилла `issues`: «[фича] Фаза N: название». */
function findMilestone(repo, feature, phase) {
  // `--paginate` обязателен: без него gh отдаёт только первую страницу (30
  // штук), а `state=all` копит закрытые milestone всех прошлых фич — на третьей
  // фиче цикл падал бы с «не найден milestone» там, где он есть.
  const list = ghJson([
    'api',
    `repos/${repo}/milestones?state=all&per_page=100`,
    '--paginate',
  ]);
  return pickMilestone(list || [], feature, phase);
}

function milestonePrefix(feature, phase) {
  return `[${feature}] Фаза ${phase}:`;
}

/** Выбор milestone из готового списка — чистая часть `findMilestone`. */
function pickMilestone(list, feature, phase) {
  const prefix = milestonePrefix(feature, phase);
  const found = list.filter((m) => m.title.startsWith(prefix));

  if (found.length === 0) {
    fail(
      `Не найден milestone «${prefix} …»`,
      'Проверь название на GitHub — формат задаёт скилл issues.',
    );
  }
  if (found.length > 1) {
    fail(
      `Под «${prefix}» подходит несколько milestone: ${found.map((m) => m.title).join(' | ')}`,
    );
  }
  return found[0].title;
}

/**
 * Фаза считается смерженной, когда закрыты все её issues: закрывает их GitHub по
 * трейлеру `Closes #N` в момент мержа PR. Проверять предком ветки нельзя —
 * squash-мерж переписывает коммиты, и ветка предком main не станет.
 */
function isPhaseMerged(milestone) {
  return milestoneIssues(milestone, 'open').length === 0;
}

function phaseLabel(milestoneTitle) {
  const m = milestoneTitle.match(/^\[.+?\]\s*Фаза\s*\d+:\s*(.+)$/);
  return m ? m[1].trim() : milestoneTitle;
}

/** `gh` именует поля борда camelCase'ом от их названия: «Status» → `status`. */
function fieldKey(name) {
  return name
    .trim()
    .split(/\s+/)
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

/** Карта «номер issue → { itemId, status }» с доски проекта. */
function boardItems(cfg) {
  const data = ghJson([
    'project',
    'item-list',
    String(cfg.project.number),
    '--owner',
    cfg.project.owner,
    '--format',
    'json',
    '--limit',
    String(BOARD_LIMIT),
  ]);
  const items = data?.items || [];
  if (items.length >= BOARD_LIMIT) {
    warn(
      `Борд отдал ${BOARD_LIMIT} карточек — это предел выборки, часть могла не попасть`,
    );
  }

  // Статус читается по ключу от project.statusField, а не по захардкоженному
  // `status`: иначе переименование поля на борде дало бы undefined у всех
  // карточек, фильтр очереди перестал бы работать и цикл брал бы один и тот же
  // issue снова и снова.
  const key = fieldKey(cfg.project.statusField);
  const map = new Map();
  let withStatus = 0;

  for (const item of items) {
    const number = item.content?.number;
    if (!number) continue;
    if (item[key]) withStatus++;
    map.set(number, { itemId: item.id, status: item[key] });
  }

  // Не fail: на свежем борде статус может быть законно пуст у всех карточек.
  // Но последствие надо назвать целиком — очередь перестаёт отличать взятые
  // issues от невзятых, и цикл может выдать агенту уже сделанную задачу.
  if (items.length && withStatus === 0) {
    warn(
      `Ни у одной карточки не заполнено поле «${cfg.project.statusField}» (ключ ${key}) — ` +
        `проверь project.statusField в конфиге.\n   Цикл продолжит работу, но очередь не ` +
        `отличит взятые issues от невзятых и может выдать агенту уже сделанную задачу.`,
    );
  }
  return map;
}

/**
 * Очередь фазы: открытые issues по возрастанию номера (скилл `issues` нумерует
 * их в порядке плана, а `gh issue list` по умолчанию отдаёт новейшие первыми —
 * без сортировки цикл шёл бы по зависимостям задом наперёд).
 *
 * Карточки, уже переведённые в In Review или Done, из очереди исключаются:
 * issue остаётся открытым до мержа PR, и без этого фильтра цикл брал бы его
 * снова и снова.
 */
function queueFor(cfg, milestone, board) {
  return filterQueue(milestoneIssues(milestone, 'open'), board.items, cfg);
}

/** Чистая часть очереди: отсев взятых карточек и порядок плана. */
function filterQueue(issues, items, cfg) {
  const parked = new Set([cfg.project.inReviewOption, cfg.project.doneOption]);
  return issues
    .filter((i) => !parked.has(items.get(i.number)?.status))
    .sort((a, b) => a.number - b.number);
}

function milestoneIssues(milestone, state) {
  const issues =
    ghJson([
      'issue',
      'list',
      '--milestone',
      milestone,
      '--state',
      state,
      '--json',
      'number,title',
      '--limit',
      String(ISSUE_LIMIT),
    ]) || [];
  if (issues.length >= ISSUE_LIMIT) {
    warn(
      `В milestone «${milestone}» ${ISSUE_LIMIT} issues — это предел выборки, часть могла не попасть`,
    );
  }
  return issues;
}

function resolveBoardFields(cfg) {
  const project = ghJson([
    'project',
    'view',
    String(cfg.project.number),
    '--owner',
    cfg.project.owner,
    '--format',
    'json',
  ]);
  const fields = ghJson([
    'project',
    'field-list',
    String(cfg.project.number),
    '--owner',
    cfg.project.owner,
    '--format',
    'json',
    '--limit',
    '50',
  ]);

  const status = (fields?.fields || []).find(
    (f) => f.name === cfg.project.statusField,
  );
  if (!status) fail(`На борде нет поля «${cfg.project.statusField}»`);

  // Проверяются оба значения, а не только inReviewOption: опечатка в
  // doneOption не мешает переводу статуса, но молча ослабляет фильтр очереди —
  // цикл перестал бы считать закрытые карточки взятыми.
  const byName = (name) => {
    const option = (status.options || []).find((o) => o.name === name);
    if (!option) fail(`В поле «${status.name}» нет значения «${name}»`);
    return option;
  };
  const inReview = byName(cfg.project.inReviewOption);
  byName(cfg.project.doneOption);

  return { projectId: project.id, fieldId: status.id, optionId: inReview.id };
}

function moveToInReview(cfg, board, issueNumber) {
  const item = board.items.get(issueNumber);
  // Не warn: без карточки статус не переведётся, `queueFor` не отсеет issue —
  // и следующая итерация выдаст агенту уже сделанную задачу. Коммит при этом
  // на месте и запушен, так что чинится это добавлением карточки на борд.
  if (!item) {
    fail(
      `Issue #${issueNumber} нет на борде — статус не переведён`,
      'Коммит запушен. Добавь issue в проект (workflow auto-add) и запусти цикл снова.',
    );
  }
  gh([
    'project',
    'item-edit',
    '--id',
    item.itemId,
    '--project-id',
    board.fields.projectId,
    '--field-id',
    board.fields.fieldId,
    '--single-select-option-id',
    board.fields.optionId,
  ]);
  ok(`#${issueNumber} → ${cfg.project.inReviewOption}`);
}

// ─── ветка ────────────────────────────────────────────────────────────────────

/** Имя ветки выводится из фичи и номера фазы — в конфиге его нет и разъехаться нечему. */
function branchName(feature, phase) {
  return `${feature}/phase-${phase}`;
}

function ensureBranch(branch) {
  const hasLocal = quiet(() =>
    git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`]),
  );
  const hasRemote = quiet(() =>
    git(['ls-remote', '--exit-code', '--heads', 'origin', branch]),
  );

  if (DRY_RUN) {
    const origin = hasLocal
      ? 'существующая локальная'
      : hasRemote
        ? 'с origin'
        : 'новая, от origin/main';
    ok(`ветка ${branch} (${origin}) — в dry-run не переключаюсь`);
    return;
  }

  if (hasLocal) {
    git(['checkout', branch]);
    requireRemoteMerged(branch);
    requireFreshBase(branch, 'существующая локальная ветка');
    ok(`ветка ${branch} (существующая)`);
  } else if (hasRemote) {
    git(['checkout', '-b', branch, `origin/${branch}`]);
    requireFreshBase(branch, 'ветка с origin');
    ok(`ветка ${branch} (с origin)`);
  } else {
    git(['checkout', '-b', branch, 'origin/main']);
    ok(`ветка ${branch} (новая, от origin/main)`);
  }
}

/**
 * Локальная ветка обязана содержать весь свой `origin/<branch>` — например
 * после прогона с другой машины. Проверять до итерации, а не после: `pushBranch`
 * упал бы на non-fast-forward, когда сессия агента уже потрачена.
 */
function requireRemoteMerged(branch) {
  const remote = `origin/${branch}`;
  const known = quiet(() =>
    git(['rev-parse', '--verify', '--quiet', `refs/remotes/${remote}`]),
  );
  if (!known) return;
  if (quiet(() => git(['merge-base', '--is-ancestor', remote, branch]))) return;

  const behind = git(['rev-list', '--count', `${branch}..${remote}`]);
  fail(
    `Локальная ${branch} отстала от ${remote} на ${behind} коммит(ов)`,
    'Push упал бы уже после потраченной итерации. Подтяни: git pull --ff-only — и запусти цикл снова.',
  );
}

/**
 * Ветка обязана содержать весь `origin/main`. Отставшая ветка в автономном
 * прогоне — это молчаливый откат чужих правок в PR фазы: предупреждение здесь
 * никто не прочитает, поэтому цикл останавливается.
 */
function requireFreshBase(branch, origin) {
  if (
    quiet(() => git(['merge-base', '--is-ancestor', 'origin/main', branch]))
  ) {
    return;
  }
  const behind = git(['rev-list', '--count', `${branch}..origin/main`]);
  fail(
    `Ветка ${branch} (${origin}) отстала от origin/main на ${behind} коммит(ов)`,
    `В PR фазы уехал бы откат чужих правок. Смержи: git merge origin/main — и запусти цикл снова.`,
  );
}

/**
 * После итерации HEAD обязан стоять на ветке фазы.
 *
 * `git checkout -b` агенту не запрещён (запрет префиксный и закрывает только
 * `main`), а коммит на посторонней ветке проходит все остальные проверки:
 * дерево чистое, HEAD продвинулся ровно на один коммит с нужным трейлером.
 * Push при этом молча ничего не делает — ветка фазы не двигалась.
 */
function requireSameBranch(branch) {
  checkSameBranch(currentBranch(), branch);
}

/** Чистая часть — берёт готовое имя текущей ветки (`HEAD` при detached). */
function checkSameBranch(now, branch) {
  if (now === branch) return;
  fail(
    `Итерация ушла с ветки ${branch} на «${now}» — работа не на ветке фазы`,
    `Коммит (если он есть) ищи там: git log ${now}. Перенеси его на ${branch} ` +
      `(git cherry-pick) и запусти цикл снова.`,
  );
}

// ─── коммит итерации ──────────────────────────────────────────────────────────

/**
 * Итерация обязана оставить ровно один коммит с трейлером `Closes #N`.
 *
 * Проверяет это скрипт, а не доверие к агенту: без трейлера issue не закроется
 * при мерже PR, а карточку скрипт уже переведёт в In Review — и из очереди она
 * выпадет навсегда, потому что `queueFor` пропускает In Review. Задача тихо
 * потерялась бы между бордом и планом.
 */
function verifyCommit(before, after, issueNumber, repo, branch) {
  checkLinearAdvance(
    quiet(() => git(['merge-base', '--is-ancestor', before, after])),
    branch,
  );
  const count = Number(git(['rev-list', '--count', `${before}..${after}`]));
  const message = git(['log', '-1', '--format=%B', after]);
  checkIterationCommit(count, message, issueNumber, repo);
  const protectedChanges = git([
    'diff',
    '--name-only',
    before,
    after,
    '--',
    'package.json',
    '**/package.json',
    '.githooks',
    '.claude/ralph*',
    '.claude/metrics.js',
    '.claude/run-report.js',
  ]);
  if (protectedChanges)
    fail(
      'Кандидат изменил команды или механизм собственной приёмки',
      `Эти изменения выполняются с человеком вне Ralph:\n${protectedChanges}`,
    );
}

/**
 * Ветка обязана двигаться вперёд: прежний HEAD — предок нового.
 *
 * Одного счётчика `before..after` мало: `git commit --amend` и `git reset
 * --soft` за начало итерации (запрещён только `--hard`) тоже дают ровно один
 * коммит — но не потомка. На уже запушенной ветке это поймал бы push
 * (non-fast-forward), а на первом коммите фазы ветки на origin ещё нет, push
 * пройдёт — и в неё молча уедет переписанный коммит `origin/main`. Ровно тот
 * откат, который ловит `requireFreshBase`, только он отработал до итерации.
 */
function checkLinearAdvance(isDescendant, branch) {
  if (isDescendant) return;
  fail(
    `Итерация переписала историю ${branch} — новый коммит не потомок прежнего HEAD`,
    'Похоже на amend или reset за начало итерации. Смотри git reflog, разбери руками и запусти цикл снова.',
  );
}

/** Чистая часть проверки — берёт готовые количество и сообщение. */
function checkIterationCommit(count, message, issueNumber, repo) {
  if (count !== 1) {
    fail(
      `Итерация оставила ${count} коммит(ов) вместо одного (issue #${issueNumber})`,
      'Правило — один issue = один коммит. Разбери руками и запусти цикл снова.',
    );
  }
  if (!closesIssue(message, issueNumber, repo)) {
    fail(
      `В коммите нет «Closes #${issueNumber}» — issue не закроется при мерже PR`,
      `Допиши трейлер (git commit --amend) и запусти цикл снова. Годятся формы: ` +
        `«Closes #${issueNumber}», «Closes ${repo}#${issueNumber}», ссылкой на issue.`,
    );
  }
  if (closingReferences(message).length !== 1)
    fail('В коммите должна быть ровно одна закрывающая ссылка на issue');
}

function closingReferences(message) {
  return [
    ...message.matchAll(
      /\b(?:clos(?:e|es|ed)|fix(?:es|ed)?|resolv(?:e|es|ed)):?[ \t]+(?:(?:https?:\/\/(?:www\.)?github\.com\/([\w.-]+\/[\w.-]+)\/issues\/)|(?:([\w.-]+\/[\w.-]+)?#))(\d+)\b/gi,
    ),
  ].map((match) => ({ repo: match[1] || match[2], number: Number(match[3]) }));
}

/**
 * Закроет ли сообщение коммита именно этот issue при мерже PR.
 *
 * Набор ключевых слов и форм ссылки — тот, что распознаёт сам GitHub: `#N`,
 * `owner/repo#N` и полная ссылка на issue. Каждому номеру нужно своё слово,
 * поэтому «Closes #4242, #4243» вторую issue не закрывает и здесь. Двоеточие
 * GitHub допускает («Closes: #4242» закрывает), поэтому валить на нём цикл
 * нельзя. Пробел перед ссылкой обязателен: «Closes#12» GitHub не понимает, и
 * пропустить такой коммит значило бы оставить issue незакрытым после мержа.
 *
 * Кросс-репозиторные формы принимаются только для своего репозитория:
 * «Closes other/repo#12» закроет чужой issue, а наш останется открытым.
 */
function closesIssue(message, issueNumber, repo) {
  return closingReferences(message).some(
    (ref) =>
      ref.number === issueNumber &&
      (!ref.repo || ref.repo.toLowerCase() === repo?.toLowerCase()),
  );
}

/**
 * Пуш после каждого коммита, а не только в конце фазы: иначе карточка уезжает в
 * In Review, а на GitHub нет ни строчки — борд врёт, и работа живёт в одной
 * локальной копии.
 */
function pushBranch(branch) {
  try {
    git(['push', '-u', 'origin', branch]);
  } catch (e) {
    fail(
      `Не удалось запушить ${branch}`,
      `${(e.stderr || e.message || '').trim()}\n   Коммит на месте локально — разберись с origin и запусти цикл снова.`,
    );
  }
}

// ─── итерация ─────────────────────────────────────────────────────────────────

function buildPrompt(cfg, phase, milestone, branch, issue) {
  return [
    'Прочитай .claude/ralph.md и строго следуй правилам оттуда.',
    '',
    `Фича: ${cfg.feature}`,
    `Фаза: ${phase} — «${phaseLabel(milestone)}»`,
    `Milestone: ${milestone}`,
    `Ветка: ${branch} (уже создана и активна — не переключайся и не создавай новых)`,
    '',
    `Задача этой сессии — issue #${issue.number}: ${issue.title}`,
    'Только он. После коммита сразу заверши сессию.',
  ].join('\n');
}

function runIteration(cfg, prompt, sessionId) {
  const args = [
    '-p',
    prompt,
    '--session-id',
    sessionId,
    '--output-format',
    'json',
    '--permission-mode',
    cfg.permissionMode || 'acceptEdits',
  ];
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.maxBudgetUsd) args.push('--max-budget-usd', String(cfg.maxBudgetUsd));
  if (cfg.maxTurns) args.push('--max-turns', String(cfg.maxTurns));
  // variadic-флаги — последними: иначе они съедают следующие за ними опции
  if (cfg.disallowedTools?.length)
    args.push('--disallowedTools', ...cfg.disallowedTools);
  if (cfg.allowedTools?.length)
    args.push('--allowedTools', ...cfg.allowedTools);

  const res = spawnSync('claude', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    maxBuffer: 32 * 1024 * 1024,
    timeout: cfg.iterationTimeoutMs,
    killSignal: 'SIGTERM',
  });
  return parseRunResult(res, sessionId);
}

function requireCandidate(branch, head) {
  requireSameBranch(branch);
  if (git(['rev-parse', branch]) !== head)
    fail('HEAD изменился после подготовки кандидата — приёмка недействительна');
  if (git(['status', '--porcelain']))
    fail('Рабочее дерево не чистое — незавершённые изменения сохранены');
}

function verifyCandidate(cfg, branch, head, history, save) {
  requireCandidate(branch, head);
  const check = {
    head,
    commands: cfg.verificationCommands,
    startedAt: new Date().toISOString(),
    status: 'running',
  };
  history.push(check);
  save();
  try {
    for (const [command, ...args] of cfg.verificationCommands) {
      step(`Приёмка ${head.slice(0, 8)}: ${command} ${args.join(' ')}`);
      const res = spawnSync(command, args, {
        cwd: ROOT,
        stdio: 'inherit',
        timeout: cfg.iterationTimeoutMs,
        killSignal: 'SIGTERM',
      });
      if (res.error || res.status !== 0) {
        check.failedCommand = [command, ...args];
        fail(
          `Приёмка не пройдена: ${command} ${args.join(' ')}`,
          res.error?.message || `exit=${res.status}, signal=${res.signal}`,
        );
      }
      requireCandidate(branch, head);
    }
    check.status = 'passed';
  } catch (error) {
    check.status = 'failed';
    throw error;
  } finally {
    check.completedAt = new Date().toISOString();
    save();
  }
}

function recordStop(attempt, kind, save) {
  attempt.stops ??= [];
  attempt.stops.push({ kind, at: new Date().toISOString() });
  save();
}

function finishAttempt(cfg, repo, branch, board, attempt, save) {
  attempt.operation = 'candidate';
  try {
    return advanceAttempt(cfg, repo, branch, board, attempt, save);
  } catch (error) {
    const kind =
      attempt.operation === 'candidate' && attempt.outcome?.status === 'failed'
        ? attempt.outcome.failureKind || 'failed_result'
        : attempt.operation;
    recordStop(attempt, kind, save);
    throw error;
  }
}

function advanceAttempt(cfg, repo, branch, board, attempt, save) {
  requireSameBranch(branch);
  const head = git(['rev-parse', branch]);
  requireCandidate(branch, head);
  if (head === attempt.before) {
    if (!attempt.outcome)
      fail(
        'Прерванная сессия не оставила результата — состояние агента неизвестно',
        'Проверь, завершился ли процесс агента. Попытка сохранена для ручного разбора; второй агент не запускается.',
      );
    if (VERIFY_CANDIDATE) fail('Нет коммита-кандидата для подтверждения');
    attempt.stage = 'no_commit';
    recordStop(
      attempt,
      attempt.outcome.failureKind ||
        (attempt.outcome.status === 'failed' ? 'failed_result' : 'no_commit'),
      save,
    );
    warn(`Сессия ${attempt.sessionId} не оставила коммита`);
    return false;
  }
  if (attempt.head && attempt.head !== head) {
    if (!VERIFY_CANDIDATE || attempt.stage === 'published')
      fail(
        'HEAD не совпадает с сохранённым кандидатом',
        'Проверь изменения; новый кандидат требует --verify-candidate.',
      );
    attempt.approvedHead = null;
  }
  verifyCommit(attempt.before, head, attempt.issue, repo, branch);
  attempt.head = head;
  if (attempt.stage !== 'published') {
    attempt.stage = 'candidate';
    if (
      attempt.outcome?.status !== 'success' ||
      (attempt.approvedHead && attempt.approvedHead !== head)
    ) {
      if (!VERIFY_CANDIDATE && attempt.approvedHead !== head) {
        save();
        fail(
          `Сессия прервана или завершилась ошибкой: ${attempt.outcome?.reason || 'результат неизвестен'}`,
          'Кандидат сохранён. Проверь его и запусти node .claude/ralph.js --verify-candidate.',
        );
      }
    }
    if (VERIFY_CANDIDATE) attempt.approvedHead = head;
    attempt.operation = 'verification';
    attempt.verifications ??= verificationRuns(attempt);
    delete attempt.verification;
    save();
    verifyCandidate(cfg, branch, head, attempt.verifications, save);
    attempt.operation = 'push';
    save();
    pushBranch(branch);
    attempt.stage = 'published';
    save();
  } else {
    if (
      !quiet(() =>
        git(['merge-base', '--is-ancestor', head, `origin/${branch}`]),
      )
    )
      fail('Опубликованный кандидат отсутствует в origin — проверь ветку');
  }
  attempt.operation = 'board';
  save();
  moveToInReview(cfg, board, attempt.issue);
  attempt.stage = 'complete';
  attempt.completedAt = new Date().toISOString();
  attempt.operation = null;
  save();
  return true;
}

// ─── завершение фазы ──────────────────────────────────────────────────────────

/** Тип коммита берётся из конфига: инфраструктурная фаза — не `feat`. */
function prTitle(cfg, phase, milestone) {
  return `${cfg.prType}(${cfg.feature}): фаза ${phase} — ${phaseLabel(milestone)}`;
}

function dryReviewPrompt(range) {
  return (
    `Запусти субагента dry-reviewer по диффу ${range} ` +
    'и верни его отчёт дословно, без вступления и выводов.'
  );
}

const DRY_REVIEW_TIMEOUT_MS = 20 * 60 * 1000;

// Сбой этого ревью PR не блокирует: дубли тогда смотрят руками.
function dryReview(cfg, range) {
  const args = ['-p', dryReviewPrompt(range), '--permission-mode', 'default'];
  if (cfg.model) args.push('--model', cfg.model);
  if (cfg.maxBudgetUsd) args.push('--max-budget-usd', String(cfg.maxBudgetUsd));
  args.push(
    '--max-turns',
    '30',
    '--allowedTools',
    'Agent',
    'Task',
    'Read',
    'Grep',
    'Glob',
    'Bash(git diff:*)',
    'Bash(git log:*)',
    'Bash(git show:*)',
  );
  const res = spawnSync('claude', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
    timeout: DRY_REVIEW_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  });
  const report = (res.stdout || '').trim();
  if (res.error || res.status !== 0 || !report) {
    const cause = res.error ? `: ${res.error.message}` : '';
    warn(
      `dry-reviewer по диффу фазы не отработал${cause} — дубли на PR смотреть руками`,
    );
    return null;
  }
  return report;
}

const DRY_REVIEW_HEADING = '## dry-reviewer по диффу';

const reviewMarker = (base, head) =>
  `<!-- ralph-dry-review:${base}:${head} -->`;

const hasDryReviewComment = (comments, base, head) =>
  comments.some(
    (c) =>
      (c.body || '').startsWith(DRY_REVIEW_HEADING) &&
      c.body.split('\n').includes(reviewMarker(base, head)),
  );

// Отдельно от `gh pr create`: PR мог быть открыт прошлым запуском, упавшим
// до комментария, или руками — отчёт нужен и ему, но один раз.
function commentDryReview(cfg, branch, url) {
  const base = git(['rev-parse', 'origin/main']);
  const head = git(['rev-parse', branch]);
  const comments =
    ghJson(['pr', 'view', url, '--json', 'comments', '--jq', '.comments']) ??
    [];
  if (hasDryReviewComment(comments, base, head)) {
    ok('отчёт dry-reviewer уже есть в PR');
    return;
  }
  const report = dryReview(cfg, `${base}...${head}`);
  if (!report) return;
  try {
    gh([
      'pr',
      'comment',
      url,
      '--body',
      `${DRY_REVIEW_HEADING} ${base}...${head}\n${reviewMarker(base, head)}\n\n${report}`,
    ]);
    ok('отчёт dry-reviewer добавлен комментарием к PR');
  } catch (e) {
    warn(
      `Комментарий к PR не добавлен: ${(e.stderr || e.message || '').trim()}`,
    );
  }
}

function openPullRequest(cfg, phase, milestone, branch, state, save) {
  if (DRY_RUN) {
    ok(`здесь был бы push ветки ${branch} и PR в main — в dry-run пропущено`);
    return null;
  }

  const head = git(['rev-parse', branch]);
  requireCandidate(branch, head);
  const accepted = state.attempts.some((attempt) => {
    const proof = verificationRuns(attempt).at(-1);
    return (
      attempt.stage === 'complete' &&
      proof?.status === 'passed' &&
      proof.head === head &&
      JSON.stringify(proof.commands) ===
        JSON.stringify(cfg.verificationCommands)
    );
  });
  if (!accepted) {
    state.verifications ??= [];
    verifyCandidate(cfg, branch, head, state.verifications, save);
  }

  const existing = ghJson([
    'pr',
    'list',
    '--head',
    branch,
    '--state',
    'open',
    '--json',
    'url',
  ]);
  if (existing?.length) {
    ok(`PR уже открыт: ${existing[0].url}`);
    commentDryReview(cfg, branch, existing[0].url);
    return existing[0].url;
  }

  // Фаза могла быть закрыта и смержена раньше: тогда коммитов относительно
  // origin/main нет, и `gh pr create` упал бы на «No commits between».
  const commits = Number(
    git(['rev-list', '--count', `origin/main..${branch}`]),
  );
  if (commits === 0) {
    warn(
      `В ${branch} нет коммитов относительно origin/main — открывать нечего (фаза уже смержена?)`,
    );
    return null;
  }

  pushBranch(branch);

  const all = milestoneIssues(milestone, 'all');

  // Баланс текста считает скрипт, а не агент: рост документации должен быть
  // виден на ревью независимо от того, признался ли в нём автор.
  const [mdAdded, mdDeleted] = git([
    'diff',
    '--numstat',
    `origin/main...${branch}`,
    '--',
    '*.md',
  ])
    .split('\n')
    .filter(Boolean)
    .reduce(
      ([a, d], line) => {
        const [add, del] = line.split('\t');
        return [a + (Number(add) || 0), d + (Number(del) || 0)];
      },
      [0, 0],
    );

  const body = [
    `Фаза ${phase} плана \`docs/plan/${cfg.feature}.md\`.`,
    '',
    '## Задачи',
    ...all
      .sort((a, b) => a.number - b.number)
      .map((i) => `- #${i.number} ${i.title}`),
    '',
    '## Контекст',
    `- PRD: \`docs/prd/${cfg.feature}.md\``,
    `- Research: \`docs/research/${cfg.feature}.md\``,
    `- Текст (\`*.md\`): +${mdAdded}/−${mdDeleted} строк к \`origin/main\``,
    ...metrics.report({ attempts: state.attempts, root: ROOT }),
    '',
    '_Собрано Ralph Loop (`.claude/ralph.js`), по одному коммиту на issue._',
  ].join('\n');

  let url;
  try {
    url = gh([
      'pr',
      'create',
      '--base',
      'main',
      '--head',
      branch,
      '--title',
      prTitle(cfg, phase, milestone),
      '--body',
      body,
    ]);
  } catch (e) {
    fail(
      `Не удалось открыть PR для ${branch}`,
      `${(e.stderr || e.message || '').trim()}\n   Коммиты запушены — PR можно открыть руками: gh pr create --head ${branch}`,
    );
  }
  ok(`PR открыт: ${url}`);
  commentDryReview(cfg, branch, url);
  return url;
}

// ─── основной цикл ────────────────────────────────────────────────────────────

function main() {
  const cfg = loadConfig();
  if (VERIFY_CANDIDATE && cfg.phases.length !== 1)
    fail('--verify-candidate требует ровно одну фазу в конфигурации');
  preflight(cfg);
  const runnerRevision = git(['rev-parse', 'HEAD']);

  const repo = repoSlug();
  const board = { items: boardItems(cfg), fields: resolveBoardFields(cfg) };
  const opened = [];

  // Счётчики на весь запуск, а не на фазу: maxIterations — это «сколько issues
  // за прогон», как и обещано в конфиге и CLAUDE.md. Итерация без коммита тоже
  // израсходована (сессия оплачена), поэтому при maxIterations = 1 до stallLimit
  // дело не доходит — он предохранитель для прогонов на несколько issues.
  let iterations = 0;
  let stall = 0;
  let previous = null;

  for (const phase of cfg.phases) {
    const milestone = findMilestone(repo, cfg.feature, phase);
    const branch = branchName(cfg.feature, phase);

    // Ветка каждой фазы растёт от origin/main, а фазы плана зависимы: начинать
    // следующую до мержа предыдущей значит строить её без её же кода.
    if (previous && !isPhaseMerged(previous.milestone)) {
      warn(
        `Фаза ${previous.phase} ещё не в main — фаза ${phase} строилась бы без её кода.`,
      );
      console.log(
        `   Смержи PR фазы ${previous.phase} и запусти цикл снова с "phases": [${phase}].`,
      );
      break;
    }

    step(`Фаза ${phase}: ${phaseLabel(milestone)}`);
    fetchOrigin();
    ensureBranch(branch);
    previous = { phase, milestone };
    const stateFile = statePath(ROOT, branch);
    const state = readState(stateFile, branch);
    const save = () => writeState(stateFile, state);
    const pending = state.attempts.at(-1);
    if (pending && !isFinished(pending)) {
      if (DRY_RUN) {
        ok(`незавершённая попытка #${pending.issue}: ${pending.stage}`);
        return report(opened);
      }
      step(`Восстановление #${pending.issue}: ${pending.stage}`);
      finishAttempt(cfg, repo, branch, board, pending, save);
      if (VERIFY_CANDIDATE) return report(opened);
    } else if (VERIFY_CANDIDATE) {
      fail('В журнале нет незавершённого кандидата — модель не запускалась');
    }

    while (true) {
      board.items = boardItems(cfg);
      const queue = queueFor(cfg, milestone, board);

      if (queue.length === 0) {
        step(`Фаза ${phase} закрыта — открываю PR`);
        const url = openPullRequest(cfg, phase, milestone, branch, state, save);
        if (url) opened.push(url);
        break;
      }

      if (iterations >= cfg.maxIterations) {
        warn(
          `Лимит итераций (${cfg.maxIterations}) исчерпан, в очереди осталось ${queue.length}. ` +
            `Подними maxIterations в конфиге и запусти снова.`,
        );
        return report(opened);
      }

      const issue = queue[0];
      iterations++;
      step(
        `Итерация ${iterations}/${cfg.maxIterations} — #${issue.number}: ${issue.title}` +
          `   (в очереди ${queue.length})`,
      );

      if (DRY_RUN) {
        console.log('\n\x1b[2m--- промпт итерации ---\x1b[0m');
        console.log(buildPrompt(cfg, phase, milestone, branch, issue));
        console.log('\x1b[2m--- claude не запускается (--dry-run) ---\x1b[0m');
        return report(opened);
      }

      const attempt = {
        issue: issue.number,
        sessionId: randomUUID(),
        before: git(['rev-parse', branch]),
        head: null,
        stage: 'running',
        outcome: null,
        startedAt: new Date().toISOString(),
        telemetryVersion: 2,
        runnerRevision,
        model: cfg.model ?? null,
        stops: [],
      };
      state.attempts.push(attempt);
      save();
      attempt.outcome = runIteration(
        cfg,
        buildPrompt(cfg, phase, milestone, branch, issue),
        attempt.sessionId,
      );
      attempt.finishedAt = new Date().toISOString();
      save();
      if (finishAttempt(cfg, repo, branch, board, attempt, save)) {
        stall = 0;
      } else {
        stall++;
        warn(
          `Итерация завершилась без коммита (${attempt.outcome.reason || 'успешный выход'}) — #${issue.number} не сделан ` +
            `[${stall}/${cfg.stallLimit}]`,
        );
        if (stall >= cfg.stallLimit) {
          fail(
            `${stall} итерации подряд без результата — цикл остановлен`,
            `Смотри комментарии в issue #${issue.number}.`,
          );
        }
      }
    }
  }

  report(opened);
}

function report(prUrls) {
  step('Готово');
  if (prUrls.length === 0) {
    console.log('PR не открывались.');
  } else {
    for (const url of prUrls) console.log(`  ${url}`);
    console.log('\nРевью запусти сама: /code-review или /review <номер PR>.');
  }
}

// ─── запуск ───────────────────────────────────────────────────────────────────

/** Единственное место, где остановка печатается и гасит процесс. */
function abort(e) {
  // Любой сорвавшийся git/gh иначе вылетел бы стектрейсом посреди автономного
  // прогона — а читать его будет человек, вернувшийся к остановившемуся циклу.
  const stop =
    e instanceof RalphStop
      ? e
      : new RalphStop(
          'Непредвиденная ошибка — цикл остановлен',
          (e.stderr || e.stack || e.message || String(e)).trim(),
        );

  console.error(`\n\x1b[31m⛔ ${stop.message}\x1b[0m`);
  if (stop.hint) console.error(`   ${stop.hint}`);
  process.exitCode = 1;
}

if (import.meta.main) {
  let release;
  try {
    if (!DRY_RUN)
      release = acquireLock(
        path.resolve(ROOT, git(['rev-parse', '--git-path', 'ralph.lock'])),
      );
    main();
  } catch (e) {
    abort(e);
  } finally {
    release?.();
  }
}

// Экспорт — только для тестов (`.claude/ralph.test.js`): наружу цикл остаётся
// одним исполняемым файлом.
export {
  RalphStop,
  branchName,
  buildPrompt,
  checkIterationCommit,
  checkLinearAdvance,
  checkSameBranch,
  closesIssue,
  dryReviewPrompt,
  fieldKey,
  hasDryReviewComment,
  filterQueue,
  milestonePrefix,
  phaseLabel,
  pickMilestone,
  prTitle,
  validateConfig,
  validateVerificationScripts,
};
