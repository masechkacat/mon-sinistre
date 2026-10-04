'use strict';

const suffixedDbName = require('./db-name');

/** Both the seed and the API started on the seeded base must derive this name. */
module.exports = (baseName) => suffixedDbName(baseName, '_e2e');
