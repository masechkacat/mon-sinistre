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

export interface ChronologiePoint {
  label: string;
  /** The date of the moment, or the word standing for the date it has not. */
  valeur: string;
  /** The moment has happened. */
  passe: boolean;
  /** The nearest moment still ahead; one point at most carries it. */
  courant: boolean;
}

type Moment = Omit<ChronologiePoint, 'courant'>;

const copy = fr.sinistres.detail.chronologie;

/** The four moments of a dossier head, in the order they happen. */
export function chronologiePoints(dossier: Dossier): ChronologiePoint[] {
  const courant = (moments: Moment[]): ChronologiePoint[] => {
    const prochain = moments.findIndex((moment) => !moment.passe);
    return moments.map((moment, index) => ({
      ...moment,
      courant: index === prochain,
    }));
  };

  return courant([
    {
      label: copy.evenement,
      valeur: formatDateShortFr(dossier.eventDate),
      passe: true,
    },
    momentArrete(dossier),
    momentDeclaration(dossier),
    {
      label: copy.indemnisation,
      // By the anchor, never by the name: step names come from the template,
      // which is data. One rule for both screens: an aperçu has nothing
      // declared, so the step anchored here has no date and says « à venir ».
      valeur: datePrevue(dossier, StepAnchor.DATE_ETAT_ESTIMATIF_OU_EXPERTISE),
      // Nothing a dossier carries says the money has arrived.
      passe: false,
    },
  ]);
}

function momentArrete(dossier: Dossier): Moment {
  const arrete = 'arrete' in dossier ? dossier.arrete : null;
  const passe =
    arrete !== null ||
    ('arreteEntryId' in dossier && dossier.arreteEntryId !== null);
  const label = copy.arrete;

  // A refusal is where the dossier stands, not a moment behind it: nothing is
  // declared after one, so the road stops at this point.
  if (dossier.status === SinistreStatus.ARRETE_REFUSE) {
    return { label, valeur: copy.refuse, passe: false };
  }
  // An aperçu carries the day of publication; a saved sinistre carries only
  // the id of its entry, so its screen says the state in a word instead.
  if (arrete) {
    return { label, valeur: formatDateShortFr(arrete.publishedAt), passe };
  }
  return { label, valeur: passe ? copy.publie : copy.attendu, passe };
}

function momentDeclaration(dossier: Dossier): Moment {
  const faiteLe = 'declarationDate' in dossier ? dossier.declarationDate : null;
  const label = copy.declaration;

  if (faiteLe) {
    return { label, valeur: formatDateShortFr(faiteLe), passe: true };
  }
  const deadline = dossier.declarationDeadline;
  return {
    label,
    valeur: deadline
      ? copy.avantLe(formatDateShortFr(deadline.date))
      : copy.aVenir,
    passe: false,
  };
}

function datePrevue(dossier: Dossier, anchor: StepAnchor): string {
  const prevue = dossier.steps.find(
    (step) => step.anchor === anchor,
  )?.plannedDate;
  return prevue ? formatDateShortFr(prevue) : copy.aVenir;
}
