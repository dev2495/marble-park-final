'use strict';

const core = require('minimatch-core');

function minimatch(path, pattern, options) {
  return core.minimatch(path, pattern, options);
}

Object.assign(minimatch, core, { minimatch: core.minimatch });

module.exports = minimatch;
