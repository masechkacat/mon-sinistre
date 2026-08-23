import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  CronExpression,
  ScheduleModule,
  SchedulerRegistry,
} from '@nestjs/schedule';
import { Test, type TestingModule } from '@nestjs/testing';
import { MailService } from 'src/mail/mail.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * The auth counterpart of `veille/veille-schedule.spec.ts`, and for the same
 * reason its docblock spells out: every other spec of this module calls
 * `cleanupExpired` directly and the integration harness boots without a
 * scheduler (`test/helpers/app.ts`), so deleting the `@Cron` decorator — or
 * the `ScheduleModule` of `AppModule` — would leave the whole suite green
 * while unconfirmed accounts, spent reset rows and rate counters piled up in
 * production. Veille's spec cannot cover this one: it registers its own
 * module, with only `VeilleService` in it.
 */
describe('AuthService cleanup schedule', () => {
  const deleteMany = jest.fn().mockResolvedValue({ count: 0 });
  let moduleRef: TestingModule;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [ScheduleModule.forRoot()],
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: {
            user: { deleteMany },
            passwordReset: { deleteMany },
            refreshToken: { deleteMany },
            accountFormEmail: { deleteMany },
            loginAttempt: { deleteMany },
          },
        },
        { provide: MailService, useValue: {} },
        { provide: JwtService, useValue: {} },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => (key === 'SALT_ROUNDS' ? 10 : 'secret'),
          },
        },
      ],
    }).compile();
    await moduleRef.init();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('runs all five cleanups hourly, and nothing else on a schedule', async () => {
    const registry = moduleRef.get(SchedulerRegistry);
    expect(registry.getIntervals()).toEqual([]);
    expect(registry.getTimeouts()).toEqual([]);

    const jobs = [...registry.getCronJobs().values()];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.cronTime.source).toBe(CronExpression.EVERY_HOUR);

    await jobs[0]?.fireOnTick();
    // Fired, not awaited — why: veille's spec, same shape.
    await new Promise((resolve) => setImmediate(resolve));

    expect(deleteMany).toHaveBeenCalledTimes(5);
  });
});
