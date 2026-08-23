import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { fr } from 'src/i18n/fr';
import { PrismaService } from 'src/prisma/prisma.service';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { seedStepTemplates } from 'src/step-templates/step-template.seed';
import { createIntTestApp } from 'test/helpers/app';
import { commune } from 'test/helpers/commune';
import {
  accessTokenOf,
  createUser,
  login,
  withBearer,
} from 'test/helpers/session';

// POST /sinistres and GET /sinistres/:id, docs/plan/sinistre-plan.md, Фаза 1
// (issue #150) — copying the CATNAT plan onto a fresh Sinistre.
describe('SinistresController (integration)', () => {
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
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "DeadlineRule", "StepTemplate", "Sinistre" CASCADE`;
    await prisma.commune.create({
      data: commune('30189', 'Nîmes', '30', 'Gard'),
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
  });

  async function bearerFor(
    email: string,
  ): Promise<ReturnType<typeof withBearer>> {
    const res = await login(app, email);
    return withBearer(accessTokenOf(res));
  }

  it('creates a sinistre and snapshots the plan: DATE_SINISTRE steps get dates, DATE_PUBLICATION_ARRETE/DATE_DECLARATION steps get a deadline source but no plannedDate', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);

    const res = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers,
      payload: {
        codeInsee: '30189',
        risque: 'INONDATION',
        eventDate: '2026-06-01',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.payload) as {
      status: string;
      steps: {
        anchor: string | null;
        plannedDate: string | null;
        source: { url: string; verifiedAt: string } | null;
      }[];
    };
    expect(body.status).toBe('AVANT_ARRETE');

    const sinistreSteps = body.steps.filter(
      (s) => s.anchor === 'DATE_SINISTRE',
    );
    expect(sinistreSteps.length).toBeGreaterThan(0);
    for (const step of sinistreSteps) {
      expect(step.plannedDate).not.toBeNull();
    }

    const declarationStep = body.steps.find(
      (s) => s.anchor === 'DATE_PUBLICATION_ARRETE',
    );
    expect(declarationStep?.plannedDate).toBeNull();
    expect(declarationStep?.source).not.toBeNull();
    expect(declarationStep?.source?.url).toMatch(/legifrance/);

    const informStep = body.steps.find(
      (s) => s.anchor === 'DATE_DECLARATION' && s.source !== null,
    );
    expect(informStep?.plannedDate).toBeNull();
    expect(informStep?.source).not.toBeNull();
  });

  it('rejects an eventDate in the future with a French message', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const res = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers,
      payload: {
        codeInsee: '30189',
        risque: 'INONDATION',
        eventDate: tomorrow,
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.payload).toContain(fr.sinistres.eventDateInFuture);
  });

  it('does not change an already-created sinistre when the StepTemplate is edited afterwards', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);

    const createRes = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers,
      payload: {
        codeInsee: '30189',
        risque: 'INONDATION',
        eventDate: '2026-06-01',
      },
    });
    const created = JSON.parse(createRes.payload) as {
      id: string;
      steps: { id: string; name: string }[];
    };
    const originalStepCount = created.steps.length;
    const originalFirstName = created.steps[0]?.name;

    await prisma.stepTemplate.updateMany({
      where: { planKey: 'CATNAT' },
      data: { name: 'Nom modifié après coup' },
    });

    const getRes = await app.inject({
      method: 'GET',
      url: `/sinistres/${created.id}`,
      headers,
    });
    const reread = JSON.parse(getRes.payload) as { steps: { name: string }[] };

    expect(reread.steps).toHaveLength(originalStepCount);
    expect(reread.steps[0]?.name).toBe(originalFirstName);
    expect(reread.steps.some((s) => s.name === 'Nom modifié après coup')).toBe(
      false,
    );
  });

  it('gives a fresh sinistre the AVANT_ARRETE status', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);

    const res = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers,
      payload: {
        codeInsee: '30189',
        risque: 'INONDATION',
        eventDate: '2026-06-01',
      },
    });

    const body = JSON.parse(res.payload) as { status: string };
    expect(body.status).toBe('AVANT_ARRETE');
  });

  it('answers the same 404 for a sinistre owned by someone else as for a nonexistent one', async () => {
    const ownerEmail = await createUser(prisma);
    const ownerHeaders = await bearerFor(ownerEmail);
    const createRes = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers: ownerHeaders,
      payload: {
        codeInsee: '30189',
        risque: 'INONDATION',
        eventDate: '2026-06-01',
      },
    });
    const { id } = JSON.parse(createRes.payload) as { id: string };

    const otherEmail = await createUser(prisma);
    const otherHeaders = await bearerFor(otherEmail);

    const [otherSees, nonexistent] = await Promise.all([
      app.inject({
        method: 'GET',
        url: `/sinistres/${id}`,
        headers: otherHeaders,
      }),
      app.inject({
        method: 'GET',
        url: '/sinistres/00000000-0000-0000-0000-000000000000',
        headers: otherHeaders,
      }),
    ]);

    expect(otherSees.statusCode).toBe(404);
    expect(nonexistent.statusCode).toBe(404);
    expect(otherSees.payload).toBe(nonexistent.payload);
  });

  it('rejects a malformed id with 400 rather than letting the invalid uuid reach Postgres as a 500', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);

    const res = await app.inject({
      method: 'GET',
      url: '/sinistres/not-a-uuid',
      headers,
    });

    expect(res.statusCode).toBe(400);
  });
});
