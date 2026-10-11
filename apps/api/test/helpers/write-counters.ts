import type { PrismaService } from 'src/prisma/prisma.service';

/**
 * The rows a public read must never leave behind — both endpoints of
 * `src/dossier/` assert these are unchanged (research, «Публичные
 * эндпоинты»: ни одной строки, ни одного письма). The project has no
 * `MailLog` table: the two notification outboxes are where a letter would be
 * queued.
 */
export async function countWrites(prisma: PrismaService) {
  return {
    sinistres: await prisma.sinistre.count(),
    steps: await prisma.step.count(),
    sinistreNotifications: await prisma.sinistreNotification.count(),
    veilleNotifications: await prisma.veilleNotification.count(),
  };
}
