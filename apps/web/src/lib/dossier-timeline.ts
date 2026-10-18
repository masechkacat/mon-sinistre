import {
  SinistreStatus,
  StepAnchor,
  type DossierApercu,
  type SinistreDetail,
} from '@mon-sinistre/contracts';
import { formatDateShortFr } from '@/i18n/date';
import { fr } from '@/i18n/fr';

/** A dossier as either screen holds it: a saved sinistre, or an aperçu of one. */
export type Dossier = SinistreDetail | DossierApercu;

export interface TimelinePoint {
  label: string;
  /** The date of the moment, or the word standing for the date it has not. */
  value: string;
  /** The moment has happened. */
  past: boolean;
  /** The nearest moment still ahead; one point at most carries it. */
  current: boolean;
}

type Moment = Omit<TimelinePoint, 'current'>;

const copy = fr.sinistres.detail.timeline;

/** The four moments of a dossier head, in the order they happen. */
export function timelinePoints(dossier: Dossier): TimelinePoint[] {
  const current = (moments: Moment[]): TimelinePoint[] => {
    const nextIndex = moments.findIndex((moment) => !moment.past);
    return moments.map((moment, index) => ({
      ...moment,
      current: index === nextIndex,
    }));
  };

  return current([
    {
      label: copy.event,
      value: formatDateShortFr(dossier.eventDate),
      past: true,
    },
    arreteMoment(dossier),
    declarationMoment(dossier),
    {
      label: copy.indemnisation,
      // By the anchor, never by the name: step names come from the template,
      // which is data. One rule for both screens: an aperçu has nothing
      // declared, so the step anchored here has no date and says « à venir ».
      value: plannedDateOf(
        dossier,
        StepAnchor.DATE_ETAT_ESTIMATIF_OU_EXPERTISE,
      ),
      // Nothing a dossier carries says the money has arrived.
      past: false,
    },
  ]);
}

function arreteMoment(dossier: Dossier): Moment {
  const arrete = 'arrete' in dossier ? dossier.arrete : null;
  const past =
    arrete !== null ||
    ('arreteEntryId' in dossier && dossier.arreteEntryId !== null);
  const label = copy.arrete;

  // A refusal is where the dossier stands, not a moment behind it: nothing is
  // declared after one, so the road stops at this point.
  if (dossier.status === SinistreStatus.ARRETE_REFUSE) {
    return { label, value: copy.refused, past: false };
  }
  // An aperçu carries the day of publication; a saved sinistre carries only
  // the id of its entry, so its screen says the state in a word instead.
  if (arrete) {
    return { label, value: formatDateShortFr(arrete.publishedAt), past };
  }
  return { label, value: past ? copy.published : copy.expected, past };
}

function declarationMoment(dossier: Dossier): Moment {
  const declaredOn =
    'declarationDate' in dossier ? dossier.declarationDate : null;
  const label = copy.declaration;

  if (declaredOn) {
    return { label, value: formatDateShortFr(declaredOn), past: true };
  }
  const deadline = dossier.declarationDeadline;
  return {
    label,
    value: deadline
      ? copy.before(formatDateShortFr(deadline.date))
      : copy.upcoming,
    past: false,
  };
}

function plannedDateOf(dossier: Dossier, anchor: StepAnchor): string {
  const planned = dossier.steps.find(
    (step) => step.anchor === anchor,
  )?.plannedDate;
  return planned ? formatDateShortFr(planned) : copy.upcoming;
}
