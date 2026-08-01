/* Consent, rebuilt after an Article 7(4) problem in my own earlier work.

   The original build made "pass my details to installers" a condition of
   saving a design at all. Consent obtained that way is not freely given,
   because refusing it costs you the service. It is now three separate boxes,
   all starting unticked, and only agreement to the Terms is required. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3090;
const BASE = `http://127.0.0.1:${PORT}`;
const DELIVERIES = path.join(__dirname, '..', 'data', 'deliveries.jsonl');

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
process.env.LEAD_RECIPIENTS = JSON.stringify([{ id: 'buyer', name: 'Buyer', url: 'https://127.0.0.1:9/h' }]);
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
require('../server');

const base = { name: 'Jane', email: 'jane@example.com', claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar' };
const send = async (consent) => {
  const res = await realFetch(BASE + '/api/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...base, consent }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const lastDelivery = () => {
  const raw = fs.existsSync(DELIVERIES) ? fs.readFileSync(DELIVERIES, 'utf8').trim() : '';
  return raw ? JSON.parse(raw.split('\n').pop()) : null;
};

test('agreeing to the Terms is required', async () => {
  const { status, body } = await send({ terms: false, installerQuotes: true });
  assert.strictEqual(status, 400);
  assert.match(body.error, /Terms/i);
});

test('a design saves with BOTH optional boxes unticked — the Article 7(4) fix', async () => {
  const { status, body } = await send({ terms: true, installerQuotes: false, emailPack: false, version: 'v' });
  assert.strictEqual(status, 200, 'refusing to share must not cost you the service');
  assert.ok(body.lead.id);
  assert.strictEqual(body.lead.consent.installerQuotes, false);
  assert.strictEqual(body.lead.consent.emailPack, false);

  // No design pack, because they didn't ask for one.
  assert.strictEqual(body.lead.designPack.sent, false);
  assert.match(body.lead.designPack.reason, /did not ask/i);

  // And nobody receives their details — the point of a separate box.
  await new Promise(r => setTimeout(r, 400));
  const d = lastDelivery();
  assert.ok(d, 'the decision is still recorded');
  assert.strictEqual(d.total, 0, 'no recipient was contacted');
  assert.match(d.withheld, /no consent/i, 'and the record says why');
});

test('each answer is recorded separately, with the wording shown', async () => {
  const wording = {
    terms: 'I have read and agree to the Terms of Use and the Privacy Notice.',
    installerQuotes: 'Yes, I would like quotes. Please pass my details to up to three vetted installers…',
    emailPack: 'Email me my design pack.',
  };
  const { body } = await send({ terms: true, installerQuotes: true, emailPack: false, version: '2026-08-01', wording });
  const c = body.lead.consent;
  assert.strictEqual(c.terms, true);
  assert.strictEqual(c.installerQuotes, true);
  assert.strictEqual(c.emailPack, false);
  assert.strictEqual(c.version, '2026-08-01');
  assert.match(c.wording.installerQuotes, /three vetted installers/);
  assert.ok(c.at, 'and when');
});

test('absence and truthiness are both treated as "no"', async () => {
  // Only a real boolean true is consent. A missing key, or a truthy value
  // like 'yes' or 1, must never be read as agreement.
  const { body } = await send({ terms: true, installerQuotes: 'yes', emailPack: 1, version: 'v' });
  assert.strictEqual(body.lead.consent.installerQuotes, false);
  assert.strictEqual(body.lead.consent.emailPack, false);
});
