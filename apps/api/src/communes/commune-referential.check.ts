import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

/**
 * An empty commune referential is the one deployment mistake the schema
 * cannot catch: `Commune.nameNormalized` is NOT NULL, so a `seed` that ran
 * partially now fails the migration instead of half-filling the table — but
 * a `seed` that never ran at all leaves no rows to violate anything, and
 * every search by name simply returns an empty list.
 *
 * Warns rather than aborts on purpose — the rest of the API answers, and an
 * environment brought up before its first import is a normal intermediate
 * state, not a broken one.
 */
@Injectable()
export class CommuneReferentialCheck implements OnApplicationBootstrap {
  private readonly logger = new Logger(CommuneReferentialCheck.name);

  constructor(private readonly prisma: PrismaService) {}

  async onApplicationBootstrap(): Promise<void> {
    const total = await this.prisma.commune.count();

    if (total === 0) {
      this.logger.warn(
        'Commune referential is empty: search by name will return nothing. Run `npm run seed`.',
      );
    }
  }
}
