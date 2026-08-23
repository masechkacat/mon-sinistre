import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { toIsoDate } from '@mon-sinistre/contracts';
import { todayInParis } from 'src/common/time/today-in-paris';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  PROVISION_INDEMNITE_CODE,
  seedDeadlineRules,
} from 'src/deadline-rules/deadline-rule.seed';
import { seedStepTemplates } from 'src/step-templates/step-template.seed';
import { createIntTestApp } from 'test/helpers/app';
import { arreteData, arreteEntryData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';
import {
  accessTokenOf,
  createUser,
  login,
  withBearer,
} from 'test/helpers/session';

interface SinistreWithSteps {
  id: string;
  steps: { id: string; anchor: string | null; status: string }[];
}

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
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "DeadlineRule", "StepTemplate", "Sinistre", "Arrete" CASCADE`;
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

  async function createSinistre(
    headers: ReturnType<typeof withBearer>,
    eventDate = '2026-06-01',
  ): Promise<SinistreWithSteps> {
    const res = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers,
      payload: { codeInsee: '30189', risque: 'INONDATION', eventDate },
    });
    return JSON.parse(res.payload) as SinistreWithSteps;
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
    // Tomorrow in Europe/Paris, the timezone the validator compares against:
    // a UTC "tomorrow" is already today in Paris between 22:00 and midnight
    // UTC, and the request would be accepted.
    const tomorrow = resolveDeadline(todayInParis(), 1, 'DAYS');

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

  it('names the actual problem for a date that is not a real YYYY-MM-DD, rather than calling it a future date', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);

    const [malformed, missing] = await Promise.all([
      app.inject({
        method: 'POST',
        url: '/sinistres',
        headers,
        payload: {
          codeInsee: '30189',
          risque: 'INONDATION',
          eventDate: '2026-02-30',
        },
      }),
      app.inject({
        method: 'POST',
        url: '/sinistres',
        headers,
        payload: { codeInsee: '30189', risque: 'INONDATION' },
      }),
    ]);

    expect(malformed.statusCode).toBe(400);
    expect(malformed.payload).toContain(fr.sinistres.eventDateInvalid);
    expect(malformed.payload).not.toContain(fr.sinistres.eventDateInFuture);
    expect(missing.statusCode).toBe(400);
    expect(missing.payload).toContain(fr.sinistres.eventDateRequired);
  });

  it('still creates the dossier when a DeadlineRule is missing: the steps that need no rule keep their dates, the one that does gets no source', async () => {
    const email = await createUser(prisma);
    const headers = await bearerFor(email);
    // A referential gap — an admin closed the rule and its successor has not
    // started yet — must not cost the user the whole plan.
    await prisma.deadlineRule.deleteMany({
      where: { code: PROVISION_INDEMNITE_CODE },
    });

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
      steps: {
        anchor: string | null;
        plannedDate: string | null;
        source: { url: string } | null;
      }[];
    };
    const sinistreSteps = body.steps.filter(
      (s) => s.anchor === 'DATE_SINISTRE',
    );
    expect(sinistreSteps.length).toBeGreaterThan(0);
    for (const step of sinistreSteps) {
      expect(step.plannedDate).not.toBeNull();
    }
    expect(
      body.steps.some(
        (s) => s.anchor === 'DATE_PUBLICATION_ARRETE' && s.source !== null,
      ),
    ).toBe(true);
    const orphaned = body.steps.filter(
      (s) => s.anchor === 'DATE_ETAT_ESTIMATIF',
    );
    expect(orphaned.length).toBeGreaterThan(0);
    for (const step of orphaned) {
      expect(step.source).toBeNull();
    }
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

  // GET /sinistres and DELETE /sinistres/:id, docs/plan/sinistre-plan.md,
  // Фаза 2 (issue #151).
  describe('GET /sinistres and DELETE /sinistres/:id', () => {
    it("lists only the caller's own sinistres, freshest created first", async () => {
      const ownerEmail = await createUser(prisma);
      const ownerHeaders = await bearerFor(ownerEmail);
      const firstId = (await createSinistre(ownerHeaders, '2026-05-01')).id;
      const secondId = (await createSinistre(ownerHeaders, '2026-06-01')).id;

      const otherEmail = await createUser(prisma);
      const otherHeaders = await bearerFor(otherEmail);
      await createSinistre(otherHeaders, '2026-06-01');

      const res = await app.inject({
        method: 'GET',
        url: '/sinistres',
        headers: ownerHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as { id: string }[];
      expect(body.map((s) => s.id)).toEqual([secondId, firstId]);
    });

    it('deletes a sinistre and cascades its steps', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const id = (await createSinistre(headers)).id;
      const stepCountBefore = await prisma.step.count({
        where: { sinistreId: id },
      });
      expect(stepCountBefore).toBeGreaterThan(0);

      const res = await app.inject({
        method: 'DELETE',
        url: `/sinistres/${id}`,
        headers,
      });

      expect(res.statusCode).toBe(204);
      expect(await prisma.sinistre.findUnique({ where: { id } })).toBeNull();
      expect(await prisma.step.count({ where: { sinistreId: id } })).toBe(0);
    });

    it('answers the same 404 for deleting a sinistre owned by someone else as for a nonexistent one', async () => {
      const ownerEmail = await createUser(prisma);
      const ownerHeaders = await bearerFor(ownerEmail);
      const id = (await createSinistre(ownerHeaders)).id;

      const otherEmail = await createUser(prisma);
      const otherHeaders = await bearerFor(otherEmail);

      const [otherDeletes, nonexistent] = await Promise.all([
        app.inject({
          method: 'DELETE',
          url: `/sinistres/${id}`,
          headers: otherHeaders,
        }),
        app.inject({
          method: 'DELETE',
          url: '/sinistres/00000000-0000-0000-0000-000000000000',
          headers: otherHeaders,
        }),
      ]);

      expect(otherDeletes.statusCode).toBe(404);
      expect(nonexistent.statusCode).toBe(404);
      expect(otherDeletes.payload).toBe(nonexistent.payload);
      // Not actually deleted — the other user's call must not have touched it.
      expect(
        await prisma.sinistre.findUnique({ where: { id } }),
      ).not.toBeNull();
    });

    it('deletes the account cleanly when it still owns a sinistre', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const id = (await createSinistre(headers)).id;

      const res = await app.inject({
        method: 'DELETE',
        url: '/auth/me',
        headers,
      });

      expect(res.statusCode).toBe(204);
      expect(await prisma.sinistre.findUnique({ where: { id } })).toBeNull();
    });
  });

  // PATCH /sinistres/:id/etapes/:stepId, docs/plan/sinistre-plan.md, Фаза 2
  // (issue #152).
  describe('PATCH /sinistres/:id/etapes/:stepId', () => {
    async function reread(
      headers: ReturnType<typeof withBearer>,
      sinistreId: string,
    ): Promise<SinistreWithSteps> {
      const res = await app.inject({
        method: 'GET',
        url: `/sinistres/${sinistreId}`,
        headers,
      });
      return JSON.parse(res.payload) as SinistreWithSteps;
    }

    it('marks a step FAIT without changing the other steps', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers);
      const target = sinistre.steps.find((s) => s.anchor === 'DATE_SINISTRE');
      if (!target) {
        throw new Error('fixture has no DATE_SINISTRE step');
      }
      const othersBefore = sinistre.steps.filter((s) => s.id !== target.id);

      const res = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}/etapes/${target.id}`,
        headers,
        payload: { status: 'FAIT' },
      });

      expect(res.statusCode).toBe(200);
      const updated = JSON.parse(res.payload) as { status: string };
      expect(updated.status).toBe('FAIT');

      const after = await reread(headers, sinistre.id);
      expect(after.steps.find((s) => s.id === target.id)?.status).toBe('FAIT');
      for (const before of othersBefore) {
        const afterStep = after.steps.find((s) => s.id === before.id);
        expect(afterStep?.status).toBe(before.status);
      }
    });

    it('returns the computed status when the mark is removed', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers);
      const target = sinistre.steps.find((s) => s.anchor === 'DATE_SINISTRE');
      if (!target) {
        throw new Error('fixture has no DATE_SINISTRE step');
      }

      await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}/etapes/${target.id}`,
        headers,
        payload: { status: 'FAIT' },
      });

      const res = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}/etapes/${target.id}`,
        headers,
        payload: { status: null },
      });

      expect(res.statusCode).toBe(200);
      const updated = JSON.parse(res.payload) as { status: string };
      expect(updated.status).toBe(target.status);
    });

    it('answers 404 for a step on a sinistre owned by someone else and leaves it unchanged', async () => {
      const ownerEmail = await createUser(prisma);
      const ownerHeaders = await bearerFor(ownerEmail);
      const sinistre = await createSinistre(ownerHeaders);
      const target = sinistre.steps[0];
      if (!target) {
        throw new Error('fixture has no steps');
      }

      const otherEmail = await createUser(prisma);
      const otherHeaders = await bearerFor(otherEmail);

      const res = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}/etapes/${target.id}`,
        headers: otherHeaders,
        payload: { status: 'FAIT' },
      });

      expect(res.statusCode).toBe(404);
      const after = await reread(ownerHeaders, sinistre.id);
      expect(after.steps.find((s) => s.id === target.id)?.status).toBe(
        target.status,
      );
    });
  });

  // PATCH /sinistres/:id, docs/plan/sinistre-plan.md, Фаза 2 (issue #153).
  describe('PATCH /sinistres/:id', () => {
    interface SinistreWithDetail extends SinistreWithSteps {
      status: string;
      declarationDate: string | null;
      steps: {
        id: string;
        anchor: string | null;
        status: string;
        plannedDate: string | null;
        source: { url: string } | null;
      }[];
    }

    async function reread(
      headers: ReturnType<typeof withBearer>,
      sinistreId: string,
    ): Promise<SinistreWithDetail> {
      const res = await app.inject({
        method: 'GET',
        url: `/sinistres/${sinistreId}`,
        headers,
      });
      return JSON.parse(res.payload) as SinistreWithDetail;
    }

    function informStepOf(sinistre: SinistreWithDetail) {
      const step = sinistre.steps.find(
        (s) => s.anchor === 'DATE_DECLARATION' && s.source !== null,
      );
      if (!step) {
        throw new Error('fixture has no DATE_DECLARATION legal step');
      }
      return step;
    }

    async function informRule() {
      const rule = await prisma.deadlineRule.findFirst({
        where: { code: 'INFORMATION_ASSUREUR' },
      });
      if (!rule) {
        throw new Error('INFORMATION_ASSUREUR rule was not seeded');
      }
      return rule;
    }

    /** Links a sinistre to a RECONNU entry directly through Prisma — Фаза 3
     * has not landed yet, so there is no `matchSinistres` to call. */
    async function linkToReconnuEntry(sinistreId: string, publishedAt: string) {
      const arrete = await prisma.arrete.create({
        data: {
          ...arreteData(),
          publishedAt: new Date(publishedAt),
          entries: {
            create: [
              arreteEntryData({
                codeInsee: '30189',
                eventStart: new Date('2026-01-01'),
                eventEnd: new Date('2026-12-31'),
              }),
            ],
          },
        },
        include: { entries: true },
      });
      await prisma.sinistre.update({
        where: { id: sinistreId },
        data: { arreteEntryId: arrete.entries[0]!.id, status: 'ARRETE_PUBLIE' },
      });
    }

    it('sets DECLARE on an unlinked sinistre, then clearing restores AVANT_ARRETE, not ARRETE_PUBLIE', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers);

      const setRes = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}`,
        headers,
        payload: { declarationDate: '2026-06-10' },
      });

      expect(setRes.statusCode).toBe(200);
      const declared = JSON.parse(setRes.payload) as SinistreWithDetail;
      expect(declared.status).toBe('DECLARE');
      expect(declared.declarationDate).toBe('2026-06-10');
      // No arrêté is published yet, so the legal anchor — publication *or*
      // declaration, whichever is later — still has nothing to compare the
      // declaration against (docs/research/sinistre-plan.md, «Опорная дата
      // DATE_DECLARATION»).
      expect(informStepOf(declared).plannedDate).toBeNull();

      const clearRes = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}`,
        headers,
        payload: { declarationDate: null },
      });

      expect(clearRes.statusCode).toBe(200);
      const cleared = JSON.parse(clearRes.payload) as SinistreWithDetail;
      expect(cleared.status).toBe('AVANT_ARRETE');
      expect(cleared.declarationDate).toBeNull();
    });

    it('dates the DATE_DECLARATION steps once the sinistre is linked, then clearing removes those dates and returns to ARRETE_PUBLIE (critère PRD № 18)', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers, '2026-06-01');
      const rule = await informRule();
      await linkToReconnuEntry(sinistre.id, '2026-07-10');

      const setRes = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}`,
        headers,
        payload: { declarationDate: '2026-07-20' },
      });

      expect(setRes.statusCode).toBe(200);
      const declared = JSON.parse(setRes.payload) as SinistreWithDetail;
      expect(declared.status).toBe('DECLARE');
      expect(informStepOf(declared).plannedDate).toBe(
        resolveDeadline(toIsoDate('2026-07-20'), rule.duration, rule.unit),
      );

      const clearRes = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}`,
        headers,
        payload: { declarationDate: null },
      });

      expect(clearRes.statusCode).toBe(200);
      const cleared = JSON.parse(clearRes.payload) as SinistreWithDetail;
      expect(cleared.status).toBe('ARRETE_PUBLIE');
      expect(cleared.declarationDate).toBeNull();
      expect(informStepOf(cleared).plannedDate).toBeNull();
    });

    it("does not pull the insurer's response deadline earlier than the legal one when the declaration precedes the arrêté's publication", async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers, '2026-06-01');
      const rule = await informRule();
      await linkToReconnuEntry(sinistre.id, '2026-07-10');

      const res = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}`,
        headers,
        payload: { declarationDate: '2026-06-15' },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.payload) as SinistreWithDetail;
      expect(body.status).toBe('DECLARE');
      const expected = resolveDeadline(
        toIsoDate('2026-07-10'),
        rule.duration,
        rule.unit,
      );
      expect(informStepOf(body).plannedDate).toBe(expected);
      expect(informStepOf(body).plannedDate).not.toBe(
        resolveDeadline(toIsoDate('2026-06-15'), rule.duration, rule.unit),
      );
    });

    it('rejects a declarationDate in the future with a French message', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers);
      const tomorrow = resolveDeadline(todayInParis(), 1, 'DAYS');

      const res = await app.inject({
        method: 'PATCH',
        url: `/sinistres/${sinistre.id}`,
        headers,
        payload: { declarationDate: tomorrow },
      });

      expect(res.statusCode).toBe(400);
      expect(res.payload).toContain(fr.sinistres.declarationDateInFuture);
    });

    it('names the actual problem for a malformed or missing declarationDate, rather than calling it a future date', async () => {
      const email = await createUser(prisma);
      const headers = await bearerFor(email);
      const sinistre = await createSinistre(headers);

      const [malformed, missing] = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/sinistres/${sinistre.id}`,
          headers,
          payload: { declarationDate: '2026-02-30' },
        }),
        app.inject({
          method: 'PATCH',
          url: `/sinistres/${sinistre.id}`,
          headers,
          payload: {},
        }),
      ]);

      expect(malformed.statusCode).toBe(400);
      expect(malformed.payload).toContain(fr.sinistres.declarationDateInvalid);
      expect(malformed.payload).not.toContain(
        fr.sinistres.declarationDateInFuture,
      );
      expect(missing.statusCode).toBe(400);
      expect(missing.payload).toContain(fr.sinistres.declarationDateRequired);
    });

    it('answers the same 404 for a sinistre owned by someone else as for a nonexistent one, and leaves it unchanged', async () => {
      const ownerEmail = await createUser(prisma);
      const ownerHeaders = await bearerFor(ownerEmail);
      const sinistre = await createSinistre(ownerHeaders);

      const otherEmail = await createUser(prisma);
      const otherHeaders = await bearerFor(otherEmail);

      const [otherPatches, nonexistent] = await Promise.all([
        app.inject({
          method: 'PATCH',
          url: `/sinistres/${sinistre.id}`,
          headers: otherHeaders,
          payload: { declarationDate: '2026-06-10' },
        }),
        app.inject({
          method: 'PATCH',
          url: '/sinistres/00000000-0000-0000-0000-000000000000',
          headers: otherHeaders,
          payload: { declarationDate: '2026-06-10' },
        }),
      ]);

      expect(otherPatches.statusCode).toBe(404);
      expect(nonexistent.statusCode).toBe(404);
      expect(otherPatches.payload).toBe(nonexistent.payload);
      const after = await reread(ownerHeaders, sinistre.id);
      expect(after.status).toBe('AVANT_ARRETE');
      expect(after.declarationDate).toBeNull();
    });
  });
});
