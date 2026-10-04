'use strict';

const suffixedDbName = require('./db-name');

/** Both the global setup and the per-worker env file must derive this name. */
module.exports = (baseName) => suffixedDbName(baseName, '_test');
