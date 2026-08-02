import { Injectable } from '@nestjs/common';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CommunesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Prefix match on the raw name until phase 3 brings nameNormalized
   * (accent- and case-insensitive search); the sort follows the database
   * collation for the same reason. Only active codes are searchable —
   * expired ones stay in the referential for historical references but
   * never surface here.
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
