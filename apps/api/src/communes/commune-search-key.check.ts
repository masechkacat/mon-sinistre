import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * `Commune.nameNormalized` is filled by the import, not by the migration, so
 * skipping `seed` after `migration:deploy` breaks nothing visibly: every search
 * by name simply returns an empty list.
 *
 * Warns rather than aborts on purpose — a partially imported referential still
 * answers for the communes it knows.
 */
@Injectable()
export class CommuneSearchKeyCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommuneSearchKeyCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const [total, withoutKey] = await Promise.all([
      this.prisma.commune.count(),
      this.prisma.commune.count({ where: { nameNormalized: null } }),
    ]);

    if (total === 0) {
      this.logger.warn(
        'Commune referential is empty: search by name will return nothing. Run `npm run seed`.',
      );
      return;
    }

    if (withoutKey > 0) {
      this.logger.warn(
        `${withoutKey} of ${total} communes have no search key: they cannot be found by name. Run \`npm run seed\` to backfill.`,
      );
    }
  }
}
