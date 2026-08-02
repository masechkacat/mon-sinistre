import { Injectable } from '@nestjs/common';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { PrismaService } from 'src/prisma/prisma.service';
import { normalizeCommuneName } from './normalize-commune-name';

/**
 * Prisma's `startsWith` passes the value straight into a LIKE pattern, so `%`
 * and `_` typed by a user would act as wildcards (`q=__` would match every
 * commune). Postgres reads a backslash as the default LIKE escape character,
 * and the pattern travels as a bind parameter, so escaping it here keeps the
 * query typed — no `$queryRaw` needed. The backslash itself goes first, or it
 * would escape the escapes added after it.
 */
const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, '\\$&');

@Injectable()
export class CommunesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prefix match on the normalized name — both sides of the comparison go
   * through normalizeCommuneName, so "chateau" finds "Château-Thierry". The
   * sort runs on the same column and therefore does not depend on the
   * database collation. Only active codes are searchable — expired ones stay
   * in the referential for historical references but never surface here.
   *
   * The INSEE code branch compares the raw `q`: codes are stored as the COG
   * delivers them, uppercase (2A004), and normalizing would break the match.
   */
  search(q: string): Promise<Commune[]> {
    return this.prisma.commune.findMany({
      where: {
        effectiveTo: null,
        OR: [
          {
            nameNormalized: {
              startsWith: escapeLikePattern(normalizeCommuneName(q)),
            },
          },
          { codeInsee: q },
        ],
      },
      orderBy: { nameNormalized: 'asc' },
      take: COMMUNE_SEARCH_LIMIT,
      select: {
        codeInsee: true,
        name: true,
        departementCode: true,
        departementName: true,
      },
    });
  }
}
