import { expect, test } from '@playwright/test';
import { SinistreStatus, StepAnchor, toIsoDate } from '@mon-sinistre/contracts';
import { formatDateShortFr } from '../../src/i18n/date';
import { fr } from '../../src/i18n/fr';
import { timelinePoints, type Dossier } from '../../src/lib/dossier-timeline';
import { ARRETE, DEADLINE, apercuFixture } from '../support/dossier';
import { sinistreDetailFixture, stepFixture } from '../support/sinistres';

const copy = fr.sinistres.detail.timeline;

const values = (dossier: Dossier) =>
  timelinePoints(dossier).map((point) => point.value);

/** An entry id is all a saved sinistre carries of its arrêté. */
const ENTRY_ID = 'entry-inondation';

test('a dossier with neither arrêté nor declaration says in words what has no date', () => {
  const expected = sinistreDetailFixture({ declarationDeadline: DEADLINE });

  expect(values(expected)).toEqual([
    formatDateShortFr(expected.eventDate),
    copy.expected,
    copy.before(formatDateShortFr(DEADLINE.date)),
    copy.upcoming,
  ]);
  // No arrêté means no deadline either: the declaration point then has
  // nothing but the word.
  expect(values(sinistreDetailFixture())[2]).toBe(copy.upcoming);
});

test('the date of the declaration takes the place of the deadline it was made before', () => {
  const declaredOn = toIsoDate('2026-10-05');
  const points = timelinePoints(
    sinistreDetailFixture({
      status: SinistreStatus.DECLARE,
      arreteEntryId: ENTRY_ID,
      declarationDate: declaredOn,
      declarationDeadline: DEADLINE,
    }),
  );

  expect(points[2].value).toBe(formatDateShortFr(declaredOn));
  expect(points[2].past).toBe(true);
  // What is current is the nearest moment still ahead, not the one settled.
  expect(points.filter((point) => point.current)).toEqual([points[3]]);
});

test('the indemnisation point takes the step of its anchor, whatever the steps are called', () => {
  const expertise = toIsoDate('2026-12-20');
  const points = timelinePoints(
    sinistreDetailFixture({
      steps: [
        stepFixture({
          id: 'step-nom',
          name: 'Indemnisation',
          anchor: StepAnchor.DATE_DECLARATION,
          plannedDate: toIsoDate('2026-11-01'),
        }),
        stepFixture({
          id: 'step-ancre',
          name: 'Relancer l’assureur',
          anchor: StepAnchor.DATE_ETAT_ESTIMATIF_OU_EXPERTISE,
          plannedDate: expertise,
        }),
      ],
    }),
  );

  expect(points[3].value).toBe(formatDateShortFr(expertise));
});

test('the arrêté point gives the publication date of an aperçu and the word alone of a sinistre', () => {
  const published = timelinePoints(
    apercuFixture({
      status: SinistreStatus.ARRETE_PUBLIE,
      arrete: ARRETE,
      declarationDeadline: DEADLINE,
    }),
  )[1];

  expect(published.value).toBe(formatDateShortFr(ARRETE.publishedAt));
  expect(published.past).toBe(true);

  // `GET /sinistres/:id` answers with the entry id, not the publication date:
  // the saved dossier says the state of the arrêté instead of inventing a day.
  const duSinistre = (status: SinistreStatus) =>
    timelinePoints(
      sinistreDetailFixture({ status, arreteEntryId: ENTRY_ID }),
    )[1];
  expect(duSinistre(SinistreStatus.ARRETE_PUBLIE).value).toBe(copy.published);

  // A refusal is where such a dossier stands: nothing is declared after one,
  // so the point stays current instead of handing over to the next.
  const refuse = duSinistre(SinistreStatus.ARRETE_REFUSE);
  expect(refuse.value).toBe(copy.refused);
  expect(refuse.current).toBe(true);
});
