import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { CommunesModule } from './communes/communes.module';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';

/**
 * Root module.
 *
 * ThrottlerGuard is global; auth endpoints must get stricter per-route
 * limits via @Throttle() when the auth module lands.
 *
 * AllExceptionsFilter is registered here rather than in main.ts so that it is
 * built by the container — it is what lets it take dependencies later, and it
 * puts the filter in the integration tests too, which bootstrap AppModule and
 * never run main.ts.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
    PrismaModule,
    MailModule,
    CommunesModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
