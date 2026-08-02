import { Injectable } from '@nestjs/common';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CommunesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prefix match on the name or exact INSEE code, current codes only
   * (effectiveTo IS NULL). Phase 3 will switch both the match and the
   * ordering to a normalized column; until then matching is exact-prefix and
   * ordering follows the database collation.
   */
  search(q: string): Promise<Commune[]> {
    return this.prisma.commune.findMany({
      where: {
        effectiveTo: null,
        OR: [{ name: { startsWith: q } }, { codeInsee: q }],
      },
      orderBy: { name: 'asc' },
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
