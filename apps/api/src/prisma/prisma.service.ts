import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { EnvironmentVariables } from 'src/config/env.validation';
import { PrismaClient } from 'src/generated/prisma/client';
import { buildDatabaseUrl } from './database-url';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  // Parameterised with the schema and with "already validated": the five
  // variables are required there, so their absence stops the application at
  // bootstrap and getOrThrow has nothing left to add here. What the type does
  // add is the name — DB_HSOT no longer compiles, where getOrThrow would have
  // discovered it at the first connection.
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({
      adapter: new PrismaPg({
        connectionString: buildDatabaseUrl({
          host: config.get('DB_HOST', { infer: true }),
          port: config.get('DB_PORT', { infer: true }),
          user: config.get('DB_USER', { infer: true }),
          password: config.get('DB_PASSWORD', { infer: true }),
          database: config.get('DB_NAME', { infer: true }),
        }),
      }),
    });
  }

  // Explicit connect so an unreachable database fails the bootstrap, not the
  // first request — same fail-fast contract as the env validation.
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  // Fired via enableShutdownHooks() in main.ts — closes the pg pool on SIGTERM.
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
