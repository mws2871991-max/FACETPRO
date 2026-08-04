/* What a homeowner is told when a paid provider says no.

   The first live detection call against a real Anthropic account returned
   this, verbatim, to the browser:

     Detection failed (HTTP 400). Your credit balance is too low to access
     the Anthropic API. Please go to Plans & Billing to upgrade or purchase
     credits.

   Somebody who uploaded a photograph of their house was shown the state of
   our billing account. The 401, 429 and 5xx branches beside it had all been
   written with a person in mind; the leak was in the fallback, which is
   exactly the branch nobody pictures anyone reading.

   Two separate things are being protected here, and they pull in opposite
   directions:

     the operator needs the upstream reason, or a header bug looks like a bad
     photograph for weeks — which is precisely what happened to the render;

     the visitor needs a sentence about what they can do, and nothing about
     our account, our vendors or our HTTP.

   So the reason goes to console.error and the browser gets neither the text
   nor the status. These tests read the source, because the failure they guard
   against only happens when a third party we do not control returns an error
   we did not anticipate — which is not a thing the suite can produce. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/* Comments here quote the leak they exist to prevent. Assertions read code. */
const code = server
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '');

/* Every string handed to the client as `error:`. */
function clientErrors(src) {
  return [...src.matchAll(/error:\s*(`[^`]*`|'[^']*'|"[^"]*")/g)].map(m => m[1]);
}

test('no client-facing error carries an upstream provider message', () => {
  for (const e of clientErrors(code)) {
    assert.ok(!/\$\{\s*detail\s*\}/.test(e) && !/\bdetail\b/.test(e),
      `an upstream message is being forwarded to the browser: ${e}`);
    assert.ok(!/\.message\s*\}/.test(e),
      `an exception message is being forwarded to the browser: ${e}`);
  }
});

test('no client-facing error carries an upstream HTTP status', () => {
  /* "Render failed (422)" told the homeowner their photo was rejected. It was
     a header we sent. The number is useful, in the log, to us. */
  for (const e of clientErrors(code)) {
    assert.ok(!/\$\{[^}]*(Res|res)\.status[^}]*\}/.test(e),
      `an upstream status is being shown to the browser: ${e}`);
    assert.ok(!/HTTP\s*\$\{/.test(e),
      `an upstream status is being shown to the browser: ${e}`);
  }
});

test('the upstream reason is still logged for whoever can act on it', () => {
  /* The whole point is to move the detail, not delete it. If these logs ever
     go, the next provider-side failure becomes invisible again. */
  assert.match(code, /console\.error\([^)]*[Aa]nthropic[^)]*\)/,
    'the Anthropic failure reason is no longer logged anywhere');
  assert.match(code, /console\.error\(['"]Replicate render error/,
    'the Replicate failure reason is no longer logged anywhere');
});
