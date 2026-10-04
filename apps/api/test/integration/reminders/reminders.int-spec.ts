import {
  REMINDER_UNSUBSCRIBE_PATH,
  RisqueCatnat,
  SINISTRE_PATH,
} from '@mon-sinistre/contracts';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashSecureToken } from 'src/common/security/secure-token';
import { todayInParis } from 'src/common/time/today-in-paris';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { daysBetween } from 'src/sinistres/step-status';
import {
  STEP_TEMPLATE_SEED,
  seedStepTemplates,
} from 'src/step-templates/step-template.seed';
import { createIntTestApp } from 'test/helpers/app';
import { commune } from 'test/helpers/commune';
import { captureLogs } from 'test/helpers/mail-log';
import { mailLinksOf, tokenFrom } from 'test/helpers/mail-links';
import { RecordingTransport } from 'test/helpers/mail-transport';
import { createUser, headersForEmail } from 'test/helpers/session';

/** 07:00 in Paris on the day the dossiers below are opened: the first pass
 * after their creation, the one the phase's «Когда готова» describes. */
const NOW = new Date('2026-10-04T05:00:00Z');
const TODAY = todayInParis(NOW);

/** The `DATE_SINISTRE` steps of the CATNAT plan, every one of them inside the
 * widest scale threshold on the day of the event — so the first pass has a
 * reason for each, and the count below is the seed's, not a number of ours. */
const DATED_ON_DAY_ONE = STEP_TEMPLATE_SEED.filter(
  (step) => step.anchor === 'DATE_SINISTRE',
);

const RISQUE_LABEL = fr.sinistres.risques[RisqueCatnat.INONDATION];

const sinistreLinksOf = (contents: string): string[] =>
  [...mailLinksOf(contents)]
    .filter((link) => link.includes(SINISTRE_PATH))
    .sort();

// docs/plan/sinistre-reminders.md, Фаза 1 (issue #207) — the daily pass:
// one mail per person, idempotent within the day, every fact recorded.
describe('RemindersService.run (integration)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let reminders: RemindersService;
  let transport: RecordingTransport;
  const logs = captureLogs();

  beforeAll(async () => {
    transport = new RecordingTransport();
    app = await createIntTestApp({
      customize: (builder) =>
        builder.overrideProvider(MAIL_TRANSPORT).useValue(transport),
    });
    prisma = app.get(PrismaService);
    reminders = app.get(RemindersService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "DeadlineRule", "StepTemplate", "Sinistre", "Arrete" CASCADE`;
    await prisma.commune.create({
      data: commune('30189', 'Nîmes', '30', 'Gard'),
    });
    await prisma.commune.create({
      data: commune('13004', 'Arles', '13', 'Bouches-du-Rhône'),
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
    transport.sent.length = 0;
  });

  /** Two dossiers of one person, both opened on the day of the event — the
   * scenario of the phase: «un seul courriel pour les deux dossiers». */
  async function createTwoSinistres(): Promise<{
    email: string;
    ids: string[];
  }> {
    const email = await createUser(prisma);
    const headers = await headersForEmail(app, prisma, email);
    const ids: string[] = [];
    for (const codeInsee of ['30189', '13004']) {
      const res = await app.inject({
        method: 'POST',
        url: '/sinistres',
        headers,
        payload: {
          codeInsee,
          risque: RisqueCatnat.INONDATION,
          eventDate: TODAY,
        },
      });
      ids.push((JSON.parse(res.payload) as { id: string }).id);
    }
    return { email, ids };
  }

  it('sends one mail naming both dossiers of the same person', async () => {
    const { email } = await createTwoSinistres();

    await reminders.run({ now: NOW });

    expect(transport.sent).toHaveLength(1);
    const [message] = transport.sent;
    expect(message?.to).toBe(email);
    expect(message?.text).toContain(
      fr.mail.reminders.sinistreIntro(
        'Nîmes (Gard)',
        RISQUE_LABEL,
        '04/10/2026',
      ),
    );
    expect(message?.text).toContain(
      fr.mail.reminders.sinistreIntro(
        'Arles (Bouches-du-Rhône)',
        RISQUE_LABEL,
        '04/10/2026',
      ),
    );
  });

  it('links to both dossiers, by the same addresses in text and in HTML', async () => {
    const { ids } = await createTwoSinistres();

    await reminders.run({ now: NOW });

    const [message] = transport.sent;
    const links = sinistreLinksOf(message?.text ?? '');
    expect(links).toHaveLength(ids.length);
    for (const id of ids) {
      expect(
        links.some((link) => link.endsWith(`${SINISTRE_PATH}/${id}`)),
      ).toBe(true);
    }
    expect(sinistreLinksOf(message?.html ?? '')).toEqual(links);
  });

  it('sends nothing on a second pass of the same day', async () => {
    await createTwoSinistres();

    await reminders.run({ now: NOW });
    await reminders.run({ now: NOW });

    expect(transport.sent).toHaveLength(1);
  });

  it('records every reason with the days actually left and the day it was sent', async () => {
    await createTwoSinistres();

    await reminders.run({ now: NOW });

    const rows = await prisma.reminderLog.findMany();
    expect(rows).toHaveLength(DATED_ON_DAY_ONE.length * 2);
    for (const row of rows) {
      expect(row.kind).toBe('SCALE');
      expect(dateToIsoDate(row.sentOn)).toBe(TODAY);
      expect(row.offsetDays).toBe(
        daysBetween(TODAY, dateToIsoDate(row.plannedDate)),
      );
    }
  });

  it('stores the hash of the very token the mail links to', async () => {
    const { email } = await createTwoSinistres();

    await reminders.run({ now: NOW });

    const [message] = transport.sent;
    const token = tokenFrom(message ?? { text: '' }, REMINDER_UNSUBSCRIBE_PATH);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.reminderUnsubscribeTokenHash).toBe(hashSecureToken(token));
  });

  it('logs the pass without the address and without a step name (ТЗ § 7)', async () => {
    const { email } = await createTwoSinistres();

    await reminders.run({ now: NOW });

    expect(logs.levels()).not.toContain('error');
    logs.expectNoTraceOf(email, DATED_ON_DAY_ONE[0]?.name ?? '');
  });
});
