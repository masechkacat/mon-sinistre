import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { PrismaClient } from 'src/generated/prisma/client';
import { seedStepTemplates } from 'src/step-templates/step-template.seed';
import { commune } from 'test/helpers/commune';

// Горстка коммун для сквозного сценария, не весь справочник: полный импорт
// требует сети, а база сквозного теста её может не иметь.
export const E2E_COMMUNES = [
  commune('75056', 'Paris', '75', 'Paris'),
  commune('13055', 'Marseille', '13', 'Bouches-du-Rhône'),
  commune('69123', 'Lyon', '69', 'Rhône'),
  commune('33063', 'Bordeaux', '33', 'Gironde'),
];

export async function seedE2eReferential(prisma: PrismaClient): Promise<void> {
  for (const row of E2E_COMMUNES) {
    await prisma.commune.upsert({
      where: { codeInsee: row.codeInsee },
      create: row,
      update: row,
    });
  }
  await seedDeadlineRules(prisma);
  await seedStepTemplates(prisma);
}
