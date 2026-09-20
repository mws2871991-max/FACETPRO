/* Automated traffic must not land in the tables the bands are calibrated from.

   Between 17 and 20 September a review uploaded two photographs about fifteen
   times against production. autoMeasure() runs on every upload, so each one
   wrote a measurements row; all of them were fallbacks, and about ten were the
   identical 181 m² — a detached house measured against the semi-detached band
   because the house type defaults to semi. /api/measurements then reported 86%
   of photographs failing over 35 rows, and bandRejections offered that 181 m²
   pile-up as evidence the semi ceiling was too low.

   Two defences, one test file: mark the traffic, and count photographs rather
   than rows. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const store = require('../store');
const { isTestTraffic, TEST_TRAFFIC_HEADER } = require('../testtraffic');

const PORT = 3136;
const BASE = `http://127.0.0.1:${PORT}`;
const TOKEN = 'a-test-traffic-token';

process.env.PORT = String(PORT);
process.env.TEST_TRAFFIC_TOKEN = TOKEN;
process.env.INSTALLER_PASSWORD = 'the-installer-password';

const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const stage = (headers = {}) => realFetch(`${BASE}/api/funnel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify({ stage: 'landing' }),
});

// readFunnel answers { stage: hits }, totalled across the window.
const landings = async () => Number((await store.readFunnel(30)).landing || 0);

test('a marked request is served normally and counted nowhere', async () => {
  const before = await landings();

  const marked = await stage({ [TEST_TRAFFIC_HEADER]: TOKEN });
  assert.strictEqual(marked.status, 204,
    'a test request must be answered exactly like a real one — a different path tests a different product');
  await new Promise(r => setTimeout(r, 120));   // the write happens after the 204
  assert.strictEqual(await landings(), before, 'the marked request was counted');

  await stage();
  await new Promise(r => setTimeout(r, 120));
  assert.strictEqual(await landings(), before + 1, 'an ordinary request stopped being counted');
});

test('the wrong token, or none, counts as ordinary traffic', () => {
  assert.strictEqual(isTestTraffic({ headers: { [TEST_TRAFFIC_HEADER]: 'not-the-token' } }), false);
  assert.strictEqual(isTestTraffic({ headers: {} }), false);
  assert.strictEqual(isTestTraffic({}), false);
  assert.strictEqual(isTestTraffic({ headers: { [TEST_TRAFFIC_HEADER]: TOKEN } }), true);
});

test('with no token configured, nothing is excluded', () => {
  const saved = process.env.TEST_TRAFFIC_TOKEN;
  delete process.env.TEST_TRAFFIC_TOKEN;
  try {
    assert.strictEqual(isTestTraffic({ headers: { [TEST_TRAFFIC_HEADER]: saved } }), false,
      'production must exclude nothing until somebody turns this on deliberately');
  } finally {
    process.env.TEST_TRAFFIC_TOKEN = saved;
  }
});

/* ── counting photographs rather than rows ── */

test('one photograph measured five times is one sample', async () => {
  const row = {
    houseType: 'semi', method: 'prior', m2: 85,
    doorRatio: 2.3, doorHeightPct: 12, doorBoxes: 1,
    rejected: { m2: 181, side: 'above', method: 'door' },
  };
  for (let i = 0; i < 5; i++) await store.recordMeasurement(row);
  // A genuinely different house, so the dedupe cannot simply be collapsing all.
  await store.recordMeasurement({ ...row, m2: 92, doorRatio: 2.41, rejected: null });

  const written = (await store.readMeasurements(1000))
    .filter(r => Number(r.doorRatio) === 2.3 && r.houseType === 'semi').length;
  assert.strictEqual(written, 5, 'the fixture did not write what this test is about');

  const res = await realFetch(`${BASE}/api/measurements`, {
    headers: { Authorization: 'Bearer the-installer-password' },
  });
  assert.strictEqual(res.status, 200);
  const body = await res.json();

  assert.strictEqual(body.rows, 6, 'rows should report what actually happened');
  assert.strictEqual(body.samples, 2, 'five measurements of one photograph are one observation');
  assert.strictEqual(body.repeats, 4, 'the folded-away repeats should be reported, not hidden');

  /* And the rate is per photograph. Both fixtures fell back, so this is 100%
     either way — what matters is the denominator it was computed on. */
  assert.strictEqual(body.fallback.samples, 2);
  assert.strictEqual(body.fallback.rows, 6);
  assert.strictEqual(body.fallback.reliable, false,
    'two photographs must never be reported as a reliable rate, however many rows they wrote');

  /* The pile-up this exists to stop: one house refused ten times used to read
     as ten houses refused, in the histogram offered as evidence to move the
     band. */
  assert.strictEqual(body.bandRejections?.semi?.above?.count, 1,
    'the same refusal counted more than once would argue the band is wrong on one photograph');
});
