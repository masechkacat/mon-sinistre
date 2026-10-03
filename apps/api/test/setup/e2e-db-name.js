'use strict';

const suffixedDbName = require('./db-name');

/** Both the e2e seed and the API started by Playwright read this name. */
module.exports = (baseName) => suffixedDbName(baseName, '_e2e');
