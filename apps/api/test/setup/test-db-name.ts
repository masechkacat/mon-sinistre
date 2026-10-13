import suffixedDbName from './db-name.js';

/** Both the global setup and the per-file env setup must derive this name. */
export default (baseName: string | undefined): string =>
  suffixedDbName(baseName, '_test');
