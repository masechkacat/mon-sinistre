import type { ModuleMetadata } from '@nestjs/common';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { SchedulerRegistry } from '@nestjs/schedule';
import { Test, TestingModuleBuilder } from '@nestjs/testing';
import { AppModule } from 'src/app.module';
import { createGlobalValidationPipe } from 'src/config/validation-pipe';

/**
 * The one way an int-spec boots the app — the exact pipe main.ts installs is
 * part of the behaviour under test, and a spec wiring its own bootstrap could
 * silently test a different configuration. `metadata` adds to the testing
 * module (e.g. a controller that only exists for the spec), `customize` is for
 * builder-level overrides (`overrideProvider` and friends).
 */
export async function createIntTestApp({
  metadata = {},
  customize = (builder) => builder,
}: {
  metadata?: Omit<ModuleMetadata, 'imports'>;
  customize?: (builder: TestingModuleBuilder) => TestingModuleBuilder;
} = {}): Promise<NestFastifyApplication> {
  const moduleRef = await customize(
    Test.createTestingModule({ imports: [AppModule], ...metadata }),
  ).compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  app.useGlobalPipes(createGlobalValidationPipe());
  await app.init();
  await stopSchedules(app);
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

/**
 * `ScheduleModule` arms every `@Cron` during `init()`, and the specs share one
 * database: a run crossing the top of an hour would otherwise have a background
 * job deleting rows another spec had just written. Specs call the scheduled
 * methods directly, so nothing here waits on a schedule anyway.
 */
async function stopSchedules(app: NestFastifyApplication): Promise<void> {
  for (const job of app.get(SchedulerRegistry).getCronJobs().values()) {
    await job.stop();
  }
}
