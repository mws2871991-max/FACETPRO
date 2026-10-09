'use strict';
/* The same quote request twice in a day is one lead (security handoff,
   9 Oct). Installers pay per lead; a double tap must not bill them twice. */
require('./helpers/data-dir');
process.env.LEAD_CAPTURE = 'on';
const { test, before } = require('node:test');
const assert = require('node:assert');
const store = require('../store');
const PORT = 3331;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
process.env.LEAD_RECIPIENTS = JSON.stringify([{ id: 'buyer', name: 'Buyer', url: 'https://127.0.0.1:9/h' }]);
require('./helpers/email').configureEmail();
const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const send = async (extra = {}) => {
  const res = await realFetch(BASE + '/api/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Sam', email: 'sam.dup@example.com', postcode: 'SE1 7PB', claddingId: 'sage-slate',
      consent: { terms: true, installerQuotes: true, version: '2026-09-30' }, ...extra }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('a second identical quote request returns the first lead and creates nothing new', async () => {
  const first = await send();
  assert.strictEqual(first.status, 200, JSON.stringify(first.body));
  const before = (await store.readAll('leads')).length;
  const second = await send({ email: 'SAM.DUP@example.com', postcode: 'se17pb' });
  assert.strictEqual(second.status, 200);
  assert.strictEqual(second.body.duplicate, true);
  assert.strictEqual(second.body.lead.id, first.body.lead.id);
  assert.strictEqual((await store.readAll('leads')).length, before, 'no new lead stored');
});

test('a different postcode is a different request', async () => {
  const other = await send({ postcode: 'SW11 4NP' });
  assert.strictEqual(other.status, 200);
  assert.ok(!other.body.duplicate);
});

test('a changed design from the same person is a new request', async () => {
  const changed = await send({ claddingId: 'graphite' });
  assert.strictEqual(changed.status, 200);
  assert.ok(!changed.body.duplicate, 'they changed their mind and asked again');
});
