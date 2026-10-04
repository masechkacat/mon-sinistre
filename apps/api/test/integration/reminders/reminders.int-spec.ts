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
import { AdminAlertService } from 'src/jorf/alerts/admin-alert.service';
import { JorfMonitorService } from 'src/jorf/jorf-monitor.service';
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
import { arreteData, arreteEntryData } from 'test/helpers/arrete';
import { commune } from 'test/helpers/commune';
import { captureLogs } from 'test/helpers/mail-log';
import { mailLinksOf, tokenFrom } from 'test/helpers/mail-links';
import { RecordingTransport } from 'test/helpers/mail-transport';
import { createUser, headersForEmail, withBearer } from 'test/helpers/session';

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

/** The unsubscribe token a reminder mail carried — the only place its
 * plaintext ever exists. */
const unsubscribeTokenOf = (message?: { text: string }): string =>
  tokenFrom(message ?? { text: '' }, REMINDER_UNSUBSCRIBE_PATH);

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

  const sentTo = (to: string) =>
    transport.sent.filter((message) => message.to === to);

  const disabledAtOf = async (email: string): Promise<Date | null> =>
    (await prisma.user.findUniqueOrThrow({ where: { email } }))
      .remindersDisabledAt;

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

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.reminderUnsubscribeTokenHash).toBe(
      hashSecureToken(unsubscribeTokenOf(transport.sent[0])),
    );
  });

  it('logs the pass without the address and without a step name (ТЗ § 7)', async () => {
    const { email } = await createTwoSinistres();

    await reminders.run({ now: NOW });

    expect(logs.levels()).not.toContain('error');
    logs.expectNoTraceOf(email, DATED_ON_DAY_ONE[0]?.name ?? '');
  });

  // docs/plan/sinistre-reminders.md, Фаза 2 (issue #211) — ТЗ § 6.
  describe('a transport failing on one address', () => {
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

    it('does not count a delivered mail as failed when its record cannot be written', async () => {
      const email = await createSinistreOwner('30189');
      jest
        .spyOn(prisma, '$transaction')
        .mockRejectedValueOnce(new Error('database timeout'));

      await reminders.run({ now: NOW });

      expect(sentTo(email)).toHaveLength(1);
      expect(
        (await prisma.user.findUniqueOrThrow({ where: { email } }))
          .reminderFailures,
      ).toBe(0);
    });

    it('finishes the pass when the stuck alert itself cannot be raised', async () => {
      const { refused, served } = await twoOwnersOneRefused();
      await prisma.user.update({
        where: { email: refused },
        data: { reminderFailures: NOTIFICATION_ATTEMPTS_BEFORE_ALERT - 1 },
      });
      jest
        .spyOn(app.get(AdminAlertService), 'raise')
        .mockRejectedValueOnce(new Error('database timeout'));

      await reminders.run({ now: NOW });

      expect(sentTo(served)).toHaveLength(1);
      expect(logs.text()).toContain('run done');
    });

    it('logs the failure without the address (ТЗ § 7)', async () => {
      const { refused } = await twoOwnersOneRefused();

      await reminders.run({ now: NOW });

      expect(logs.levels()).toContain('error');
      logs.expectNoTraceOf(refused);
    });
  });

  // docs/plan/sinistre-reminders.md, Фаза 3 (issue #213) — выключатель по
  // токену из письма.
  describe('POST /rappels/desinscription', () => {
    const unsubscribe = (token: string) =>
      app.inject({
        method: 'POST',
        url: '/rappels/desinscription',
        payload: { token },
      });

    /** One person mailed by a first pass, and the token that mail carried. */
    async function mailedOwner(): Promise<{ email: string; token: string }> {
      const email = await createSinistreOwner('30189');
      await reminders.run({ now: NOW });
      return { email, token: unsubscribeTokenOf(transport.sent[0]) };
    }

    it('switches the reminders off for the account the token belongs to', async () => {
      const { email, token } = await mailedOwner();

      const res = await unsubscribe(token);

      expect(res.statusCode).toBe(204);
      expect(res.payload).toBe('');
      expect(await disabledAtOf(email)).not.toBeNull();
    });

    it('answers 204 and changes nothing on an unknown token', async () => {
      const { email } = await mailedOwner();

      const res = await unsubscribe('jeton-inconnu');

      expect(res.statusCode).toBe(204);
      expect(res.payload).toBe('');
      expect(await disabledAtOf(email)).toBeNull();
    });

    it('answers 204 and changes nothing on a token the next mail rotated away', async () => {
      const { email, token } = await mailedOwner();
      await reminders.run({ now: passAt(1) });

      const res = await unsubscribe(token);

      expect(res.statusCode).toBe(204);
      expect(await disabledAtOf(email)).toBeNull();
    });

    it('is no session: the same token as a Bearer answers 401 without the address', async () => {
      const { email, token } = await mailedOwner();

      const res = await app.inject({
        method: 'GET',
        url: '/auth/me',
        headers: withBearer(token),
      });

      expect(res.statusCode).toBe(401);
      expect(res.payload).not.toContain(email);
    });

    it('leaves the next pass with nothing to send to that person', async () => {
      const { token } = await mailedOwner();
      await unsubscribe(token);
      transport.sent.length = 0;

      await reminders.run({ now: passAt(1) });

      expect(transport.sent).toHaveLength(0);
    });

    it('does not silence the arrêté letter of the same person (ТЗ § 6)', async () => {
      const email = await createSinistreOwner('30189');
      const sinistre = await prisma.sinistre.findFirstOrThrow();
      const arrete = await prisma.arrete.create({
        data: {
          ...arreteData(),
          entries: { create: arreteEntryData('30189') },
        },
        include: { entries: { select: { id: true } } },
      });
      await prisma.sinistre.update({
        where: { id: sinistre.id },
        data: { arreteEntryId: arrete.entries[0]?.id },
      });
      await prisma.sinistreNotification.create({
        data: {
          sinistreId: sinistre.id,
          arreteId: arrete.id,
          kind: 'PUBLICATION',
        },
      });
      await prisma.user.updateMany({
        where: { email },
        data: { remindersDisabledAt: new Date() },
      });

      // No delta to ingest: the pass is there for the pending outbox row only.
      await app.get(JorfMonitorService).run({ deltaNames: [] });

      expect(
        transport.sent.filter((message) => message.to === email),
      ).toHaveLength(1);
    });

    it('cancels the mail of a pass the unsubscribe lands in the middle of', async () => {
      const email = await createSinistreOwner('30189');
      // The window the rotation guards: the candidate query has read the step,
      // the mail is not out yet, and the person switches the reminders off.
      const original = prisma.step.findMany.bind(prisma.step);
      (
        jest.spyOn(prisma.step, 'findMany') as jest.SpyInstance
      ).mockImplementation(async (...args: unknown[]) => {
        const rows: unknown = await original(
          ...(args as Parameters<typeof original>),
        );
        await prisma.user.updateMany({
          where: { email },
          data: { remindersDisabledAt: new Date() },
        });
        return rows;
      });

      await reminders.run({ now: NOW });

      expect(transport.sent).toHaveLength(0);
      expect(await prisma.reminderLog.count()).toBe(0);
    });
  });

  // docs/plan/sinistre-reminders.md, Фаза 3 (issue #214).
  describe('PATCH /rappels', () => {
    const setPreference = (
      headers: ReturnType<typeof withBearer>,
      enabled: boolean,
    ) =>
      app.inject({
        method: 'PATCH',
        url: '/rappels',
        headers,
        payload: { enabled },
      });

    const ownerSession = async (
      codeInsee: string,
    ): Promise<{ email: string; headers: ReturnType<typeof withBearer> }> => {
      const email = await createSinistreOwner(codeInsee);
      return { email, headers: await headersForEmail(app, prisma, email) };
    };

    it('switches the reminders off, and the next pass has nothing to send', async () => {
      const { email, headers } = await ownerSession('30189');

      const res = await setPreference(headers, false);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ enabled: false });
      expect(await disabledAtOf(email)).not.toBeNull();

      await reminders.run({ now: NOW });

      expect(sentTo(email)).toHaveLength(0);
    });

    it('switches them back on, and the next pass mails again', async () => {
      const { email, headers } = await ownerSession('30189');
      await setPreference(headers, false);

      const res = await setPreference(headers, true);

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.payload)).toEqual({ enabled: true });
      expect(await disabledAtOf(email)).toBeNull();

      await reminders.run({ now: NOW });

      expect(sentTo(email)).toHaveLength(1);
    });

    it('answers 401 without a Bearer, and changes nothing', async () => {
      const { email } = await ownerSession('30189');

      const res = await setPreference(withBearer(), false);

      expect(res.statusCode).toBe(401);
      expect(await disabledAtOf(email)).toBeNull();
    });

    it('leaves the other accounts subscribed', async () => {
      const { headers } = await ownerSession('30189');
      const other = await createSinistreOwner('13004');

      await setPreference(headers, false);

      expect(await disabledAtOf(other)).toBeNull();

      await reminders.run({ now: NOW });

      expect(sentTo(other)).toHaveLength(1);
    });
  });
});
