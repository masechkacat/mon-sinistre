import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter';
import { TokenThrottlerGuard } from './common/http/token-throttler.guard';
import { AuthModule } from './auth/auth.module';
import { JwtAuthGuard } from './auth/passport/jwt-auth.guard';
import { CommunesModule } from './communes/communes.module';
import { validateEnv } from './config/env.validation';
import { DeadlineRulesModule } from './deadline-rules/deadline-rules.module';
import { HealthController } from './health/health.controller';
import { JorfModule } from './jorf/jorf.module';
import { MailModule } from './mail/mail.module';
import { PrismaModule } from './prisma/prisma.module';
import { VeilleModule } from './veille/veille.module';

/** Exported for the tests, which must not restate the number. */
export const GLOBAL_RATE_LIMIT = { ttl: 60_000, limit: 100 } as const;

/**
 * The throttler guard is global; auth endpoints need stricter per-route limits
 * via @Throttle(), and a route reached through the web server rather than by
 * the user counts per token via @ThrottleByToken() — hence TokenThrottlerGuard
 * in place of the stock one. JwtAuthGuard is global too — mechanics in
 * `src/auth/CLAUDE.md`. AllExceptionsFilter is registered here rather
 * than in main.ts so it reaches the integration tests, which bootstrap
 * AppModule and never run main.ts.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([GLOBAL_RATE_LIMIT]),
    PrismaModule,
    MailModule,
    DeadlineRulesModule,
    AuthModule,
    CommunesModule,
    VeilleModule,
    JorfModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: TokenThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
