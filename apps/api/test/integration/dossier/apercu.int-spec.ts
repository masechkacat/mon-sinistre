import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { toIsoDate } from '@mon-sinistre/contracts';
import { todayInParis } from 'src/common/time/today-in-paris.js';
import {
  DECLARATION_ASSUREUR_CODE,
  seedDeadlineRules,
} from 'src/deadline-rules/deadline-rule.seed.js';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline.js';
import { fr } from 'src/i18n/fr.js';
import { PrismaService } from 'src/prisma/prisma.service.js';
import { seedStepTemplates } from 'src/step-templates/step-template.seed.js';
import { createIntTestApp } from 'test/helpers/app.js';
import { arreteData, arreteEntryData } from 'test/helpers/arrete.js';
import { commune } from 'test/helpers/commune.js';
import { tomorrowInParis } from 'test/helpers/dates.js';
import { countWrites } from 'test/helpers/write-counters.js';

interface ApercuStep {
  name: string;
  kind: string;
  anchor: string | null;
  plannedDate: string | null;
  status: string;
  order: number;
  source: { url: string } | null;
}

interface ApercuBody {
  commune: { codeInsee: string; name: string };
  risque: string;
  eventDate: string;
  status: string;
  arrete: {
    publishedAt: string;
    legifranceUrl: string;
    outcome: string;
    eventStart: string;
    eventEnd: string;
  } | null;
  steps: ApercuStep[];
  declarationDeadline: { date: string; daysLeft: number } | null;
}

// GET /dossier/apercu, docs/plan/dossier-preliminaire.md, Фаза 1 (issue #250)
// — план, который получил бы синистр, без единой записанной строки.
describe('DossierController GET /dossier/apercu (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createIntTestApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "DeadlineRule", "StepTemplate", "Sinistre", "Arrete" CASCADE`;
    await prisma.commune.create({
      data: commune('30189', 'Nîmes', '30', 'Gard'),
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
  });

  /** No `Authorization` header anywhere in this spec — the endpoint is public
   * (research, «Публичные эндпоинты»), and a header here would hide a
   * regression that put it back behind the guard. */
  async function apercu(
    params: Record<string, string> = {},
  ): Promise<{ statusCode: number; payload: string }> {
    const query = new URLSearchParams({
      codeInsee: '30189',
      risque: 'INONDATION',
      eventDate: '2026-06-10',
      ...params,
    });
    return app.inject({
      method: 'GET',
      url: `/dossier/apercu?${query.toString()}`,
    });
  }

  async function apercuBody(
    params: Record<string, string> = {},
  ): Promise<ApercuBody> {
    const res = await apercu(params);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload) as ApercuBody;
  }

  async function createEntry(overrides: {
    publishedAt: string;
    codeInsee?: string;
    outcome?: 'RECONNU' | 'REFUSE';
    eventStart?: string;
    eventEnd?: string;
  }): Promise<{ legifranceUrl: string }> {
    const arrete = await prisma.arrete.create({
      data: {
        ...arreteData(),
        publishedAt: new Date(overrides.publishedAt),
        entries: {
          create: [
            arreteEntryData(overrides.codeInsee ?? '30189', {
              outcome: overrides.outcome ?? 'RECONNU',
              eventStart: new Date(overrides.eventStart ?? '2026-06-01'),
              eventEnd: new Date(overrides.eventEnd ?? '2026-06-20'),
            }),
          ],
        },
      },
    });
    return arrete;
  }

  /** The step of this anchor whose deadline rule resolved — the legal one. */
  function legalStepOf(body: ApercuBody, anchor: string): ApercuStep {
    const step = body.steps.find(
      (s) => s.anchor === anchor && s.source !== null,
    );
    if (!step) {
      throw new Error(`fixture has no ${anchor} legal step`);
    }
    return step;
  }

  async function declarationRule() {
    return prisma.deadlineRule.findFirstOrThrow({
      where: { code: DECLARATION_ASSUREUR_CODE },
    });
  }

  it('answers AVANT_ARRETE with no arrêté and no deadline when none covers the event, the publication-anchored steps standing without a date', async () => {
    const body = await apercuBody();

    expect(body.status).toBe('AVANT_ARRETE');
    expect(body.arrete).toBeNull();
    expect(body.declarationDeadline).toBeNull();
    expect(body.commune.codeInsee).toBe('30189');
    expect(body.commune.name).toBe('Nîmes');
    expect(body.eventDate).toBe('2026-06-10');
    expect(body.risque).toBe('INONDATION');

    const publication = body.steps.filter(
      (s) => s.anchor === 'DATE_PUBLICATION_ARRETE',
    );
    expect(publication.length).toBeGreaterThan(0);
    for (const step of publication) {
      expect(step.plannedDate).toBeNull();
    }
    expect(legalStepOf(body, 'DATE_PUBLICATION_ARRETE').source?.url).toMatch(
      /legifrance/,
    );

    const fromEvent = body.steps.filter((s) => s.anchor === 'DATE_SINISTRE');
    expect(fromEvent.length).toBeGreaterThan(0);
    for (const step of fromEvent) {
      expect(step.plannedDate).not.toBeNull();
    }
  });

  it('answers ARRETE_PUBLIE with the arrêté and the déclaration deadline dated off its publication, not off today', async () => {
    const rule = await declarationRule();
    const arrete = await createEntry({ publishedAt: '2026-06-05' });

    const body = await apercuBody();

    expect(body.status).toBe('ARRETE_PUBLIE');
    expect(body.arrete).toEqual({
      publishedAt: '2026-06-05',
      legifranceUrl: arrete.legifranceUrl,
      outcome: 'RECONNU',
      eventStart: '2026-06-01',
      eventEnd: '2026-06-20',
    });
    const expected = resolveDeadline(
      toIsoDate('2026-06-05'),
      rule.duration,
      rule.unit,
    );
    expect(body.declarationDeadline?.date).toBe(expected);
    expect(legalStepOf(body, 'DATE_PUBLICATION_ARRETE').plannedDate).toBe(
      expected,
    );
  });

  it('counts the déclaration deadline as expired when the arrêté was published two months ago', async () => {
    const twoMonthsAgo = resolveDeadline(todayInParis(), -2, 'MONTHS');
    await createEntry({
      publishedAt: twoMonthsAgo,
      eventStart: twoMonthsAgo,
      eventEnd: twoMonthsAgo,
    });

    const body = await apercuBody({ eventDate: twoMonthsAgo });

    expect(body.status).toBe('ARRETE_PUBLIE');
    expect(body.declarationDeadline?.daysLeft).toBeLessThan(0);
    expect(legalStepOf(body, 'DATE_PUBLICATION_ARRETE').status).toBe(
      'EN_RETARD',
    );
  });

  it('prefers the RECONNU entry when the same period also carries a refusal', async () => {
    // Two arrêtés rather than two entries of one: the refusal and the
    // recognition of the same commune, risque and period cannot coexist in a
    // single arrêté (partial unique index, schema.prisma `ArreteEntry`) — a
    // repeat demande is exactly how the pair occurs in the JO.
    await createEntry({ publishedAt: '2026-06-05', outcome: 'REFUSE' });
    await createEntry({ publishedAt: '2026-07-10', outcome: 'RECONNU' });

    const body = await apercuBody();

    expect(body.status).toBe('ARRETE_PUBLIE');
    expect(body.arrete?.outcome).toBe('RECONNU');
    expect(body.declarationDeadline).not.toBeNull();
  });

  it('names a refusal as ARRETE_REFUSE with no déclaration deadline', async () => {
    await createEntry({ publishedAt: '2026-06-05', outcome: 'REFUSE' });

    const body = await apercuBody();

    expect(body.status).toBe('ARRETE_REFUSE');
    expect(body.arrete?.outcome).toBe('REFUSE');
    expect(body.declarationDeadline).toBeNull();
    expect(legalStepOf(body, 'DATE_PUBLICATION_ARRETE').plannedDate).toBeNull();
  });

  it('includes the last day of the event period and excludes the day after it', async () => {
    await createEntry({
      publishedAt: '2026-06-25',
      eventStart: '2026-06-01',
      eventEnd: '2026-06-20',
    });

    const [lastDay, dayAfter] = await Promise.all([
      apercuBody({ eventDate: '2026-06-20' }),
      apercuBody({ eventDate: '2026-06-21' }),
    ]);

    expect(lastDay.status).toBe('ARRETE_PUBLIE');
    expect(dayAfter.status).toBe('AVANT_ARRETE');
    expect(dayAfter.arrete).toBeNull();
  });

  it('finds the entry a merged commune was named under by its old INSEE code', async () => {
    await prisma.commune.create({
      data: {
        ...commune('30188', 'Vieux-Nîmes', '30', 'Gard', '2026-01-01'),
        successorCodeInsee: '30189',
      },
    });
    await createEntry({ publishedAt: '2026-06-05', codeInsee: '30188' });

    const body = await apercuBody();

    expect(body.status).toBe('ARRETE_PUBLIE');
    expect(body.arrete?.publishedAt).toBe('2026-06-05');
  });

  it('carries the kind of each container step and gives no step an id', async () => {
    const body = await apercuBody();

    const kindByOrder = new Map(body.steps.map((s) => [s.order, s.kind]));
    expect(kindByOrder.get(1)).toBe('PHOTOS');
    expect(kindByOrder.get(5)).toBe('JUSTIFICATIFS');
    expect(kindByOrder.get(7)).toBe('DECLARATION');
    expect(kindByOrder.get(9)).toBe('OBJETS');
    expect(body.steps.filter((s) => s.kind !== 'ACTION')).toHaveLength(4);

    for (const step of body.steps) {
      expect(step).not.toHaveProperty('id');
      expect(step).not.toHaveProperty('sinistreId');
    }
    expect(body).not.toHaveProperty('id');
  });

  it('rejects an unknown commune, a future date and a risque outside the enum', async () => {
    const tomorrow = tomorrowInParis();

    const [unknown, future, risque] = await Promise.all([
      apercu({ codeInsee: '99999' }),
      apercu({ eventDate: tomorrow }),
      apercu({ risque: 'TEMPETE' }),
    ]);

    expect(unknown.statusCode).toBe(400);
    expect(unknown.payload).toContain(fr.sinistres.unknownCommune);
    expect(future.statusCode).toBe(400);
    expect(future.payload).toContain(fr.sinistres.eventDateInFuture);
    expect(risque.statusCode).toBe(400);
  });

  it('writes nothing: no sinistre, no step, no queued letter', async () => {
    await createEntry({ publishedAt: '2026-06-05' });
    const before = await countWrites(prisma);

    await apercuBody();

    expect(await countWrites(prisma)).toEqual(before);
    expect(before.sinistres).toBe(0);
    expect(before.steps).toBe(0);
  });
});
