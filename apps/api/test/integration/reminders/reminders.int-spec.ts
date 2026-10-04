import {
  REMINDER_UNSUBSCRIBE_PATH,
  RisqueCatnat,
  SINISTRE_PATH,
} from '@mon-sinistre/contracts';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashSecureToken } from 'src/common/security/secure-token';
import { DAY_MS } from 'src/common/time/time';
import { todayInParis } from 'src/common/time/today-in-paris';
import { seedDeadlineRules } from 'src/deadline-rules/deadline-rule.seed';
import { dateToIsoDate } from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { NOTIFICATION_ATTEMPTS_BEFORE_ALERT } from 'src/jorf/mail/drain-outbox';
import { MAIL_TRANSPORT } from 'src/mail/mail-transport';
import { PrismaService } from 'src/prisma/prisma.service';
import { RemindersService } from 'src/reminders/reminders.service';
import { daysBetween } from 'src/sinistres/step-status';
import {
  STEP_TEMPLATE_SEED,
  seedStepTemplates,
} from 'src/step-templates/step-template.seed';
import { withAdminEmail } from 'test/helpers/admin-email';
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

/** 07:00 in Paris `days` days after {@link NOW} — one more daily pass. */
const passAt = (days: number): Date => new Date(NOW.getTime() + days * DAY_MS);

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
  // The failure describe below needs the admin alert to have somewhere to go.
  const ADMIN_EMAIL = withAdminEmail();

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
    await prisma.$executeRaw`TRUNCATE TABLE "User", "Commune", "DeadlineRule", "StepTemplate", "Sinistre", "Arrete", "MonitorAlert" CASCADE`;
    await prisma.commune.create({
      data: commune('30189', 'Nîmes', '30', 'Gard'),
    });
    await prisma.commune.create({
      data: commune('13004', 'Arles', '13', 'Bouches-du-Rhône'),
    });
    await seedDeadlineRules(prisma);
    await seedStepTemplates(prisma);
    transport.sent.length = 0;
    transport.failFor.clear();
  });

  /** A dossier opened on the day of the event, so every `DATE_SINISTRE` step
   * of the plan is inside its scale on the pass of {@link NOW}. */
  async function openSinistre(
    headers: Awaited<ReturnType<typeof headersForEmail>>,
    codeInsee: string,
  ): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/sinistres',
      headers,
      payload: { codeInsee, risque: RisqueCatnat.INONDATION, eventDate: TODAY },
    });
    return (JSON.parse(res.payload) as { id: string }).id;
  }

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
      ids.push(await openSinistre(headers, codeInsee));
    }
    return { email, ids };
  }

  /** One person with one dossier; returns the address the pass will mail. */
  async function createSinistreOwner(codeInsee: string): Promise<string> {
    const email = await createUser(prisma);
    await openSinistre(await headersForEmail(app, prisma, email), codeInsee);
    return email;
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

  // docs/plan/sinistre-reminders.md, Фаза 2 (issue #211) — ТЗ § 6.
  describe('a transport failing on one address', () => {
    const sentTo = (to: string) =>
      transport.sent.filter((message) => message.to === to);

    const stuckAlerts = () =>
      prisma.monitorAlert.findMany({ where: { kind: 'NOTIFICATION_STUCK' } });

    /** Two people, each with a dossier; the transport refuses the first. */
    async function twoOwnersOneRefused(): Promise<{
      refused: string;
      served: string;
    }> {
      const refused = await createSinistreOwner('30189');
      const served = await createSinistreOwner('13004');
      transport.failFor.add(refused);
      return { refused, served };
    }

    it('delivers to the other recipient of the same pass', async () => {
      const { refused, served } = await twoOwnersOneRefused();

      await reminders.run({ now: NOW });

      expect(sentTo(served)).toHaveLength(1);
      expect(sentTo(refused)).toHaveLength(0);
    });

    it('records nothing for the refused recipient and counts the failure', async () => {
      const { refused } = await twoOwnersOneRefused();

      await reminders.run({ now: NOW });

      expect(
        await prisma.reminderLog.count({
          where: { step: { sinistre: { user: { email: refused } } } },
        }),
      ).toBe(0);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { email: refused } }))
          .reminderFailures,
      ).toBe(1);
    });

    it('mails the refused recipient on the next pass, and forgets the failure', async () => {
      const { refused } = await twoOwnersOneRefused();
      await reminders.run({ now: NOW });

      transport.failFor.clear();
      await reminders.run({ now: passAt(1) });

      expect(sentTo(refused)).toHaveLength(1);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { email: refused } }))
          .reminderFailures,
      ).toBe(0);
    });

    it('raises one alert and one admin email at the threshold, and nothing after it', async () => {
      await twoOwnersOneRefused();

      for (let pass = 0; pass < NOTIFICATION_ATTEMPTS_BEFORE_ALERT; pass++) {
        await reminders.run({ now: passAt(pass) });
      }

      const alerts = await stuckAlerts();
      expect(alerts).toHaveLength(1);
      expect(alerts[0]?.arreteId).toBeNull();
      expect(alerts[0]?.detail).not.toContain('@');
      expect(sentTo(ADMIN_EMAIL)).toHaveLength(1);

      await reminders.run({ now: passAt(NOTIFICATION_ATTEMPTS_BEFORE_ALERT) });

      expect(await stuckAlerts()).toHaveLength(1);
      expect(sentTo(ADMIN_EMAIL)).toHaveLength(1);
    });

    it('logs the failure without the address (ТЗ § 7)', async () => {
      const { refused } = await twoOwnersOneRefused();

      await reminders.run({ now: NOW });

      expect(logs.levels()).toContain('error');
      logs.expectNoTraceOf(refused);
    });
  });
});
