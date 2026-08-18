/* Which rate card produced a number, travelling with the number.
 *
 * The catalogue is versioned and dated, and until now neither travelled with
 * anything it priced. That is not an abstract tidiness point: an installer pays
 * £100 for a lead and works it days or weeks later, the homeowner has an
 * itemised estimate sitting in an email, and when the two disagree the record
 * has to be able to say which rates each of them is holding. "Whatever was in
 * the file at the time" stops being an answer the moment the file changes.
 *
 * The stored lead is the assertion that matters. A response is read once and
 * thrown away; the lead is what outlives the session, gets delivered, gets
 * reconciled for billing, and gets argued about.
 */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

process.env.LEAD_CAPTURE = 'on';

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const store = require('../store');
const catalogue = require('../catalogue.json');

const PORT = 3214;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);

const realFetch = globalThis.fetch;
require('../server');

before(async () => { await require('./helpers/server-ready')(BASE); });

const post = async (route, body) => {
  const res = await realFetch(BASE + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('the catalogue is versioned and dated at all', () => {
  /* Everything below is worthless if the source has nothing to record. */
  assert.ok(Number.isFinite(catalogue.version), 'catalogue.json has no numeric version');
  assert.match(String(catalogue.updated), /^\d{4}-\d{2}-\d{2}$/, 'catalogue.json has no ISO date in `updated`');
});

test('a quote carries the rate card that produced it', async () => {
  const res = await post('/api/quote', { houseType: 'semi', claddingId: 'alabaster' });
  assert.strictEqual(res.status, 200, `quote failed: ${res.status}`);
  assert.ok(res.body.pricing, 'the quote response carries no pricing version');
  assert.strictEqual(res.body.pricing.version, catalogue.version);
  assert.strictEqual(res.body.pricing.updated, catalogue.updated);
  /* Whether the glazing half rests on sourced rates is part of the same
     question — a stored figure should not need somebody to remember what that
     flag was set to that week. */
  assert.strictEqual(typeof res.body.pricing.glazingSourced, 'boolean',
    'the pricing block does not say whether the glazing rates were sourced');
});

test('a stored lead carries the rate card that priced it', async () => {
  const res = await post('/api/lead', {
    name: 'Pricing Version', email: 'pv@example.com', postcode: 'LS1 1AA',
    houseType: 'semi', claddingId: 'alabaster', roofId: 'terracotta', trimId: 'cedar',
    consent: { terms: true },
  });
  assert.strictEqual(res.status, 200, `lead failed: ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`);

  /* Read through the store rather than off the disk — these tests run against
     JSONL locally and Postgres in CI, and a direct file read passes in one and
     throws ENOENT in the other. That has caught this suite out twice. */
  const leads = await store.readAll('leads');
  const lead = leads.find(l => l.email === 'pv@example.com');
  assert.ok(lead, 'the lead was not stored');
  assert.ok(lead.pricing, 'the stored lead carries no pricing version — an installer cannot tell which rates priced it');
  assert.strictEqual(lead.pricing.version, catalogue.version);
  assert.strictEqual(lead.pricing.updated, catalogue.updated);
});

test('the version is read from the catalogue, not restated in code', () => {
  /* A hardcoded 2 in server.js would go stale the first time the rates were
     re-sourced, and would go stale silently — every lead would then claim a
     rate card that no longer existed, which is worse than no version at all. */
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const fn = server.slice(server.indexOf('const pricingVersion'), server.indexOf('function computePrice'));
  assert.ok(fn.length > 0, 'pricingVersion has moved — this test is checking nothing');
  assert.match(fn, /catalogue\.version/, 'the pricing version is not read from the catalogue');
  assert.match(fn, /catalogue\.updated/, 'the pricing date is not read from the catalogue');
});
