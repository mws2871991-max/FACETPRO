'use strict';
require('./helpers/data-dir');
/* 2 October: one render failed with Replicate's own "Server side error".
   A failed prediction is tried once more, within the deadline and the
   daily allowance; anything else is not. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('a prediction Replicate failed is marked retryable, a cancelled one is not', () => {
  assert.match(src, /retryable: p\.status === 'failed'/);
});

test('the first render is retried once, only with time left and allowance to spend', () => {
  const at = src.indexOf('async function runFluxOrRetry');
  const fn = src.slice(at, src.indexOf('\n}\n', at));
  assert.ok(at > 0);
  assert.match(fn, /if \(tried\.ok \|\| !tried\.retryable\) return tried;/);
  assert.match(fn, /RETRY_NEEDS_MS \|\| !consumeDailyQuota\('render', res, req\)/);
  assert.strictEqual((fn.match(/runFlux\(args\)/g) || []).length, 2, 'the first try and exactly one more');
  assert.match(src, /const first = await runFluxOrRetry\(/);
});
