import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { HealthController } from './health/health.controller';

/**
 * Root module.
 *
 * TypeOrmModule is deliberately not wired in yet: the application starts
 * without a database so the skeleton can run before any entity exists. Add
 * DatabaseModule here once the first entities and migrations land.
 */
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), ScheduleModule.forRoot()],
  controllers: [HealthController],
})
export class AppModule {}
