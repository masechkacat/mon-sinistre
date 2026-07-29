/**
 * Shared enumerations.
 *
 * Values are stored in the database and sent over the wire, so they must stay
 * stable. Display labels live in the web client's locale files, never here:
 * this package carries no user-facing French text.
 */

/**
 * Lifecycle of a single renewal cycle.
 * See specification § 4.6.
 */
export enum DossierStatus {
  /** Being prepared, not submitted yet. */
  PREPARATION = 'PREPARATION',
  /** Submitted to the MDPH, awaiting a decision. */
  DEPOSE = 'DEPOSE',
  /** A decision has been recorded. */
  DECISION_RECUE = 'DECISION_RECUE',
  /** Closed by the user, excluded from reminders. */
  ARCHIVE = 'ARCHIVE',
}

/**
 * State of a step.
 *
 * Only {@link StepStatus.FAIT} and {@link StepStatus.NON_APPLICABLE} are
 * persisted; the remaining values are derived from the planned date at read
 * time. See specification § 5.1.
 */
export enum StepStatus {
  /** Planned date is more than {@link SOON_THRESHOLD_DAYS} days away. */
  A_VENIR = 'A_VENIR',
  /** Planned date is within {@link SOON_THRESHOLD_DAYS} days. */
  A_FAIRE = 'A_FAIRE',
  /** Planned date has passed and the step is not done. */
  EN_RETARD = 'EN_RETARD',
  /** Marked as done by the user. */
  FAIT = 'FAIT',
  /** Marked as not relevant for this dossier. */
  NON_APPLICABLE = 'NON_APPLICABLE',
}

/**
 * Reference point a step's planned date is computed from.
 * See specification § 3.3.
 */
export enum StepAnchor {
  /** Offset applies to the date current rights expire. */
  DATE_EXPIRATION = 'DATE_EXPIRATION',
  /** Offset applies to the submission date. */
  DATE_DEPOT = 'DATE_DEPOT',
}

/**
 * Outcome of a submitted dossier.
 * See specification § 7.3.
 */
export enum DecisionResult {
  ACCORDE = 'ACCORDE',
  REFUSE = 'REFUSE',
  PARTIEL = 'PARTIEL',
}

/**
 * Which source supplied the review duration used in the plan.
 *
 * Surfaced to the user so the origin of a computed date is always traceable.
 * See specification §§ 3.9, 3.10.
 */
export enum ReviewDurationSource {
  /** Entered by the user for this dossier — highest priority. */
  UTILISATEUR = 'UTILISATEUR',
  /** Taken from the beneficiary's department. */
  DEPARTEMENT = 'DEPARTEMENT',
  /** Procedure default, used when no department figure exists. */
  PROCEDURE = 'PROCEDURE',
}

/** Days before the planned date at which a step becomes {@link StepStatus.A_FAIRE}. */
export const SOON_THRESHOLD_DAYS = 30;

/** Offsets, in days before a step's planned date, that trigger a reminder. See § 8.3. */
export const REMINDER_OFFSETS_DAYS = [30, 14, 3] as const;

/** Minimum interval, in days, between two reminders about the same overdue step. See § 8.3. */
export const OVERDUE_REMINDER_INTERVAL_DAYS = 7;

/** Age, in months, past which reference data is flagged as possibly stale. See § 3.13. */
export const REFERENCE_DATA_STALE_AFTER_MONTHS = 6;
