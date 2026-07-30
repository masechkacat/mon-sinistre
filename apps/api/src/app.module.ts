import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './config/env.validation';
import { HealthController } from './health/health.controller';

/**
 * Root module.
 *
 * Prisma is deliberately not wired in yet: the application starts without a
 * database so the skeleton can run before any model exists. Add PrismaModule
 * here once the first models and migrations land.
 *
 * ThrottlerGuard is global; auth endpoints must get stricter per-route
 * limits via @Throttle() when the auth module lands.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]),
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
