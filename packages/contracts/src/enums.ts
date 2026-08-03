/**
 * Shared enumerations. Values are stored in the database and sent over the wire,
 * so they must stay stable. Display labels live in the web client's locale
 * files, never here.
 */

/**
 * `AVANT_ARRETE → (ARRETE_PUBLIE | ARRETE_REFUSE) → DECLARE → CLOS`, plus
 * `SANS_SUITE` from any state. A refused sinistre can still reach
 * `ARRETE_PUBLIE`: the mairie may file a repeat demande, and a later arrêté
 * (new NOR) can recognise the commune.
 */
export enum SinistreStatus {
  AVANT_ARRETE = 'AVANT_ARRETE',
  ARRETE_PUBLIE = 'ARRETE_PUBLIE',
  /** Refused: no declaration deadline runs and the plan switches to the refusal steps. */
  ARRETE_REFUSE = 'ARRETE_REFUSE',
  DECLARE = 'DECLARE',
  CLOS = 'CLOS',
  SANS_SUITE = 'SANS_SUITE',
}

export enum StepStatus {
  A_VENIR = 'A_VENIR',
  A_FAIRE = 'A_FAIRE',
  EN_RETARD = 'EN_RETARD',
  FAIT = 'FAIT',
  NON_APPLICABLE = 'NON_APPLICABLE',
}

/** Reference point a step's planned date is computed from. */
export enum StepAnchor {
  DATE_SINISTRE = 'DATE_SINISTRE',
  DATE_PUBLICATION_ARRETE = 'DATE_PUBLICATION_ARRETE',
  DATE_DECLARATION = 'DATE_DECLARATION',
}

/**
 * Insurer deadlines are worded in months in the law, and a legal month is not
 * 30 days — the unit stays part of the rule and is never converted in advance.
 */
export enum DurationUnit {
  DAYS = 'DAYS',
  MONTHS = 'MONTHS',
}

/** Annexe I of an arrêté lists recognised communes, annexe II refusals. */
export enum ArreteEntryOutcome {
  RECONNU = 'RECONNU',
  REFUSE = 'REFUSE',
}

export enum FileKind {
  PHOTO = 'PHOTO',
  JUSTIFICATIF = 'JUSTIFICATIF',
}

/** Days before the planned date at which a step becomes {@link StepStatus.A_FAIRE}. */
export const SOON_THRESHOLD_DAYS = 30;

/** Offsets, in days before a step's planned date, that trigger a reminder. */
export const REMINDER_OFFSETS_DAYS = [30, 14, 3] as const;

/**
 * Reinforced scale, in days before the declaration deadline. The deadline
 * itself comes from the deadline-rule reference data, never from a constant.
 */
export const DECLARATION_REMINDER_OFFSETS_DAYS = [21, 14, 7, 3, 1] as const;

/** Minimum interval, in days, between two reminders about the same overdue step. */
export const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

export const REFERENCE_DATA_STALE_AFTER_MONTHS = 6;

export const COMMUNE_SEARCH_LIMIT = 10;
