import type { ModuleMetadata } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import type { EnvironmentVariables } from 'src/config/env.validation';
import { registerCookiePlugin } from 'src/config/fastify-cookie';
import { createGlobalValidationPipe } from 'src/config/validation-pipe';

/**
 * The token `ScheduleModule.forRoot()` files its options under, written out
 * because the package exports it from nowhere its consumers can import. What
 * keeps that from rotting quietly is `expectNoSchedules` below: a token that
 * stops matching leaves the jobs armed, and the assertion says so at once.
 */
const SCHEDULE_MODULE_OPTIONS = 'SCHEDULE_MODULE_OPTIONS';

/**
 * The one way an int-spec boots the app — the exact pipe main.ts installs is
 * part of the behaviour under test, and a spec wiring its own bootstrap could
 * silently test a different configuration. `metadata` adds to the testing
 * module (e.g. a controller that only exists for the spec), `customize` is for
 * builder-level overrides (`overrideProvider` and friends).
 *
 * No job is scheduled here — not stopped after the fact, never armed. They are
 * armed inside `init()`, and the specs share one database: a run crossing the
 * top of an hour would otherwise have a background job deleting rows another
 * spec had just written, a spec that never heard of the job. Specs call the
 * scheduled methods directly; that they are scheduled at all is covered where
 * the schedule is declared (`veille/veille-schedule.spec.ts`).
 */
export async function createIntTestApp({
  metadata = {},
  customize = (builder) => builder,
}: {
  metadata?: Omit<ModuleMetadata, 'imports'>;
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
} = {}): Promise<NestFastifyApplication> {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule], ...metadata })
      .overrideProvider(SCHEDULE_MODULE_OPTIONS)
      .useValue({ cronJobs: false, intervals: false, timeouts: false }),
  ).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  const config =
    app.get<ConfigService<EnvironmentVariables, true>>(ConfigService);
  await registerCookiePlugin(app, config.get('COOKIE_SECRET', { infer: true }));
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.init();
  expectNoSchedules(app);
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

function expectNoSchedules(app: NestFastifyApplication): void {
  const registry = app.get(SchedulerRegistry);
  const armed =
    registry.getCronJobs().size +
    registry.getIntervals().length +
    registry.getTimeouts().length;
  if (armed > 0) {
    throw new Error(`${armed} scheduled job(s) armed in an integration test`);
  }
}
