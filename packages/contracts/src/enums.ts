/**
 * Shared enumerations.
 *
 * Values are stored in the database and sent over the wire, so they must stay
 * stable. Display labels live in the web client's locale files, never here:
 * this package carries no user-facing French text.
 */

/**
 * Lifecycle of a sinistre (insurance claim companion).
 *
 * `AVANT_ARRETE → (ARRETE_PUBLIE | ARRETE_REFUSE) → DECLARE → CLOS`, plus
 * `SANS_SUITE` from any state. A refused sinistre can move to
 * {@link SinistreStatus.ARRETE_PUBLIE} later: the mairie may file a repeat
 * demande and a subsequent arrêté (new NOR) can recognise the commune, in
 * which case the sinistre is re-linked to the recognising entry.
 * See specification § 4 and `docs/decisions.md`.
 */
export enum SinistreStatus {
  /** Created after the event but before any arrêté names the commune. */
  AVANT_ARRETE = 'AVANT_ARRETE',
  /** The linked arrêté entry is RECONNU; the declaration deadline is running. */
  ARRETE_PUBLIE = 'ARRETE_PUBLIE',
  /**
   * The linked arrêté entry is REFUSE. No declaration deadline runs; the plan
   * switches to the refusal steps (contesting is the mairie's move, not the
   * user's — ask about a repeat demande, keep all evidence, check non-CatNat
   * cover). The contestation window anchors to
   * {@link StepAnchor.DATE_PUBLICATION_ARRETE} via a deadline rule.
   */
  ARRETE_REFUSE = 'ARRETE_REFUSE',
  /** The user declared the damage to their insurer. */
  DECLARE = 'DECLARE',
  /** Closed by the user (indemnified or otherwise settled). */
  CLOS = 'CLOS',
  /** Abandoned by the user, excluded from reminders. */
  SANS_SUITE = 'SANS_SUITE',
}

/**
 * State of a step.
 *
 * Only {@link StepStatus.FAIT} and {@link StepStatus.NON_APPLICABLE} are
 * persisted; the remaining values are derived from the planned date at read
 * time. A step whose anchor date is not known yet has no planned date and no
 * derived status beyond {@link StepStatus.A_VENIR}. See specification § 4.
 */
export enum StepStatus {
  /** Planned date is more than {@link SOON_THRESHOLD_DAYS} days away, or unknown. */
  A_VENIR = 'A_VENIR',
  /** Planned date is within {@link SOON_THRESHOLD_DAYS} days. */
  A_FAIRE = 'A_FAIRE',
  /** Planned date has passed and the step is not done. */
  EN_RETARD = 'EN_RETARD',
  /** Marked as done by the user. */
  FAIT = 'FAIT',
  /** Marked as not relevant for this sinistre. */
  NON_APPLICABLE = 'NON_APPLICABLE',
}

/**
 * Reference point a step's planned date is computed from. Steps anchored to a
 * date that has not happened yet exist without a planned date and acquire one
 * when the anchor date becomes known. See specification § 4.
 */
export enum StepAnchor {
  /** Offset applies to the date the damage occurred. */
  DATE_SINISTRE = 'DATE_SINISTRE',
  /** Offset applies to the arrêté's publication date in the Journal Officiel. */
  DATE_PUBLICATION_ARRETE = 'DATE_PUBLICATION_ARRETE',
  /** Offset applies to the date the user declared the damage to their insurer. */
  DATE_DECLARATION = 'DATE_DECLARATION',
}

/**
 * Outcome of one commune line in an arrêté annex.
 * Annexe I lists recognised communes, annexe II refusals. See specification § 2.
 */
export enum ArreteEntryOutcome {
  RECONNU = 'RECONNU',
  REFUSE = 'REFUSE',
}

/**
 * Kind of file attached to an inventory item.
 * See specification § 4.
 */
export enum FileKind {
  PHOTO = 'PHOTO',
  /** Receipt, invoice or any proof of value. */
  JUSTIFICATIF = 'JUSTIFICATIF',
}

/** Days before the planned date at which a step becomes {@link StepStatus.A_FAIRE}. */
export const SOON_THRESHOLD_DAYS = 30;

/** Offsets, in days before a step's planned date, that trigger a reminder. See § 6. */
export const REMINDER_OFFSETS_DAYS = [30, 14, 3] as const;

/**
 * Reinforced reminder scale for the declaration deadline, in days before the
 * deadline. The deadline itself comes from the deadline-rule reference data,
 * never from a constant. See § 6.
 */
export const DECLARATION_REMINDER_OFFSETS_DAYS = [21, 14, 7, 3, 1] as const;

/** Minimum interval, in days, between two reminders about the same overdue step. See § 6. */
export const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

/** Age, in months, past which reference data is flagged as possibly stale. See § 7. */
export const REFERENCE_DATA_STALE_AFTER_MONTHS = 6;

/** Maximum number of results returned by the public commune search. */
export const COMMUNE_SEARCH_LIMIT = 10;
