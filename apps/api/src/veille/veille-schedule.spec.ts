import { ConfigService } from '@nestjs/config';
import {
  CronExpression,
  ScheduleModule,
  SchedulerRegistry,
} from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { VeilleService } from './veille.service';

/**
 * The only spec that watches the schedule itself. Every other one calls
 * `cleanupExpired` directly, and the integration harness boots without a
 * scheduler at all (`src/app.int-helper.ts`) — so deleting the decorator, or
 * the `ScheduleModule` of `AppModule`, would leave the whole suite green while
 * expired subscriptions piled up in production.
 *
 * The queries are counted rather than the method spied on: the job is armed
 * from the method as the prototype has it, and a spy laid over it would take
 * the `@Cron` metadata with it — leaving nothing registered to test.
 */
describe('VeilleService cleanup schedule', () => {
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        VeilleService,
        {
          provide: PrismaService,
          useValue: {
            veille: { deleteMany },
            veilleFormEmail: { deleteMany },
          },
        },
        { provide: MailService, useValue: {} },
        { provide: ConfigService, useValue: { get: () => 'secret' } },
      ],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('runs both cleanups hourly, and nothing else on a schedule', async () => {
    const registry = moduleRef.get(SchedulerRegistry);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);

    const jobs = [...registry.getCronJobs().values()];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.cronTime.source).toBe(CronExpression.EVERY_HOUR);

    await jobs[0]?.fireOnTick();
    // The tick is fired, not awaited — the job's own work runs on. One turn of
    // the loop is all a cleanup needs when its queries are stubs.
    await new Promise((resolve) => setImmediate(resolve));

    expect(deleteMany).toHaveBeenCalledTimes(2);
  });
});
