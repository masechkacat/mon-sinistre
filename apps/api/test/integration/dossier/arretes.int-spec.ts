import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  COMMUNE_ARRETES_WINDOW_MONTHS,
  RisqueCatnat,
  type CommuneArrete,
  type CommuneArretes,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { todayInParis } from 'src/common/time/today-in-paris';
import {
  DECLARATION_ASSUREUR_CODE,
  seedDeadlineRules,
} from 'src/deadline-rules/deadline-rule.seed';
import {
  isoDateToDate,
  resolveDeadline,
} from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { PrismaService } from 'src/prisma/prisma.service';
import { daysBetween } from 'src/sinistres/step-status';
import { createIntTestApp } from 'test/helpers/app';
import { arreteData, arreteEntryData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';
import { countWrites } from 'test/helpers/write-counters';

// GET /dossier/arretes, docs/plan/dossier-preliminaire.md, Фаза 2 (issue #253)
// — arrêtés коммуны за 12 месяцев со сроком декларации у каждого.
describe('DossierController GET /dossier/arretes (integration)', () => {
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
    // Per test, as the service computes it per request: fixed once for the
    // file, the twelve-month edge below would miss across Paris midnight.
    today = todayInParis();
  });

  let today: IsoDate;
  const daysAgo = (days: number): IsoDate =>
    resolveDeadline(today, -days, 'DAYS');
  const windowStart = (): IsoDate =>
    resolveDeadline(today, -COMMUNE_ARRETES_WINDOW_MONTHS, 'MONTHS');

  /** No `Authorization` header anywhere in this spec — the endpoint is public
   * (research, «Публичные эндпоинты»), and a header here would hide a
   * regression that put it back behind the guard. */
  async function arretes(
    codeInsee = '30189',
  ): Promise<{ statusCode: number; payload: string }> {
    return app.inject({
      method: 'GET',
      url: `/dossier/arretes?codeInsee=${codeInsee}`,
    });
  }

  async function arretesBody(codeInsee = '30189'): Promise<CommuneArretes> {
    const res = await arretes(codeInsee);
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.payload) as CommuneArretes;
  }

  async function createEntry(overrides: {
    publishedAt: IsoDate;
    codeInsee?: string;
    outcome?: 'RECONNU' | 'REFUSE';
    risque?: string;
  }): Promise<{ nor: string; legifranceUrl: string; entryId: string }> {
    const arrete = await prisma.arrete.create({
      data: {
        ...arreteData(),
        publishedAt: isoDateToDate(overrides.publishedAt),
        entries: {
          create: [
            arreteEntryData(overrides.codeInsee ?? '30189', {
              outcome: overrides.outcome ?? 'RECONNU',
              risque: overrides.risque,
            }),
          ],
        },
      },
      include: { entries: true },
    });
    const [entry] = arrete.entries;
    if (!entry) {
      throw new Error('fixture created an arrêté without its entry');
    }
    return {
      nor: arrete.nor,
      legifranceUrl: arrete.legifranceUrl,
      entryId: entry.id,
    };
  }

  /** The single entry a one-arrêté fixture must have produced. */
  function onlyArrete(body: CommuneArretes): CommuneArrete {
    const [entry, ...rest] = body.arretes;
    if (!entry || rest.length > 0) {
      throw new Error(`expected one arrêté, got ${body.arretes.length}`);
    }
    return entry;
  }

  async function declarationRule() {
    return prisma.deadlineRule.findFirstOrThrow({
      where: { code: DECLARATION_ASSUREUR_CODE },
    });
  }

  it('answers an empty list with the commune named when no arrêté covers it', async () => {
    const body = await arretesBody();

    expect(body.arretes).toEqual([]);
    expect(body.commune).toEqual({
      codeInsee: '30189',
      name: 'Nîmes',
      departementCode: '30',
      departementName: 'Gard',
    });
  });

  it('prints one RECONNU entry whole, with the déclaration deadline dated off its publication and the rule cited', async () => {
    const rule = await declarationRule();
    const publishedAt = daysAgo(10);
    const arrete = await createEntry({ publishedAt });

    const body = await arretesBody();

    const expectedDate = resolveDeadline(publishedAt, rule.duration, rule.unit);
    expect(body.arretes).toEqual([
      {
        arreteEntryId: arrete.entryId,
        nor: arrete.nor,
        publishedAt,
        legifranceUrl: arrete.legifranceUrl,
        risqueLabel: 'Inondations',
        risques: [RisqueCatnat.INONDATION],
        eventStart: '2026-06-01',
        eventEnd: '2026-06-20',
        outcome: 'RECONNU',
        declarationDeadline: {
          date: expectedDate,
          daysLeft: daysBetween(today, expectedDate),
          // The whole `SourceReference` is `toSourceReference`'s business and
          // its own spec's: here only the cited rule matters.
          source: expect.objectContaining({
            url: rule.sourceUrl,
          }) as unknown,
        },
      },
    ]);
  });

  it('orders two arrêtés of different risks by publication date, newest first, each with its own deadline', async () => {
    const rule = await declarationRule();
    const older = daysAgo(40);
    const newer = daysAgo(5);
    await createEntry({ publishedAt: older, risque: 'Inondations' });
    await createEntry({
      publishedAt: newer,
      risque:
        'Mouvements de terrain différentiels consécutifs à la sécheresse et à la réhydratation des sols',
    });

    const body = await arretesBody();

    expect(body.arretes.map((entry) => entry.publishedAt)).toEqual([
      newer,
      older,
    ]);
    expect(body.arretes.map((entry) => entry.risques)).toEqual([
      [RisqueCatnat.SECHERESSE],
      [RisqueCatnat.INONDATION],
    ]);
    expect(
      body.arretes.map((entry) => entry.declarationDeadline?.date),
    ).toEqual([
      resolveDeadline(newer, rule.duration, rule.unit),
      resolveDeadline(older, rule.duration, rule.unit),
    ]);
  });

  it('classifies an entry the JO worded for several risks into all of them', async () => {
    await createEntry({
      publishedAt: daysAgo(10),
      risque: 'Inondations, coulées de boue et mouvements de terrain',
    });

    const body = await arretesBody();

    const entry = onlyArrete(body);
    expect(entry.risqueLabel).toBe(
      'Inondations, coulées de boue et mouvements de terrain',
    );
    expect(new Set(entry.risques)).toEqual(
      new Set([RisqueCatnat.INONDATION, RisqueCatnat.MOUVEMENT_TERRAIN]),
    );
  });

  it('includes a publication exactly twelve months old and excludes the day before it', async () => {
    const edge = windowStart();
    await createEntry({ publishedAt: edge });
    await createEntry({ publishedAt: resolveDeadline(edge, -1, 'DAYS') });

    const body = await arretesBody();

    expect(body.arretes.map((entry) => entry.publishedAt)).toEqual([edge]);
  });

  it('names a refusal without a déclaration deadline', async () => {
    await createEntry({ publishedAt: daysAgo(10), outcome: 'REFUSE' });

    const body = await arretesBody();

    const entry = onlyArrete(body);
    expect(entry.outcome).toBe('REFUSE');
    expect(entry.declarationDeadline).toBeNull();
  });

  it('lists an entry a merged commune was named under by its old INSEE code', async () => {
    await prisma.commune.create({
      data: {
        ...commune('30188', 'Vieux-Nîmes', '30', 'Gard', '2026-01-01'),
        successorCodeInsee: '30189',
      },
    });
    const publishedAt = daysAgo(10);
    await createEntry({ publishedAt, codeInsee: '30188' });

    const body = await arretesBody();

    expect(body.arretes.map((entry) => entry.publishedAt)).toEqual([
      publishedAt,
    ]);
    expect(body.commune.codeInsee).toBe('30189');
  });

  it('rejects an unknown commune and a code of the wrong length', async () => {
    const [unknown, tooShort] = await Promise.all([
      arretes('99999'),
      arretes('301'),
    ]);

    expect(unknown.statusCode).toBe(400);
    expect(unknown.payload).toContain(fr.sinistres.unknownCommune);
    expect(tooShort.statusCode).toBe(400);
  });

  it('writes nothing: no sinistre, no step, no queued letter', async () => {
    await createEntry({ publishedAt: daysAgo(10) });
    const before = await countWrites(prisma);

    await arretesBody();

    expect(await countWrites(prisma)).toEqual(before);
  });
});
