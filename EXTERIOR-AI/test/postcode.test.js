/* A postcode, but only when it is needed.

   It used to be optional in every case. Asking for quotes without one meant
   the routing could reach only the buyers claiming national coverage, so
   "up to three vetted installers covering my area" — the thing they actually
   agreed to — was not something we could honour. An installer cannot quote for
   a house without knowing where it is, either.

   Still optional otherwise. If somebody only wants their design emailed, we
   have no business asking where they live.

   Its own file because the lead endpoint takes five submissions a minute and
   this needs four of them. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const PORT = 3085;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.LEAD_CAPTURE = 'on';
process.env.LEAD_RECIPIENTS = JSON.stringify([{ id: 'a', name: 'Anglian', url: 'https://buyer.test/h' }]);
require('./helpers/email').configureEmail();

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('buyer.test')) return { ok: true, status: 200 };
  return realFetch(url, opts);
};

require('../server');

const save = async (fields) => {
  const res = await realFetch(`${BASE}/api/lead`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Jane', email: 'jane@example.com', claddingId: 'sage-slate', footprintM2: 100, ...fields }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('quotes without a usable postcode are refused', async () => {
  // Missing, half a postcode, and something that is not one at all.
  for (const postcode of ['', 'SW11', 'somewhere in london']) {
    const { status, body } = await save({ postcode, consent: { terms: true, installerQuotes: true, version: 'test' } });
    assert.strictEqual(status, 400, JSON.stringify(postcode));
    assert.strictEqual(body.reason, 'postcode_required_for_quotes');
    assert.match(body.error, /postcode/i);
  }
});

test('the design still saves without one when no quotes were asked for', async () => {
  const { status, body } = await save({
    postcode: '', consent: { terms: true, installerQuotes: false, emailPack: false, version: 'test' },
  });
  assert.strictEqual(status, 200, 'we have no reason to know where they live');
  assert.strictEqual(body.lead.postcode, '');
});
