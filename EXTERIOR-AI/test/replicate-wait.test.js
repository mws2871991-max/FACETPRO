/* The Prefer header on the render call.

   Replicate rejects `Prefer: wait=x` outside 1..60 with a 422, before it
   considers the prompt or the image. The code asked for 90, so every render
   request the application ever made was refused — and the refusal was
   indistinguishable from a bad photograph, because the endpoint reported
   only "Render failed (422)".

   Nothing in the test suite could have caught it: the suite never calls
   Replicate, and the value was a plausible-looking number in a header. So
   this reads the source. That is a blunt instrument, but the alternative is
   a live API call in CI against a paid endpoint, and the thing worth
   protecting is narrow and static — a number that must stay inside a range
   somebody else defines.

   If this ever needs to grow past 60, the answer is not a bigger number. It
   is the polling loop underneath, which already covers a further 90 seconds
   and needs no permission from anybody. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/* Comments here quote the rejected value, so assertions read code only. */
const code = server
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

test('the render call asks Replicate to wait within the range it allows', () => {
  const waits = [...code.matchAll(/['"]?Prefer['"]?\s*:\s*[`'"]wait=(\d+)[`'"]/g)]
    .map(m => Number(m[1]));

  assert.ok(waits.length > 0, 'no Prefer: wait header found on the render call');
  for (const w of waits) {
    assert.ok(w >= 1 && w <= 60,
      `Prefer: wait=${w} — Replicate rejects anything outside 1..60 with a 422, ` +
      'which fails every render before the image is even looked at');
  }
});

test('a render slower than the wait is still collected', () => {
  /* The wait is an optimisation, not the mechanism. If the polling loop were
     ever removed, shortening the wait would start losing real renders. */
  assert.match(code, /v1\/predictions\/\$\{pred\.id\}/,
    'no polling fallback — the Prefer wait is now the only path, and it is capped at 60s');
});
