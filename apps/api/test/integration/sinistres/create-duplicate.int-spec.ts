import { NestFastifyApplication } from '@nestjs/platform-fastify';
import {
  RisqueCatnat,
  toIsoDate,
  type SinistreConflict,
  type SinistreDetail,
} from '@mon-sinistre/contracts';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { PrismaService } from 'src/prisma/prisma.service';
import { seedStepTemplates } from 'src/step-templates/step-template.seed';
import { createIntTestApp } from 'test/helpers/app';
import { commune } from 'test/helpers/commune';
import { createUser, headersForEmail, withBearer } from 'test/helpers/session';

const EVENT_DATE = toIsoDate('2026-06-01');
const OTHER_DATE = toIsoDate('2026-07-15');

type Headers = ReturnType<typeof withBearer>;

// POST /sinistres recognising a dossier the caller already has:
// docs/plan/dossier-preliminaire.md, Фаза 3 (issue #255);
// docs/research/dossier-preliminaire.md, «Создание с защитой от двойника».
describe('POST /sinistres duplicate protection (integration)', () => {
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
    await prisma.commune.createMany({
      data: [
        commune('30189', 'Nîmes', '30', 'Gard'),
        commune('34172', 'Montpellier', '34', 'Hérault'),
      ],
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
  });

  /** Minted, not logged in — same reason as `sinistres.int-spec.ts`. */
  async function bearer(): Promise<Headers> {
    return headersForEmail(app, prisma, await createUser(prisma));
  }

  const post = (headers: Headers, payload: Record<string, unknown>) =>
    app.inject({ method: 'POST', url: '/sinistres', headers, payload });

  const dossier = (overrides: Record<string, unknown> = {}) => ({
    codeInsee: '30189',
    risque: RisqueCatnat.INONDATION,
    eventDate: EVENT_DATE,
    ...overrides,
  });

  /** The dossier every case below already has before its own request. */
  async function existingDossier(headers: Headers): Promise<SinistreDetail> {
    const res = await post(headers, dossier());
    expect(res.statusCode).toBe(201);
    return JSON.parse(res.payload) as SinistreDetail;
  }

  it('answers 200 with the dossier itself when all three parameters repeat', async () => {
    const headers = await bearer();
    const first = await existingDossier(headers);

    const res = await post(headers, dossier());

    expect(res.statusCode).toBe(200);
    expect((JSON.parse(res.payload) as SinistreDetail).id).toBe(first.id);
    expect(await prisma.sinistre.count()).toBe(1);
  });

  it('answers 409 naming the existing dossier when only the date differs', async () => {
    const headers = await bearer();
    const first = await existingDossier(headers);

    const res = await post(headers, dossier({ eventDate: OTHER_DATE }));

    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.payload)).toEqual({
      code: 'DOSSIER_EXISTANT',
      existing: { id: first.id, eventDate: EVENT_DATE },
    } satisfies SinistreConflict);
    expect(await prisma.sinistre.count()).toBe(1);
  });

  it('creates the second dossier of the same commune and risk once confirmNew answers the conflict', async () => {
    const headers = await bearer();
    const first = await existingDossier(headers);

    const res = await post(
      headers,
      dossier({ eventDate: OTHER_DATE, confirmNew: true }),
    );

    expect(res.statusCode).toBe(201);
    expect((JSON.parse(res.payload) as SinistreDetail).id).not.toBe(first.id);
    expect(await prisma.sinistre.count()).toBe(2);
  });

  it('asks nothing for another risk of the same commune', async () => {
    const headers = await bearer();
    await existingDossier(headers);

    const res = await post(
      headers,
      dossier({ risque: RisqueCatnat.SECHERESSE, eventDate: OTHER_DATE }),
    );

    expect(res.statusCode).toBe(201);
    expect(await prisma.sinistre.count()).toBe(2);
  });

  it('asks nothing for the same risk in another commune', async () => {
    const headers = await bearer();
    await existingDossier(headers);

    const res = await post(headers, dossier({ codeInsee: '34172' }));

    expect(res.statusCode).toBe(201);
    expect(await prisma.sinistre.count()).toBe(2);
  });

  it("ignores someone else's dossier with the very same three parameters", async () => {
    await existingDossier(await bearer());

    const res = await post(await bearer(), dossier());

    expect(res.statusCode).toBe(201);
    expect(await prisma.sinistre.count()).toBe(2);
  });

  it('rejects a confirmNew that is not a boolean', async () => {
    const res = await post(await bearer(), dossier({ confirmNew: 'oui' }));

    expect(res.statusCode).toBe(400);
    expect(await prisma.sinistre.count()).toBe(0);
  });
});
