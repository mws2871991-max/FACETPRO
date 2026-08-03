/* Consent, rebuilt after an Article 7(4) problem in my own earlier work.

   The original build made "pass my details to installers" a condition of
   saving a design at all. Consent obtained that way is not freely given,
   because refusing it costs you the service. It is now three separate boxes,
   all starting unticked, and only agreement to the Terms is required. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3090;
const BASE = `http://127.0.0.1:${PORT}`;
const DELIVERIES = path.join(process.env.FACETPRO_DATA_DIR, 'deliveries.jsonl');

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
process.env.LEAD_RECIPIENTS = JSON.stringify([{ id: 'buyer', name: 'Buyer', url: 'https://127.0.0.1:9/h' }]);
/* Installer-quotes consent is refused unless we can email the homeowner —
   that is where the withdrawal link lives — so email is made to look
   configured. Nothing is sent; the stub records it. */
require('./helpers/email').configureEmail();

const realFetch = globalThis.fetch;
require('../server');

/* A postcode, because asking for installer quotes without one is refused —
   the routing could only reach buyers claiming national coverage, so
   "installers covering my area" would not be a consent we could honour. */
const base = { name: 'Jane', email: 'jane@example.com', postcode: 'SW11 4NP',
  claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar' };
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

  // No email, because they asked for neither. (The field covers both the
  // design pack and the sharing confirmation — a lead that asked for quotes
  // but not the pack still gets one, since that is where the withdrawal link
  // lives.)
  assert.strictEqual(body.lead.homeownerEmail.sent, false);
  assert.match(body.lead.homeownerEmail.reason, /neither/i);

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

/* ── the portal gate ──
   The review found the delivery path gated on consent while the portal was
   not, so every installer saw every lead ever captured — including people who
   ticked only the Terms. Nothing covered the portal; this does. */

test('the installer portal shows only leads that asked for quotes', async () => {
  /* Reads rather than submits. The tests above already created leads in both
     states, and /api/lead is limited to five submissions a minute — adding
     two more here tripped it and the failure looked like a portal bug. */
  const res = await realFetch(BASE + '/api/leads', { headers: { Authorization: 'Bearer test-pw' } });
  const { leads } = await res.json();

  assert.ok(leads.length > 0, 'earlier tests should have left at least one consented lead');
  assert.ok(leads.every(l => l.consent?.installerQuotes === true),
    'every lead in the portal must carry installer consent');

  // And the ones that declined really were captured — they are just not here.
  const stored = fs.readFileSync(path.join(process.env.FACETPRO_DATA_DIR, 'leads.jsonl'), 'utf8')
    .trim().split('\n').filter(Boolean).map(JSON.parse);
  const declined = stored.filter(l => l.consent?.installerQuotes !== true);
  assert.ok(declined.length > 0, 'declining leads should still be saved');
  const visible = new Set(leads.map(l => l.id));
  assert.ok(declined.every(l => !visible.has(l.id)), 'no declining lead may appear in the portal');
});

test('redacted leads are not served to installers', async () => {
  // Retention strips personal data but leaves the row; there is nothing in one
  // an installer can act on.
  const res = await realFetch(BASE + '/api/leads', { headers: { Authorization: 'Bearer test-pw' } });
  const { leads } = await res.json();
  assert.ok(leads.every(l => !l.redacted), 'redacted rows should be filtered out');
});

test('the wording submitted is the wording displayed', async () => {
  // Two copies of the consent text is how they drift, and the stored copy is
  // what makes the record evidence.
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const uses = (html.match(/CONSENT_WORDING\.(emailPack|installerQuotes|terms)/g) || []).length;
  assert.ok(uses >= 3, `each box should render from CONSENT_WORDING, found ${uses} uses`);
});
