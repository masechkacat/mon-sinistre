#!/usr/bin/env node
'use strict';

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

const { execFileSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(__dirname, 'ralph.config.json');

// Пределы выборок gh: при достижении цикл предупреждает, а не молча теряет хвост.
const BOARD_LIMIT = 500;
const ISSUE_LIMIT = 200;

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
const gh = (args) => run('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] });
const ghJson = (args) => JSON.parse(gh(args) || 'null');

const ok = (m) => console.log(`\x1b[32m✓\x1b[0m ${m}`);
const step = (m) => console.log(`\n\x1b[1m${m}\x1b[0m`);
const warn = (m) => console.log(`\x1b[33m!\x1b[0m ${m}`);

function fail(message, hint) {
  console.error(`\n\x1b[31m⛔ ${message}\x1b[0m`);
  if (hint) console.error(`   ${hint}`);
  process.exit(1);
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

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH))
    fail(`Нет ${path.relative(ROOT, CONFIG_PATH)}`);
  const cfg = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

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
  cfg.maxIterations ??= 1;
  cfg.stallLimit ??= 2;
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

  if (DRY_RUN) {
    ok('origin не обновлялся — dry-run не трогает даже refs');
  } else {
    git(['fetch', 'origin', '--quiet']);
    ok('origin обновлён');
  }
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
  const list = ghJson([
    'api',
    `repos/${repo}/milestones`,
    '-X',
    'GET',
    '-f',
    'state=all',
  ]);
  const prefix = `[${feature}] Фаза ${phase}:`;
  const found = (list || []).filter((m) => m.title.startsWith(prefix));

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

  if (items.length && withStatus === 0) {
    warn(
      `Ни у одной карточки не заполнено поле «${cfg.project.statusField}» (ключ ${key}) — ` +
        `проверь project.statusField в конфиге, иначе очередь не увидит уже взятые issues`,
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
  const issues = milestoneIssues(milestone, 'open');
  const parked = new Set([cfg.project.inReviewOption, cfg.project.doneOption]);
  return issues
    .filter((i) => !parked.has(board.items.get(i.number)?.status))
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

  const option = (status.options || []).find(
    (o) => o.name === cfg.project.inReviewOption,
  );
  if (!option)
    fail(
      `В поле «${status.name}» нет значения «${cfg.project.inReviewOption}»`,
    );

  return { projectId: project.id, fieldId: status.id, optionId: option.id };
}

function moveToInReview(cfg, board, issueNumber) {
  const item = board.items.get(issueNumber);
  if (!item) {
    warn(`Issue #${issueNumber} нет на борде — статус не переведён`);
    return;
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

// ─── коммит итерации ──────────────────────────────────────────────────────────

/**
 * Итерация обязана оставить ровно один коммит с трейлером `Closes #N`.
 *
 * Проверяет это скрипт, а не доверие к агенту: без трейлера issue не закроется
 * при мерже PR, а карточку скрипт уже переведёт в In Review — и из очереди она
 * выпадет навсегда, потому что `queueFor` пропускает In Review. Задача тихо
 * потерялась бы между бордом и планом.
 */
function verifyCommit(before, after, issueNumber) {
  const count = Number(git(['rev-list', '--count', `${before}..${after}`]));
  if (count !== 1) {
    fail(
      `Итерация оставила ${count} коммит(ов) вместо одного (issue #${issueNumber})`,
      'Правило — один issue = один коммит. Разбери руками и запусти цикл снова.',
    );
  }

  // Набор ключевых слов — тот, что распознаёт сам GitHub; каждому номеру нужно
  // своё слово, поэтому «Closes #12, #13» вторую issue не закрывает и здесь.
  const closes = new RegExp(
    `\\b(clos(e|es|ed)|fix(es|ed)?|resolv(e|es|ed)) #${issueNumber}\\b`,
    'i',
  );
  const message = git(['log', '-1', '--format=%B', after]);
  if (!closes.test(message)) {
    fail(
      `В коммите нет «Closes #${issueNumber}» — issue не закроется при мерже PR`,
      'Допиши трейлер (git commit --amend) и запусти цикл снова.',
    );
  }
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

function runIteration(cfg, prompt) {
  const args = [
    '-p',
    prompt,
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

  const res = spawnSync('claude', args, { cwd: ROOT, stdio: 'inherit' });
  if (res.error) fail(`Не удалось запустить claude: ${res.error.message}`);
  return res.status;
}

// ─── завершение фазы ──────────────────────────────────────────────────────────

function openPullRequest(cfg, phase, milestone, branch) {
  if (DRY_RUN) {
    ok(`здесь был бы push ветки ${branch} и PR в main — в dry-run пропущено`);
    return null;
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
      `feat(${cfg.feature}): фаза ${phase} — ${phaseLabel(milestone)}`,
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
  return url;
}

// ─── основной цикл ────────────────────────────────────────────────────────────

/** `--dry-run` прогоняет всю обвязку, но не запускает claude и ничего не меняет. */
const DRY_RUN = process.argv.includes('--dry-run');

function main() {
  const cfg = loadConfig();
  preflight(cfg);

  const repo = repoSlug();
  const board = { items: boardItems(cfg), fields: resolveBoardFields(cfg) };
  const opened = [];

  // Счётчики на весь запуск, а не на фазу: maxIterations — это «сколько issues
  // за прогон», как и обещано в конфиге и CLAUDE.md.
  let iterations = 0;
  let stall = 0;
  let previous = null;

  for (const phase of cfg.phases) {
    const milestone = findMilestone(repo, cfg.feature, phase);
    const branch = `${cfg.feature}/phase-${phase}`;

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
    ensureBranch(branch);
    previous = { phase, milestone };

    while (true) {
      board.items = boardItems(cfg);
      const queue = queueFor(cfg, milestone, board);

      if (queue.length === 0) {
        step(`Фаза ${phase} закрыта — открываю PR`);
        const url = openPullRequest(cfg, phase, milestone, branch);
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

      const headBefore = git(['rev-parse', 'HEAD']);
      const exit = runIteration(
        cfg,
        buildPrompt(cfg, phase, milestone, branch, issue),
      );
      const headAfter = git(['rev-parse', 'HEAD']);

      const dirty = git(['status', '--porcelain']);
      if (dirty) {
        fail(
          `Итерация оставила незакоммиченные изменения — цикл остановлен`,
          'Разбери руками: продолжать поверх недоделанного нельзя.',
        );
      }

      if (headAfter !== headBefore) {
        verifyCommit(headBefore, headAfter, issue.number);
        pushBranch(branch);
        ok(`коммит ${headAfter.slice(0, 8)} запушен в origin/${branch}`);
        moveToInReview(cfg, board, issue.number);
        stall = 0;
      } else {
        stall++;
        warn(
          `Итерация завершилась без коммита (код ${exit}) — #${issue.number} не сделан ` +
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

try {
  main();
} catch (e) {
  // Любой сорвавшийся git/gh иначе вылетел бы стектрейсом посреди автономного
  // прогона — а читать его будет человек, вернувшийся к остановившемуся циклу.
  fail(
    'Непредвиденная ошибка — цикл остановлен',
    (e.stderr || e.stack || e.message || String(e)).trim(),
  );
}
