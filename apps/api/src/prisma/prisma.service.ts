import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';

/**
 * Prisma client as a Nest provider.
 *
 * The connection string is assembled from the same DB_* variables that
 * docker-compose and prisma.config.ts use — no separate DATABASE_URL
 * (docs/decisions.md). Disconnect runs in onModuleDestroy, triggered by
 * enableShutdownHooks() in main.ts.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const user = config.getOrThrow<string>('DB_USER');
    const password = encodeURIComponent(
      config.getOrThrow<string>('DB_PASSWORD'),
    );
    const host = config.getOrThrow<string>('DB_HOST');
    const port = config.getOrThrow<number>('DB_PORT');
    const name = config.getOrThrow<string>('DB_NAME');

    super({
      adapter: new PrismaPg({
        connectionString: `postgresql://${user}:${password}@${host}:${port}/${name}`,
      }),
    });
  }

  // Connect eagerly so an unreachable database fails the bootstrap, not the
  // first query.
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
