/* LEAD_CAPTURE=off — the switch that lets the site be shown publicly before
   the privacy notice and terms are finished.

   The bar is not "the form is disabled". It is that no name, email, phone or
   postcode is read, parsed, logged or written. This runs the server with the
   switch off and checks exactly that. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const {test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3091;
const BASE = `http://127.0.0.1:${PORT}`;
const LEADS_FILE = path.join(process.env.FACETPRO_DATA_DIR, 'leads.jsonl');

process.env.PORT = String(PORT);
process.env.LEAD_CAPTURE = 'off';
process.env.INSTALLER_PASSWORD = 'test-pw';
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
require('../server');

/* The server listens asynchronously. Against JSONL that is a tick; against
   Postgres it is a schema, and a fetch issued before the socket exists fails
   with "fetch failed". See test/helpers/server-ready.js. */
before(async () => { await require('./helpers/server-ready')(BASE); });

const post = async (p, body) => {
  const res = await realFetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const PERSONAL = {
  name: 'Jane Homeowner',
  email: 'jane@example.com',
  phone: '07700 900123',
  postcode: 'SW11 4NP',
  consent: { terms: true, installerQuotes: true, version: 'v' },
};

test('the server tells the page capture is off', async () => {
  const cfg = await realFetch(BASE + '/api/config').then(r => r.json());
  assert.strictEqual(cfg.leadCapture, false);
});

test('a submission is refused, and says why in plain English', async () => {
  const { status, body } = await post('/api/lead', PERSONAL);
  assert.strictEqual(status, 503);
  assert.strictEqual(body.reason, 'lead_capture_off');
  assert.match(body.error, /privacy policy/i);
  // It should not read like a fault.
  assert.ok(!/error|failed|wrong/i.test(body.error), `sounds like a breakage: ${body.error}`);
});

test('nothing personal is written anywhere', async () => {
  // Compare the file against itself, not against a list of strings: earlier
  // test files in the same run legitimately store leads, so searching the
  // whole file for "jane@example.com" finds theirs and fails for the wrong
  // reason. What matters is that these two submissions add nothing.
  const read = () => (fs.existsSync(LEADS_FILE) ? fs.readFileSync(LEADS_FILE, 'utf8') : '');
  const before = read();

  await post('/api/lead', PERSONAL);
  await post('/api/lead', { ...PERSONAL, email: 'unique-to-this-test@example.com' });

  const after = read();
  assert.strictEqual(after, before, 'the leads file must be byte-identical afterwards');
  assert.ok(!after.includes('unique-to-this-test@example.com'),
    'an address only this test uses must not appear');
});

test('no lead is returned to the caller either', async () => {
  const { body } = await post('/api/lead', PERSONAL);
  assert.ok(!body.lead, 'no lead object should come back');
  assert.ok(!JSON.stringify(body).includes(PERSONAL.email), 'the response must not echo their address');
});

test('the rest of the journey still works, which is the whole point', async () => {
  const quote = await post('/api/quote', {
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', houseType: 'semi',
  });
  assert.strictEqual(quote.status, 200);
  assert.ok(quote.body.range.low > 0, 'the estimate still works');

  const whole = await post('/api/whole-house', { finishId: 'white-render', areaM2: 95 });
  assert.strictEqual(whole.status, 200);
  assert.ok(whole.body.total > 0);

  const catalogue = await realFetch(BASE + '/api/catalogue').then(r => r.json());
  assert.strictEqual(catalogue.conservatories.styles.length, 8);
});

test('the installer area is unaffected', async () => {
  const denied = await realFetch(BASE + '/api/leads').then(r => r.status);
  assert.strictEqual(denied, 401, 'still password-protected, not switched off');
  const allowed = await realFetch(BASE + '/api/leads', {
    headers: { Authorization: 'Bearer test-pw' },
  }).then(r => r.status);
  assert.strictEqual(allowed, 200, 'existing leads are still readable by an installer');
});
