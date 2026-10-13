import suffixedDbName from './db-name.js';

/** Both the seed and the API started on the seeded base must derive this name. */
export default (baseName: string | undefined): string =>
  suffixedDbName(baseName, '_e2e');
