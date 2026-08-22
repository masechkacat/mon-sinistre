/**
 * Contracts shared by the API and the web client.
 *
 * This package holds types, enums, constants and dependency-free helpers
 * (`toIsoDate`/`isIsoDate`) — no framework code and no user-facing French
 * strings. Anything displayed to a user belongs in the web client's locale
 * files.
 */

export * from './enums';
export * from './iso-date';
export * from './models';
export * from './password';
