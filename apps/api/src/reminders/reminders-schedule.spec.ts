import { ScheduleModule, SchedulerRegistry } from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { REMINDERS_CRON, RemindersService } from './reminders.service';

/**
 * The reminders counterpart of `auth/auth-schedule.spec.ts`, and for the reason
 * its docblock spells out — here, the suite that would stay green while nobody
 * ever received a reminder.
 */
describe('RemindersService schedule', () => {
  const findMany = jest.fn().mockResolvedValue([]);
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: { step: { findMany } } },
        { provide: MailService, useValue: {} },
      ],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('runs one daily pass in Paris time, and nothing else on a schedule', async () => {
    const registry = moduleRef.get(SchedulerRegistry);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);

    const jobs = [...registry.getCronJobs().values()];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.cronTime.source).toBe(REMINDERS_CRON);
    // Without the zone the pass would drift an hour twice a year, and
    // «сегодня» of `todayInParis` would stop matching the day it reads.
    expect(jobs[0]?.cronTime.timeZone).toBe('Europe/Paris');

    await jobs[0]?.fireOnTick();
    // Fired, not awaited — why: veille's spec, same shape.
    await new Promise((resolve) => setImmediate(resolve));

    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
