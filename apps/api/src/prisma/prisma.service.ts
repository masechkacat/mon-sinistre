import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from 'src/generated/prisma/client';
import { buildDatabaseUrl } from './database-url';

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({
        connectionString: buildDatabaseUrl({
          host: config.getOrThrow<string>('DB_HOST'),
          port: config.getOrThrow<number>('DB_PORT'),
          user: config.getOrThrow<string>('DB_USER'),
          password: config.getOrThrow<string>('DB_PASSWORD'),
          database: config.getOrThrow<string>('DB_NAME'),
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
