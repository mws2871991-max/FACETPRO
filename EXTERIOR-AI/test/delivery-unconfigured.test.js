/* A lead that consented to sharing, on a server with no buyers configured.

   This is not a hypothetical state — it is the state the deployment is in
   today: LEAD_CAPTURE is off precisely because LEAD_RECIPIENTS, RESEND_API_KEY
   and the rest are not set yet. So the first lead the service ever takes will
   very likely be taken in exactly this configuration, by somebody who turned
   capture on before finishing the rest.

   deliverAndRecord used to `return` on an empty recipient list, two lines
   below a comment promising "a positive record of the decision rather than an
   absence". Every other route to nobody writes a row. That one did not, so
   /api/deliveries could not tell "asked for quotes and nobody was configured"
   apart from "never submitted a lead" — and those want very different
   responses from whoever is reading.

   Its own file because LEAD_RECIPIENTS is read once at module load, so the
   only way to test the unconfigured server is to start one. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

process.env.LEAD_CAPTURE = 'on';

const { test, before } = require('node:test');
const assert = require('node:assert');
const store = require('../store');

const PORT = 3215;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
/* The point of the file. Deleted rather than set empty, because an empty
   string and an unset variable reach parseRecipients differently and unset is
   the state a real deployment is in before anybody has configured a buyer. */
delete process.env.LEAD_RECIPIENTS;
delete process.env.CRM_WEBHOOK_URL;
/* Installer-quotes consent is refused unless the homeowner can be emailed —
   that is where the withdrawal link lives. Nothing is sent; the stub records
   it. */
require('./helpers/email').configureEmail();

const realFetch = globalThis.fetch;
require('../server');

before(async () => { await require('./helpers/server-ready')(BASE); });

const lastDelivery = async () => {
  const rows = await store.readAll('deliveries');
  return rows.length ? rows[rows.length - 1] : null;
};

test('a lead nobody is configured to receive is still recorded as such', async () => {
  const res = await realFetch(BASE + '/api/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Jane', email: 'jane@example.com', postcode: 'SW11 4NP',
      claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
      consent: { terms: true, installerQuotes: true, emailPack: true, version: 'v' },
    }),
  });
  assert.strictEqual(res.status, 200, 'the homeowner is still served');
  const body = await res.json();
  assert.ok(body.lead.id);

  /* Delivery is fired without awaiting the response, so give it a tick to
     land — the same wait the consent tests use. */
  await new Promise(r => setTimeout(r, 400));

  const d = await lastDelivery();
  assert.ok(d, 'the decision is recorded rather than absent');
  assert.strictEqual(d.leadId, body.lead.id, 'and it is this lead');
  assert.strictEqual(d.total, 0, 'nobody was contacted');
  assert.strictEqual(d.delivered, 0);
  assert.match(d.withheld, /no recipients configured/i,
    'and the record says why, in a way that is not confusable with a coverage gap');
});

test('the record distinguishes an unconfigured service from a coverage gap', async () => {
  /* "no configured installer covers this area" is what an area miss says. If
     an empty recipient list produced that too, the operator reading it would
     go looking for a postcode problem that does not exist. */
  const d = await lastDelivery();
  assert.doesNotMatch(d.withheld, /covers this area/i);
  assert.doesNotMatch(d.withheld, /postcode/i);
});
