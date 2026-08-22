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

/**
 * Shortest `q` worth a lookup: a single letter matches thousands of communes
 * and the database would scan for every one of them. Two is also enough for
 * the INSEE branch to be wrong about — "2A" is not a code — which costs one
 * empty answer and no scan. Needed by both the API (query validation) and the
 * web client (when to enable the search query) — declared once here so the
 * two do not carry the number as two separate literals.
 */
export const COMMUNE_SEARCH_MIN_QUERY_LENGTH = 2;

/** How long a veille confirmation link stays valid, in days. */
export const VEILLE_CONFIRM_TTL_DAYS = 7;

/** How long an account confirmation link stays valid, in days. */
export const ACCOUNT_CONFIRM_TTL_DAYS = 7;

/** Upper bound on communes a single veille subscription may track. */
export const VEILLE_MAX_COMMUNES = 20;

/**
 * Cap on veille form mails (confirmation, its resend, and the change-of-
 * composition mail) sent to a single address within a rolling 24h window —
 * anti-spam, counted per address regardless of the form's outcome or a later
 * desinscription.
 */
export const VEILLE_FORM_EMAIL_DAILY_LIMIT = 5;

/**
 * Paths of the veille pages, relative to `FRONTEND_URL`. Declared once here:
 * both the API (mail links) and the web client (page and route handler) need
 * them (docs/plan/emails.md, "Владелец пути").
 */
export const VEILLE_UNSUBSCRIBE_PATH = '/veille/desinscription';
export const VEILLE_CONFIRM_PATH = '/veille/confirmation';
export const VEILLE_CHANGE_PATH = '/veille/changement';

/**
 * How long a veille change (pending `VeilleChange`) link stays valid, in
 * days. A separate constant from `VEILLE_CONFIRM_TTL_DAYS`: the two delays
 * are independent product decisions that merely coincide in value
 * (docs/research/veille-commune-change.md) — reusing the confirmation one
 * would make a change to either silently move the other.
 */
export const VEILLE_CHANGE_TTL_DAYS = 7;

/**
 * Path of the account confirmation page, relative to `FRONTEND_URL` — the link
 * the confirmation mail carries (docs/research/user-account.md). Declared here
 * even though the page itself ships later (phase 5): the mail that needs it
 * ships first (phase 1).
 */
export const ACCOUNT_CONFIRM_PATH = '/confirmation';

/**
 * Every account mail (confirmation, password reset, "you already have an
 * account") is transactional — one address, one action, no ongoing
 * subscription to cancel. `unsubscribePath` is still mandatory on every
 * message the API sends and its `List-Unsubscribe-Post` header still gets a
 * real RFC 8058 one-click `POST` from mail clients (`src/mail/CLAUDE.md`), so
 * this cannot reuse another account mail's single-use token (a client that
 * prefetches List-Unsubscribe links would spend a confirmation or reset token
 * before its owner ever acts on it) nor point at a page path such as
 * `ACCOUNT_CONFIRM_PATH` or the site's home page: a Next.js route segment
 * cannot serve both a page and a `route.ts` handler, so a page path can never
 * grow the `POST` handler this needs. This path is reserved for that handler
 * alone — no page is ever planned here — and answers a no-op `200`: nothing
 * about a transactional account mail is actually cancelled by it.
 */
export const ACCOUNT_MAIL_UNSUBSCRIBE_PATH = '/compte/desabonnement';

/**
 * `pending`/`active` reflect `Veille.confirmedAt`; `invalid` covers both an
 * unknown token and an expired, still-unconfirmed one — the two causes are
 * never told apart in the response (anti-enumeration).
 *
 * A runtime array, not just a union: the API's Swagger DTO needs the values
 * as data, and a hand-copied list there would go stale silently.
 */
export const VEILLE_CONFIRMATION_STATUSES = [
  'pending',
  'active',
  'invalid',
] as const;
export type VeilleConfirmationStatus =
  (typeof VEILLE_CONFIRMATION_STATUSES)[number];

/**
 * `pending` reflects a live `VeilleChange`; `applied` is the terminal answer of
 * `POST` only — the row is deleted the moment it applies, so it is never read
 * back as `pending`. `invalid` covers an unknown token, an expired request and
 * an already-applied one — the three causes are never told apart (anti-
 * enumeration), same principle and same reason for a runtime array as
 * `VEILLE_CONFIRMATION_STATUSES` above.
 */
export const VEILLE_CHANGE_STATUSES = [
  'pending',
  'applied',
  'invalid',
] as const;
export type VeilleChangeStatus = (typeof VEILLE_CHANGE_STATUSES)[number];

/**
 * Activation is idempotent by design: `confirmed` covers both the first
 * activation and any repeat call, which gets the same success answer, never
 * an error. `invalid` covers both an unknown token and an expired one — the
 * two causes are never told apart in the response (anti-enumeration), same
 * principle as `VEILLE_CONFIRMATION_STATUSES` above.
 */
export const ACCOUNT_CONFIRMATION_STATUSES = ['confirmed', 'invalid'] as const;
export type AccountConfirmationStatus =
  (typeof ACCOUNT_CONFIRMATION_STATUSES)[number];
