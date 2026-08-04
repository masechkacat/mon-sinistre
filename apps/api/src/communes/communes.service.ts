import { Injectable } from '@nestjs/common';
import { COMMUNE_SEARCH_LIMIT, Commune } from '@mon-sinistre/contracts';
import { escapeLikePattern } from 'src/prisma/escape-like-pattern';
import { PrismaService } from 'src/prisma/prisma.service';
import { normalizeCommuneName } from './normalize-commune-name';

@Injectable()
export class CommunesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The INSEE code branch upper-cases `q` instead of normalizing it: codes are
   * stored as the COG delivers them (2A004), and the rest of normalization must
   * not touch a code.
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
