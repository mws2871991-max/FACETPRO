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

/* One directory per test file, inside the run's directory.

   test/run.js hands every file the same FACETPRO_DATA_DIR so it can check
   afterwards that nothing wrote outside it. That was harmless while the only
   shared thing was a set of JSONL tables each file rewrote for itself. It
   stopped being harmless when detection started caching its answers to disk,
   keyed on a hash of the image — because the tiny JPEGs these files build are
   byte-identical between files. security.test.js's `tinyJpeg(641)` and
   image-gate.test.js's `jpeg(641)` are the same bytes and therefore the same
   hash, so whichever ran first answered for the other.

   It surfaced as the daily-cap test failing: its third request was served from
   another file's cache, never reached the provider, never spent the quota, and
   came back 200 where the test wanted 429. Nothing was wrong with the cap, the
   cache or the fixtures — only with two files sharing a directory.

   A subdirectory per file keeps run.js's guarantee (everything is still under
   its temp root) and gives each file a store of its own. argv[1] is the test
   file, because node:test runs each in its own process. */
const entry = process.argv[1] ? path.basename(process.argv[1], '.js') : 'shared';
const perFile = path.join(process.env.FACETPRO_DATA_DIR, entry);
fs.mkdirSync(perFile, { recursive: true });
process.env.FACETPRO_DATA_DIR = perFile;

module.exports = { DATA_DIR: perFile };
