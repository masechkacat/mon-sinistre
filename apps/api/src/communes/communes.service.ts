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
   * through normalizeCommuneName, so "chateau" finds "Château-Thierry". Only
   * active codes are searchable — expired ones stay in the referential for
   * historical references but never surface here.
   *
   * The sort runs on the same column, which the migration declares
   * `COLLATE "C"`: normalization strips case and accents but not punctuation,
   * and punctuation is exactly where collations disagree — glibc ignores a
   * hyphen at the primary level while musl and ICU do not, so "Saint-Étienne"
   * and "Sainte-Marie" swap places between deployments. Byte order makes the
   * result identical everywhere (verified against both images, 2026-08-02).
   *
   * The INSEE code branch upper-cases `q` instead of normalizing it: codes are
   * stored as the COG delivers them (2A004), so a phone keyboard's "2a004"
   * would otherwise find nothing — but the rest of normalization must not
   * touch a code.
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
          { codeInsee: q.toUpperCase() },
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
