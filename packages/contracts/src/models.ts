import {
  ArreteEntryOutcome,
  DurationUnit,
  FileKind,
  SinistreStatus,
  StepAnchor,
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

/** One insurance claim being accompanied. */
export interface Sinistre {
  id: string;
  communeCode: string;
  /** Risk label; free text until an arrêté entry is linked. */
  risque: string;
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
  /** Days added to the anchor date. Negative means "before". */
  offsetDays: number;
  required: boolean;
  order: number;
  source: SourceReference;
}

/** A step within a sinistre. */
export interface Step {
  id: string;
  sinistreId: string;
  name: string;
  description: string;
  /**
   * Computed date the step should be acted on; null while the step's anchor
   * date is not known yet (e.g. anchored to an arrêté not published yet).
   */
  plannedDate: IsoDate | null;
  /** Derived at read time, except for FAIT and NON_APPLICABLE. */
  status: StepStatus;
  /** Date the user marked it done. */
  completedAt: IsoDate | null;
  /** False for steps the user added themselves; those are never recomputed. */
  fromTemplate: boolean;
  anchor: StepAnchor | null;
  source: SourceReference | null;
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
