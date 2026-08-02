import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * Makes a missing search key loud at startup.
 *
 * `Commune.nameNormalized` is filled by the import, not by the migration, so
 * the deployment order is `migration:deploy` → `seed`. Skipping the second
 * step breaks nothing visibly: every search by name simply returns an empty
 * list, because no row carries a key — the worst possible failure for an
 * audience looking for its own commune days after a disaster.
 *
 * Until the column is tightened to NOT NULL (a separate migration, only
 * possible once every deployment has been backfilled) this counter is what
 * turns that silence into a log line. It warns rather than aborts on purpose:
 * a partially imported referential still answers for the communes it knows,
 * and refusing to boot would take away a working search too.
 *
 * Counters only, no commune data — the logging rule of the project.
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
