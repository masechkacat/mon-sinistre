import {
  DecisionResult,
  DossierStatus,
  ReviewDurationSource,
  StepAnchor,
  StepStatus,
} from './enums';

/**
 * Calendar date without a time component, as `YYYY-MM-DD`.
 *
 * All domain dates are day-precision. Using a plain string rather than `Date`
 * keeps them free of timezone shifts: a deadline is the same day everywhere,
 * and serialising a `Date` across the wire is exactly how such dates drift.
 */
export type IsoDate = string;

/** Timestamp with a time component, as ISO 8601. */
export type IsoDateTime = string;

/** Provenance of a reference-data statement. See specification §§ 3.11–3.13. */
export interface SourceReference {
  /** Where the requirement can be verified by the user. */
  url: string;
  /** Date the content was last checked against that source. */
  verifiedAt: IsoDate;
  /** True when the check is older than the staleness threshold. */
  possiblyOutdated: boolean;
}

/** A French department. See specification § 3.8. */
export interface Departement {
  /** INSEE code, e.g. `75`, `2A`, `971`. */
  code: string;
  name: string;
  /** Observed review duration in months; null when unknown. */
  reviewDurationMonths: number | null;
  /** Date the figure above refers to. */
  observedAt: IsoDate | null;
}

/** Person a dossier is filed for. See specification § 2. */
export interface Beneficiaire {
  id: string;
  name: string;
  birthDate: IsoDate;
  /** True when the account holder is the beneficiary. */
  isSelf: boolean;
  departementCode: string;
  /** Derived from birthDate, see § 2.4. */
  isAdult: boolean;
}

/** Reference template a plan is built from. See specification § 3.2. */
export interface ProcedureTemplate {
  code: string;
  name: string;
  description: string;
  /** Statutory limit, identical nationwide. */
  legalReviewDurationMonths: number;
  /** Fallback used when the department has no figure. Never below the legal limit. */
  defaultReviewDurationMonths: number;
  /** Age bracket this procedure applies to; null means no restriction. */
  appliesToAdults: boolean | null;
  source: SourceReference;
}

/** One step of a procedure template. See specification § 3.3. */
export interface StepTemplate {
  id: string;
  name: string;
  description: string;
  anchor: StepAnchor;
  /** Days added to the anchor date. Negative means "before". */
  offsetDays: number;
  required: boolean;
  /** Document type this step produces, when it produces one. */
  documentTypeCode: string | null;
  order: number;
  source: SourceReference;
}

/** Which duration was applied to a plan, and why. See specification §§ 3.9, 3.10. */
export interface AppliedReviewDuration {
  months: number;
  source: ReviewDurationSource;
}

/** One renewal cycle. See specification § 4. */
export interface Dossier {
  id: string;
  beneficiaireId: string;
  procedureCode: string;
  status: DossierStatus;
  /** Date the current rights expire — the single input the whole plan derives from. */
  expirationDate: IsoDate;
  /** Recommended or user-adjusted submission date. */
  submissionDate: IsoDate;
  reviewDuration: AppliedReviewDuration;
  /** Set once the dossier is actually submitted. See § 7.1. */
  submittedAt: IsoDate | null;
  decision: Decision | null;
  createdAt: IsoDateTime;
}

/** Recorded outcome. See specification § 7.3. */
export interface Decision {
  result: DecisionResult;
  decidedAt: IsoDate;
  /** Expiry of the newly granted rights; null when refused. */
  newExpirationDate: IsoDate | null;
}

/** A step within a dossier. See specification § 5. */
export interface Step {
  id: string;
  dossierId: string;
  name: string;
  description: string;
  /** Computed date the step should be acted on. */
  plannedDate: IsoDate;
  /** Derived at read time, except for FAIT and NON_APPLICABLE. */
  status: StepStatus;
  /** Date the user marked it done. */
  completedAt: IsoDate | null;
  /** False for steps the user added themselves; those are never recomputed. See § 5.6. */
  fromTemplate: boolean;
  anchor: StepAnchor | null;
  documentTypeCode: string | null;
  source: SourceReference | null;
}

/** Reference entry describing a kind of document. See specification § 6.6. */
export interface DocumentType {
  code: string;
  name: string;
  /** Default shelf life in months; null means it does not expire. */
  defaultValidityMonths: number | null;
  source: SourceReference;
}

/** A document the user has obtained. See specification § 6. */
export interface DocumentRecord {
  id: string;
  dossierId: string;
  typeCode: string;
  issuedAt: IsoDate;
  /** Overrides the type default when set. */
  validityMonths: number | null;
  /** Computed from issuedAt and the applicable validity; null when perpetual. */
  expiresAt: IsoDate | null;
  /** Free note. Must not carry medical content — see § 11.1. */
  comment: string | null;
}

/**
 * Raised when a document expires before the dossier is due to be submitted.
 * See specification §§ 6.4, 6.5.
 */
export interface DocumentWarning {
  documentId: string;
  typeCode: string;
  expiresAt: IsoDate;
  submissionDate: IsoDate;
  /** Earliest date the document can be reissued and still be valid at submission. */
  reissueNotBefore: IsoDate;
}
