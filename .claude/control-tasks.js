import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { stateDirectory } from './ralph-state.js';

const ROOT = path.resolve(import.meta.dirname, '..');
const FIXTURES = path.join(import.meta.dirname, 'control-tasks');
const suite = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'tasks.json')));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const suiteSha256 = hash(JSON.stringify(suite));
const CHECK_TIMEOUT_MS = 180_000;
const gitEnvironment = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
};
const git = (...args) =>
  execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

function taskById(id) {
  const task = suite.tasks.find((item) => item.id === id);
  if (!task) throw new Error(`Unknown control task: ${id}`);
  return task;
}

function fixPatch(task) {
  return execFileSync(
    'git',
    ['diff', `${task.fix}^`, task.fix, '--', ...task.paths],
    { cwd: ROOT },
  );
}

function apply(repo, patch, reverse = false) {
  const args = ['apply', ...(reverse ? ['--reverse'] : [])];
  for (const check of [true, false])
    execFileSync('git', [...args, ...(check ? ['--check'] : [])], {
      cwd: repo,
      input: patch,
    });
}

function prepare(task, destination) {
  fs.mkdirSync(destination);
  const repo = path.join(destination, 'repo');
  fs.mkdirSync(repo);
  const archive = execFileSync('git', ['archive', suite.base], {
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
  });
  execFileSync('tar', ['-xf', '-', '-C', repo], { input: archive });
  const patch = fixPatch(task);
  apply(repo, patch, true);
  if (task.oracle)
    fs.copyFileSync(
      path.join(FIXTURES, task.oracle),
      path.join(repo, 'apps/api', task.spec),
    );
  if (task.clientOracle)
    fs.copyFileSync(
      path.join(FIXTURES, task.clientOracle),
      path.join(repo, 'apps/web/control-client.ts'),
    );
  const env = {
    ...gitEnvironment,
    GIT_AUTHOR_DATE: '2026-10-18T00:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-18T00:00:00Z',
  };
  const localGit = (...args) =>
    execFileSync('git', args, { cwd: repo, env, encoding: 'utf8' }).trim();
  localGit('init', '-b', `control/${task.id}`);
  localGit('config', 'user.name', 'Harness control');
  localGit('config', 'user.email', 'control@example.invalid');
  localGit('config', 'core.hooksPath', '/dev/null');
  localGit('add', '.');
  localGit('commit', '--quiet', '-m', `Control fixture: ${task.id}`);
  localGit('config', 'core.hooksPath', '.githooks');
  const metadata = {
    version: suite.version,
    task: task.id,
    base: suite.base,
    regressionPatchSha256: hash(patch),
    initialHead: localGit('rev-parse', 'HEAD'),
    lockSha256: hash(fs.readFileSync(path.join(repo, 'package-lock.json'))),
    prompt: task.prompt,
  };
  fs.writeFileSync(
    path.join(destination, 'control.json'),
    JSON.stringify(metadata, null, 2) + '\n',
  );
  return { repo, metadata };
}

function testResults(report, task, regressed) {
  assert.equal(report.numTotalTestSuites > 0, true, 'No test suite executed');
  const assertions = report.testResults.flatMap(
    (result) => result.assertionResults,
  );
  const executed = assertions.filter(
    (item) => !['pending', 'skipped'].includes(item.status),
  );
  assert.deepEqual(
    executed.map((item) => item.title).sort(),
    [...task.tests].sort(),
    'Unexpected tests; a setup failure is not a detected regression',
  );
  for (const item of executed) {
    assert.equal(
      item.status,
      regressed && item.title === task.regressionFailure ? 'failed' : 'passed',
      item.fullName,
    );
    if (regressed && item.title === task.regressionFailure)
      for (const text of task.failureIncludes)
        assert.ok(
          item.failureMessages.some((message) => message.includes(text)),
          `Not the expected regression: ${text}\n${item.failureMessages.join('\n')}`,
        );
  }
  assert.equal(report.numFailedTestSuites > 0, regressed);
  assert.equal(report.numFailedTests, regressed ? 1 : 0);
  assert.equal(report.numRuntimeErrorTestSuites ?? 0, 0);
}

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: CHECK_TIMEOUT_MS,
    ...options,
  }).trim();
}

async function database() {
  const image = run('docker', [
    'image',
    'inspect',
    'postgres:18-alpine',
    '--format',
    '{{.Id}}',
  ]);
  const password = randomBytes(24).toString('hex');
  const id = run('docker', [
    'run',
    '--detach',
    '--rm',
    '--pull=never',
    '--name',
    `harness-control-${randomUUID()}`,
    '--tmpfs',
    '/var/lib/postgresql',
    '-e',
    `POSTGRES_PASSWORD=${password}`,
    '-e',
    'POSTGRES_DB=controls',
    '-p',
    '127.0.0.1::5432',
    image,
  ]);
  const close = () => run('docker', ['rm', '--force', '--volumes', id]);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      const probe = spawnSync('docker', [
        'exec',
        id,
        'pg_isready',
        '-U',
        'postgres',
        '-d',
        'controls',
      ]);
      if (probe.status === 0) {
        ready = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (!ready) throw new Error('Control PostgreSQL did not become ready');
    const port = run('docker', ['port', id, '5432/tcp']).split(':').at(-1);
    return {
      image,
      close,
      env: {
        DB_HOST: '127.0.0.1',
        DB_PORT: port,
        DB_USER: 'postgres',
        DB_PASSWORD: password,
        DB_NAME: 'controls',
      },
    };
  } catch (error) {
    close();
    throw error;
  }
}

async function checkControls(tasks, candidatePatch) {
  if (candidatePatch !== undefined && tasks.length !== 1)
    throw new Error('Candidate verification requires one control task');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-controls-'));
  let db;
  let databaseImage = null;
  const results = [];
  const startedAt = new Date().toISOString();
  try {
    for (const task of tasks) {
      if (task.script === 'test:int') {
        db = await database();
        databaseImage = db.image;
      }
      const destination = path.join(directory, task.id);
      const { repo, metadata } = prepare(task, destination);
      if (candidatePatch !== undefined) apply(repo, candidatePatch);
      assert.equal(
        metadata.lockSha256,
        hash(fs.readFileSync(path.join(ROOT, 'package-lock.json'))),
        'Install the pinned dependencies before checking controls',
      );
      fs.symlinkSync(
        path.join(ROOT, 'node_modules'),
        path.join(repo, 'node_modules'),
        'dir',
      );
      const env = {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        NODE_ENV: 'test',
        CHECKPOINT_DISABLE: '1',
        npm_config_offline: 'true',
        ...(db?.env ?? {
          DB_HOST: '127.0.0.1',
          DB_PORT: '5432',
          DB_USER: 'postgres',
          DB_PASSWORD: randomBytes(24).toString('hex'),
          DB_NAME: 'controls',
        }),
        FRONTEND_URL: 'http://localhost:3000',
        MAIL_TRANSPORT: 'file',
        MAIL_FROM: 'control@example.invalid',
        MAIL_OUTBOX_DIR: path.join(destination, 'mail'),
        SALT_ROUNDS: '4',
      };
      for (const key of [
        'JWT_SECRET',
        'JWT_REFRESH_SECRET',
        'COOKIE_SECRET',
        'VEILLE_EMAIL_HASH_SECRET',
        'ACCOUNT_EMAIL_HASH_SECRET',
      ])
        env[key] = randomBytes(32).toString('hex');
      run(
        'npm',
        ['run', 'prisma:generate', '--workspace', '@mon-sinistre/api'],
        { cwd: repo, env },
      );
      const typechecks = task.oracle ? [['api', task.spec]] : [];
      if (task.clientOracle) typechecks.push(['web', 'control-client.ts']);
      for (const [workspace, file] of typechecks) {
        const config = path.join(destination, `tsconfig-${workspace}.json`);
        if (workspace === 'web') env.TSX_TSCONFIG_PATH = config;
        fs.writeFileSync(
          config,
          JSON.stringify({
            extends: path.join(repo, 'apps', workspace, 'tsconfig.json'),
            compilerOptions: {
              noEmit: true,
              rootDir: repo,
              module: 'esnext',
              moduleResolution: 'bundler',
              lib:
                workspace === 'web'
                  ? ['esnext', 'dom', 'dom.iterable']
                  : ['esnext'],
              incremental: false,
              jsx: 'react-jsx',
              typeRoots: [path.join(repo, 'node_modules/@types')],
              paths: {
                'src/*': [path.join(repo, 'apps/api/src/*')],
                'test/*': [path.join(repo, 'apps/api/test/*')],
                '@/*': [path.join(repo, 'apps/web/src/*')],
                '@mon-sinistre/contracts': [
                  path.join(repo, 'packages/contracts/src/index.ts'),
                ],
              },
            },
            include: [path.join(repo, 'apps', workspace, file)],
          }),
        );
        run(
          process.execPath,
          [
            path.join(ROOT, 'node_modules/typescript/bin/tsc'),
            '--project',
            config,
          ],
          { cwd: repo, env },
        );
      }
      const reportFile = path.join(destination, 'vitest.json');
      const filter = task.tests
        .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
        .join('|');
      const outcomes = [];
      for (const regressed of candidatePatch === undefined
        ? [true, false]
        : [false]) {
        if (!regressed && candidatePatch === undefined)
          apply(repo, fixPatch(task));
        fs.rmSync(reportFile, { force: true });
        const result = spawnSync(
          'npm',
          [
            'run',
            task.script,
            '--workspace',
            '@mon-sinistre/api',
            '--',
            task.spec,
            '--testNamePattern',
            filter,
            '--reporter=json',
            '--outputFile',
            reportFile,
          ],
          {
            cwd: repo,
            env,
            encoding: 'utf8',
            timeout: CHECK_TIMEOUT_MS,
            maxBuffer: 8 * 1024 * 1024,
          },
        );
        try {
          assert.equal(result.error, undefined);
          assert.equal(result.signal, null);
          assert.equal(
            result.status,
            regressed ? 1 : 0,
            fs.existsSync(reportFile)
              ? fs.readFileSync(reportFile, 'utf8')
              : 'No test report',
          );
          const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
          testResults(report, task, regressed);
          outcomes.push({
            variant: regressed ? 'regressed' : 'reference',
            passed: report.numPassedTests,
            failed: report.numFailedTests,
          });
        } catch (error) {
          throw new Error(
            `${task.id}: invalid ${regressed ? 'red' : 'green'} check\n${result.stdout}\n${result.stderr}`,
            { cause: error },
          );
        }
      }
      results.push({ ...metadata, outcomes });
      db?.close();
      db = undefined;
    }
    return {
      version: 1,
      kind:
        candidatePatch === undefined
          ? 'control-self-check'
          : 'control-candidate-check',
      modelCalls: 0,
      startedAt,
      completedAt: new Date().toISOString(),
      runnerRevision: git('rev-parse', 'HEAD'),
      runnerSha256: hash(fs.readFileSync(import.meta.filename)),
      suiteSha256,
      node: process.version,
      npm: run('npm', ['--version']),
      databaseImage,
      recovery: null,
      tasks: results,
    };
  } finally {
    try {
      db?.close();
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  }
}

function controlDirectory() {
  return path.join(path.dirname(stateDirectory(ROOT)), 'harness-controls');
}

async function main(args) {
  const [command, id, destination] = args;
  if (command === 'list' && args.length === 1) {
    console.log(JSON.stringify(suite, null, 2));
  } else if (command === 'prepare' && args.length === 3) {
    console.log(
      JSON.stringify(
        prepare(taskById(id), path.resolve(destination)).metadata,
        null,
        2,
      ),
    );
  } else if (command === 'self-check' && args.length <= 2) {
    const tasks = id && id !== 'all' ? [taskById(id)] : suite.tasks;
    const report = await checkControls(tasks);
    run(process.execPath, ['--test', '.claude/ralph.integration.test.js'], {
      cwd: ROOT,
    });
    report.recovery = { agent: 'stub', remote: 'local-bare', passed: true };
    report.completedAt = new Date().toISOString();
    const folder = controlDirectory();
    fs.mkdirSync(folder, { recursive: true });
    const file = path.join(folder, `check-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify({ file, ...report }, null, 2));
  } else {
    throw new Error(
      'Usage: control-tasks.js list | prepare <id> <new-directory> | self-check [id|all]',
    );
  }
}

if (import.meta.main)
  main(process.argv.slice(2)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });

export {
  checkControls,
  controlDirectory,
  gitEnvironment,
  hash,
  prepare,
  suite,
  suiteSha256,
  taskById,
  testResults,
};
