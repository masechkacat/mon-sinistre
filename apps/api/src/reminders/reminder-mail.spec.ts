import {
  REFERENCE_DATA_STALE_AFTER_MONTHS,
  REMINDER_UNSUBSCRIBE_PATH,
  SINISTRE_PATH,
  toIsoDate,
  type IsoDate,
} from '@mon-sinistre/contracts';
import { DECLARATION_ASSUREUR_CODE } from 'src/deadline-rules/deadline-rule.seed';
import { resolveDeadline } from 'src/deadline-rules/resolve-deadline';
import { fr } from 'src/i18n/fr';
import { MailComposer } from 'src/mail/compose/mail-composer';
import { mailLinksOf } from 'test/helpers/mail-links';
import {
  reminderMailFor,
  type ReminderSinistreForMail,
  type ReminderStepForMail,
} from './reminder-mail';

const FRONTEND_URL = 'https://app.example.test';
const MAIL_FROM = 'no-reply@example.test';
const RECIPIENT = 'destinataire@example.test';
const TOKEN = 'jeton-de-desinscription';

const TODAY = toIsoDate('2026-10-04');
const inDays = (days: number): IsoDate => resolveDeadline(TODAY, days, 'DAYS');

const ARTICLE_URL =
  'https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006792617/';

const strings = fr.mail.reminders;

const photoStep: ReminderStepForMail = {
  name: 'Photographier les dégâts',
  plannedDate: inDays(3),
  remainingDays: 3,
  deadlineRuleCode: null,
  source: null,
};

const declarationStep: ReminderStepForMail = {
  name: 'Déclarer le sinistre à votre assurance',
  plannedDate: inDays(7),
  remainingDays: 7,
  deadlineRuleCode: DECLARATION_ASSUREUR_CODE,
  source: { url: ARTICLE_URL, verifiedAt: toIsoDate('2026-08-18') },
};

const nimes: ReminderSinistreForMail = {
  id: 'sinistre-nimes',
  commune: { name: 'Nîmes', departementName: 'Gard' },
  risque: 'Inondations et coulées de boue',
  eventDate: toIsoDate('2026-09-12'),
  steps: [photoStep, declarationStep],
};

const arles: ReminderSinistreForMail = {
  id: 'sinistre-arles',
  commune: { name: 'Arles', departementName: 'Bouches-du-Rhône' },
  risque: 'Sécheresse',
  eventDate: toIsoDate('2026-07-01'),
  steps: [{ ...photoStep, name: 'Lister les biens endommagés' }],
};

const mailFor = (
  sinistres: readonly ReminderSinistreForMail[],
  today: IsoDate = TODAY,
) =>
  new MailComposer({ baseUrl: FRONTEND_URL, senderEmail: MAIL_FROM }).compose(
    reminderMailFor(RECIPIENT, TOKEN, today, sinistres),
  );

describe('reminder mail (fr.mail.reminders)', () => {
  it('opens a block for every sinistre — commune, risque and event date', () => {
    const message = mailFor([nimes, arles]);

    expect(message.text).toContain(
      strings.sinistreIntro('Nîmes (Gard)', nimes.risque, '12/09/2026'),
    );
    expect(message.text).toContain(
      strings.sinistreIntro(
        'Arles (Bouches-du-Rhône)',
        arles.risque,
        '01/07/2026',
      ),
    );
  });

  it('lists every step with its date and the days left', () => {
    const message = mailFor([nimes, arles]);

    expect(message.text).toContain(
      strings.stepLine(photoStep.name, '07/10/2026', strings.inDays('3')),
    );
    expect(message.text).toContain(
      strings.stepLine(
        'Lister les biens endommagés',
        '07/10/2026',
        strings.inDays('3'),
      ),
    );
  });

  it('says "dernier jour" for a step due today', () => {
    const message = mailFor([
      {
        ...arles,
        steps: [{ ...photoStep, plannedDate: TODAY, remainingDays: 0 }],
      },
    ]);

    expect(message.text).toContain(
      strings.stepLine(photoStep.name, '04/10/2026', strings.lastDay),
    );
  });

  it('links to the screen of each sinistre', () => {
    const links = mailLinksOf(mailFor([nimes, arles]).text);

    expect(links).toContain(`${FRONTEND_URL}${SINISTRE_PATH}/${nimes.id}`);
    expect(links).toContain(`${FRONTEND_URL}${SINISTRE_PATH}/${arles.id}`);
  });

  it('gives the déclaration deadline its own paragraph, days left spelled out', () => {
    const message = mailFor([nimes]);

    expect(message.text).toContain(
      strings.declaration.remaining('7', '11/10/2026'),
    );
    // The step is named by that paragraph, not twice — no list line for it.
    expect(message.text).not.toContain(declarationStep.name);
  });

  it('names the last day of the déclaration deadline when it is today', () => {
    const message = mailFor([
      {
        ...nimes,
        steps: [{ ...declarationStep, plannedDate: TODAY, remainingDays: 0 }],
      },
    ]);

    expect(message.text).toContain(
      strings.declaration.remaining('0', '04/10/2026'),
    );
  });

  it('carries the source of the deadline, off-site, with the date it was checked', () => {
    const message = mailFor([nimes]);

    expect(mailLinksOf(message.text)).toContain(ARTICLE_URL);
    expect(message.text).toContain(
      strings.declaration.verifiedAt('18/08/2026'),
    );
    expect(message.text).not.toContain(
      strings.declaration.outdated(String(REFERENCE_DATA_STALE_AFTER_MONTHS)),
    );
  });

  it('warns when the deadline rule has not been checked for too long', () => {
    const stale = resolveDeadline(
      TODAY,
      -REFERENCE_DATA_STALE_AFTER_MONTHS - 1,
      'MONTHS',
    );
    const message = mailFor([
      {
        ...nimes,
        steps: [
          {
            ...declarationStep,
            source: { url: ARTICLE_URL, verifiedAt: stale },
          },
        ],
      },
    ]);

    expect(message.text).toContain(
      strings.declaration.outdated(String(REFERENCE_DATA_STALE_AFTER_MONTHS)),
    );
  });

  it('unsubscribes through the reminder handler, with the token of this mail', () => {
    const message = mailFor([nimes]);

    const unsubscribeUrl = `${FRONTEND_URL}${REMINDER_UNSUBSCRIBE_PATH}?token=${TOKEN}`;
    expect(mailLinksOf(message.text)).toContain(unsubscribeUrl);
    expect(message.headers['List-Unsubscribe']).toBe(`<${unsubscribeUrl}>`);
  });

  it('puts the déclaration deadline in the subject, and only then', () => {
    expect(mailFor([nimes]).subject).toBe(strings.subject.declaration('7'));
    expect(mailFor([arles]).subject).toBe(strings.subject.nextSteps);
  });

  it('counts the most urgent déclaration deadline in the subject', () => {
    const urgent: ReminderSinistreForMail = {
      ...arles,
      steps: [{ ...declarationStep, plannedDate: inDays(1), remainingDays: 1 }],
    };

    expect(mailFor([nimes, urgent]).subject).toBe(
      strings.subject.declaration('1'),
    );
  });

  it('keeps the subject above the 10-character floor of the provider', () => {
    expect(mailFor([arles]).subject.trim().length).toBeGreaterThan(10);
  });
});
