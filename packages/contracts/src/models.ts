import {
  AccountConfirmationStatus,
  ArreteEntryOutcome,
  DurationUnit,
  FileKind,
  PasswordResetStatus,
  RisqueCatnat,
  SinistreStatus,
  StepAnchor,
  StepKind,
  StepStatus,
  VeilleChangeStatus,
  VeilleConfirmationStatus,
} from './enums';
import { IsoDate, IsoDateTime } from './iso-date';

/** Provenance of a reference-data statement. */
export interface SourceReference {
  /** Where the requirement can be verified by the user. */
  url: string;
  /** Date the content was last checked against that source. */
  verifiedAt: IsoDate;
  /** True when the check is older than the staleness threshold. */
  possiblyOutdated: boolean;
}

/** A French commune, mirrored from the INSEE referential. */
export interface Commune {
  /** INSEE code, e.g. `30189`, `2A004`, `97101`. Not the postal code. */
  codeInsee: string;
  name: string;
  /** INSEE department code, e.g. `30`, `2A`, `971`. */
  departementCode: string;
  departementName: string;
}

/**
 * An arrêté portant reconnaissance de l'état de catastrophe naturelle, as
 * detected by the Journal Officiel monitor.
 */
export interface Arrete {
  id: string;
  /** NOR identifier, unique per arrêté; deduplication key of the monitor. */
  nor: string;
  signedAt: IsoDate;
  /**
   * Publication date in the Journal Officiel — the date legal deadlines run
   * from. Always taken from the JORF XML itself, never from file arrival or
   * third-party databases.
   */
  publishedAt: IsoDate;
  /** JORF issue, e.g. `JORF n°0137 du 13 juin 2026`. */
  jorfNumber: string;
  legifranceUrl: string;
}

/** One commune line of an arrêté annex. */
export interface ArreteEntry {
  id: string;
  arreteId: string;
  codeInsee: string;
  /**
   * Commune label as printed in the annex. Historical context (arrêté screen,
   * annexe attachment) is always displayed from this field, never from the
   * current referential name.
   */
  communeLabelRaw: string;
  /** Risk label as printed in the annex, e.g. `Inondations et coulées de boue`. */
  risque: string;
  /** Period of the natural event the entry covers. */
  eventStart: IsoDate;
  eventEnd: IsoDate;
  outcome: ArreteEntryOutcome;
  /** Decision motivation as printed in the annexe; carried for both outcomes. */
  motivation: string | null;
}

/**
 * A watch subscription: an email address notified on the day an arrêté names
 * one of its communes. Account-less, double opt-in.
 */
export interface Veille {
  id: string;
  email: string;
  /** INSEE codes of the watched communes. */
  communeCodes: string[];
  /** Null until the confirmation link is visited; unconfirmed watches never receive alerts. */
  confirmedAt: IsoDateTime | null;
  createdAt: IsoDateTime;
}

/** Response body of the veille confirmation endpoints (`GET`/`POST`). */
export interface VeilleConfirmationResponse {
  status: VeilleConfirmationStatus;
}

/**
 * Response body of the veille change-of-composition endpoints (`GET`/`POST`).
 * `communes` is the pending request's new composition — present only when
 * `status` is `pending` (`GET`; `POST` never returns it).
 */
export interface VeilleChangeResponse {
  status: VeilleChangeStatus;
  communes?: Pick<Commune, 'name' | 'departementName'>[];
}

/** Response body of the account confirmation endpoint (`POST`). */
export interface AccountConfirmationResponse {
  status: AccountConfirmationStatus;
}

/** Response body of the password-reset-confirmation endpoint (`POST`). */
export interface ResetPasswordResponse {
  status: PasswordResetStatus;
}

/**
 * Response body of the login endpoint. The refresh token is never in the
 * body — it is set as an httpOnly cookie (`apps/api/CLAUDE.md`).
 */
export interface LoginResponse {
  accessToken: string;
}

/** Response body of the current-user endpoint (`GET /auth/me`). */
export interface CurrentUserResponse {
  email: string;
  remindersEnabled: boolean;
}

/** Body and response of the reminders switch (`PATCH /rappels`). */
export interface RemindersPreference {
  enabled: boolean;
}

/** One insurance claim being accompanied. */
export interface Sinistre {
  id: string;
  commune: Commune;
  /** Risk category the user selects at creation; matched against `ArreteEntry.risque` via `classifyRisques`. */
  risque: RisqueCatnat;
  /** Date the damage occurred — first anchor of the plan. */
  eventDate: IsoDate;
  /**
   * Entry that recognised (or refused) the commune for this event; null while
   * no matching arrêté has been published. Linking a RECONNU entry sets the
   * declaration deadline; linking a REFUSE entry moves the sinistre to
   * ARRETE_REFUSE. After a refusal the link may be replaced by a recognising
   * entry from a later arrêté (repeat demande).
   */
  arreteEntryId: string | null;
  /** Date the user declared the damage to their insurer; anchors post-declaration steps. */
  declarationDate: IsoDate | null;
  status: SinistreStatus;
  createdAt: IsoDateTime;
}

/** Reference template a sinistre plan is built from. */
export interface StepTemplate {
  id: string;
  name: string;
  description: string;
  anchor: StepAnchor;
  /**
   * Days added to the anchor date; negative means "before". Null for a step
   * with no offset of its own — its date comes from a legal deadline rule
   * instead, or isn't known at all yet (docs/research/sinistre-plan.md,
   * "Схема").
   */
  offsetDays: number | null;
  required: boolean;
  order: number;
  source: SourceReference;
}

/**
 * A step as it is displayed: no identity and no marks of its own. What the
 * dossier aperçu answers with, since nothing is stored for it to have an id.
 */
export interface StepView {
  name: string;
  description: string;
  kind: StepKind;
  /**
   * Computed date the step should be acted on; null while the step's anchor
   * date is not known yet (e.g. anchored to an arrêté not published yet).
   */
  plannedDate: IsoDate | null;
  /** Derived at read time, except for FAIT and NON_APPLICABLE. */
  status: StepStatus;
  anchor: StepAnchor | null;
  source: SourceReference | null;
  /** Days to `plannedDate`, counted from the same day as `status`. */
  daysLeft: number | null;
  /** Window the step's deadline rule allows; null for a step without a rule. */
  delay: { value: number; unit: DurationUnit } | null;
  /** Position in the plan, and the only stable key a step without an id has. */
  order: number;
}

/** A step within a sinistre — a {@link StepView} that exists in the database. */
export interface Step extends StepView {
  id: string;
  sinistreId: string;
  /** Date the user marked it done. */
  completedAt: IsoDate | null;
  /** False for steps the user added themselves; those are never recomputed. */
  fromTemplate: boolean;
}

/**
 * Остаток критического срока — дедлайн декларации страховщику. `daysLeft` < 0 — просрочка.
 */
export interface DeclarationDeadline {
  date: IsoDate;
  daysLeft: number;
  source: SourceReference;
}

/**
 * A sinistre with its plan — response body of `POST /sinistres`,
 * `GET /sinistres/:id` and `PATCH /sinistres/:id`.
 */
export interface SinistreDetail extends Sinistre {
  steps: Step[];
  declarationDeadline: DeclarationDeadline | null;
}

/** Response body of `GET /sinistres` — one row per sinistre, no steps. */
export type SinistreSummary = Sinistre;

/** What one annex line says about the event it covers. */
export type ArreteCoverage = Pick<Arrete, 'publishedAt' | 'legifranceUrl'> &
  Pick<ArreteEntry, 'outcome' | 'eventStart' | 'eventEnd'>;

/**
 * Response body of `GET /dossier/apercu` — the plan the three parameters would
 * get as a sinistre, computed without storing anything. No `id`: no resource
 * exists to carry one.
 */
export interface DossierApercu {
  commune: Commune;
  risque: RisqueCatnat;
  eventDate: IsoDate;
  /** Only AVANT_ARRETE, ARRETE_PUBLIE or ARRETE_REFUSE: an aperçu has nothing declared. */
  status: SinistreStatus;
  /**
   * Null while no arrêté covers the event — the aperçu is then "attendu". The
   * event period is what the page offers as bounds for refining `eventDate`.
   */
  arrete: ArreteCoverage | null;
  steps: StepView[];
  declarationDeadline: DeclarationDeadline | null;
}

/** One annex line naming the commune: an arrêté names it once per risk and period. */
export interface CommuneArrete extends ArreteCoverage, Pick<Arrete, 'nor'> {
  arreteEntryId: string;
  risqueLabel: ArreteEntry['risque'];
  /** Categories `risqueLabel` classifies to; usually one. Empty when the JO
   * printed a wording the classifier does not know yet: the label is still
   * shown, and the dossier form asks the user to pick from every category. */
  risques: RisqueCatnat[];
  /** Only for a RECONNU entry; null also when no active rule resolved. */
  declarationDeadline: DeclarationDeadline | null;
}

/**
 * Response body of `GET /dossier/arretes` — the window of
 * `COMMUNE_ARRETES_WINDOW_MONTHS`, newest publication first.
 */
export interface CommuneArretes {
  commune: Commune;
  arretes: CommuneArrete[];
}

/** Body of `POST /sinistres` — the three parameters a dossier starts from. */
export interface CreateSinistreInput {
  codeInsee: string;
  risque: RisqueCatnat;
  eventDate: IsoDate;
  /** Answer to a `SinistreConflict`; omitted on a first attempt. */
  confirmNew?: boolean;
}

/**
 * Body of the `409` from `POST /sinistres`: the user already has a dossier for
 * this commune and risk under another date, and the request did not confirm a
 * second one.
 */
export interface SinistreConflict {
  code: 'DOSSIER_EXISTANT';
  existing: { id: string; eventDate: IsoDate };
}

/** A file attached to an inventory item. Stored privately; served via signed URLs only. */
export interface FileRef {
  id: string;
  kind: FileKind;
  fileName: string;
  contentType: string;
  uploadedAt: IsoDateTime;
}

/**
 * One damaged item in the sinistre inventory. A fully filled item carries
 * everything a claim dossier (or its future PDF export) needs.
 */
export interface InventoryItem {
  id: string;
  sinistreId: string;
  name: string;
  /** Brand and model, e.g. `IKEA Ektorp`. */
  brand: string | null;
  description: string | null;
  quantity: number;
  /** Estimated value in euro cents; null when unknown. Integer to avoid float money. */
  costCents: number | null;
  purchaseDate: IsoDate | null;
  /** End of the warranty period, when known. */
  warrantyUntil: IsoDate | null;
  serialNumber: string | null;
  files: FileRef[];
  createdAt: IsoDateTime;
}

/**
 * A legal deadline from the reference data, e.g. the 30-day declaration window.
 * Every legal number in the application lives here with its source — there are
 * no hard-coded legal durations.
 */
export interface DeadlineRule {
  /** Stable code, e.g. `DECLARATION_ASSUREUR`. */
  code: string;
  /** Length of the window counted from the anchor date, expressed in `unit`. */
  duration: number;
  /** Never pre-converted to days: a legal month is not 30 days. */
  unit: DurationUnit;
  anchor: StepAnchor;
  source: SourceReference;
}
