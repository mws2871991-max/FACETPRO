/* Somewhere harmless for the suite to write.

   The tests used to write into `data/` — the same directory a deployment
   mounts its volume on. Running `npm test` on a box with that volume attached
   would have put test leads into real storage and deleted the live spend
   counter. Nothing else here can damage anything outside the app; this could.

   Required before anything that reads it, because store.js resolves the path
   once at load. `npm test` sets it for the whole run via the script, so this
   is the belt to that braces: a file run on its own still lands in a temp
   directory rather than in the real one.

   Not cleaned up on purpose — a failed run is easier to diagnose with the
   files still there, and the OS clears its own temp directory. */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

if (!process.env.FACETPRO_DATA_DIR) {
  process.env.FACETPRO_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'facetpro-test-'));
}

module.exports = { DATA_DIR: process.env.FACETPRO_DATA_DIR };
