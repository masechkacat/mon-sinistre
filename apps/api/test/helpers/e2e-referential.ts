import { todayInParis } from 'src/common/time/today-in-paris.js';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed.js';
import {
  isoDateToDate,
  resolveDeadline,
} from 'src/deadline-rules/resolve-deadline.js';
import { PrismaClient } from 'src/generated/prisma/client.js';
import { seedStepTemplates } from 'src/step-templates/step-template.seed.js';
import { E2E_ARRETE, arreteData, arreteEntryData } from 'test/helpers/arrete.js';
import { commune } from 'test/helpers/commune.js';

// Горстка коммун для сквозного сценария, не весь справочник: полный импорт
// требует сети, а база сквозного теста её может не иметь.
export const E2E_COMMUNES = [
  commune('75056', 'Paris', '75', 'Paris'),
  commune('13055', 'Marseille', '13', 'Bouches-du-Rhône'),
  commune('69123', 'Lyon', '69', 'Rhône'),
  commune('33063', 'Bordeaux', '33', 'Gironde'),
];

/**
 * Дней от прогона до публикации {@link E2E_ARRETE}: достаточно близко, чтобы
 * срок декларации ещё шёл — ответ по коммуне показывает бейдж только пока он
 * идёт, — и глубоко внутри окна `COMMUNE_ARRETES_WINDOW_MONTHS`.
 */
const PUBLISHED_DAYS_AGO = 10;

async function seedE2eArrete(prisma: PrismaClient): Promise<void> {
  // Сдвигается только дата публикации: `signedAt` и `firstSeenAt` фикстуры
  // остаются в июне, потому что сценарий читает не след монитора, а ту
  // единственную дату, от которой ответ по коммуне считает окно и срок.
  const data = {
    ...arreteData({ nor: E2E_ARRETE.nor }),
    publishedAt: isoDateToDate(
      resolveDeadline(todayInParis(), -PUBLISHED_DAYS_AGO, 'DAYS'),
    ),
  };

  const entry = arreteEntryData(E2E_ARRETE.codeInsee, {
    communeLabelRaw: E2E_ARRETE.communeLabelRaw,
    departementRaw: E2E_ARRETE.departementRaw,
    risque: E2E_ARRETE.risqueLabel,
    eventStart: isoDateToDate(E2E_ARRETE.eventStart),
    eventEnd: isoDateToDate(E2E_ARRETE.eventEnd),
  });

  // База сквозного теста живёт между прогонами, и на строку annexe уже может
  // ссылаться синистр прошлого прогона: её не пересоздают, а сверяют с
  // `E2E_ARRETE`, иначе правка фикстуры осталась бы в базе незамеченной.
  await prisma.arrete.upsert({
    where: { nor: E2E_ARRETE.nor },
    create: { ...data, entries: { create: [entry] } },
    update: {
      ...data,
      entries: {
        updateMany: { where: { codeInsee: entry.codeInsee }, data: entry },
      },
    },
  });
}

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
  await seedE2eArrete(prisma);
}
