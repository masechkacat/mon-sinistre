import { BadRequestException } from '@nestjs/common';
import type { Commune } from '@mon-sinistre/contracts';
import { fr } from 'src/i18n/fr.js';
import type { PrismaService } from 'src/prisma/prisma.service.js';
import { communeFields } from './commune-fields.js';

/**
 * The commune a request names, or the `400` for a code the referential does
 * not know. A merged commune does not answer for itself: it carries an
 * `effectiveTo` and is reachable only as some other commune's predecessor.
 */
export async function requireActiveCommune(
  prisma: Pick<PrismaService, 'commune'>,
  codeInsee: string,
): Promise<Commune> {
  const commune = await prisma.commune.findFirst({
    where: { codeInsee, effectiveTo: null },
    select: communeFields,
  });
  if (!commune) {
    throw new BadRequestException(fr.sinistres.unknownCommune);
  }
  return commune;
}
