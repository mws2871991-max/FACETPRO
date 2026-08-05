/* The homeowner's email, and the withdrawal link it carries.

   The design pack used to be the only email a homeowner ever received, and it
   only goes to people who ticked "email me my design". So somebody who ticked
   "get me quotes" and nothing else had their details sent to three companies
   and received nothing at all — no record of it, and no way to withdraw. The
   withdrawal route existed; the link never reached the person who needed it.

   That is the bug these tests exist to keep fixed, so the case that matters
   most here is the one where the design pack is NOT wanted. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const {test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3089;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.LEAD_CAPTURE = 'on';
process.env.RESEND_API_KEY = 'test-key-not-real';
process.env.LEAD_FROM_EMAIL = 'hello@facetpro.co.uk';
process.env.LEAD_NOTIFY_EMAIL = 'leads@facetpro.co.uk';
process.env.LEAD_RECIPIENTS = JSON.stringify([
  { id: 'anglian', name: 'Anglian', url: 'https://anglian.test/h' },
  { id: 'zenith', name: 'Zenith', url: 'https://zenith.test/h' },
]);

/* Resend is stubbed at the module level, so nothing leaves the machine and we
   can read exactly what would have been sent. */
const sent = [];
require.cache[require.resolve('resend')] = {
  exports: { Resend: class { constructor() { this.emails = { send: async (m) => { sent.push(m); return { data: { id: 'stub' } }; } }; } } },
};

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('.test/h')) return { ok: true, status: 200 };   // the buyers
  return realFetch(url, opts);
};

require('../server');

/* The server listens asynchronously. Against JSONL that is a tick; against
   Postgres it is a schema, and a fetch issued before the socket exists fails
   with "fetch failed". See test/helpers/server-ready.js. */
before(async () => { await require('./helpers/server-ready')(BASE); });

const HOMEOWNER = 'jane@example.com';
const save = async (consent) => {
  sent.length = 0;
  const res = await realFetch(`${BASE}/api/lead`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Jane', email: HOMEOWNER, postcode: 'SW11 4NP',
      claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', footprintM2: 100,
      consent: { terms: true, version: 'test', ...consent },
    }),
  });
  const body = await res.json().catch(() => ({}));
  await new Promise(r => setTimeout(r, 150));           // delivery runs after the response
  return { status: res.status, body, toHomeowner: sent.filter(m => m.to === HOMEOWNER) };
};

const WITHDRAW_LINK = /\/withdraw\?t=[A-Za-z0-9_-]{20,}/;

/* Each combination is submitted once and shared between the tests below.
   The lead endpoint allows five submissions a minute — deliberately, since it
   is the one endpoint a stranger can reach with a name and an email — and a
   test suite that quietly trips it looks exactly like a product bug. */
const once = new Map();
const saved = (label, consent) => {
  if (!once.has(label)) once.set(label, save(consent));
  return once.get(label);
};
const quotesOnly = () => saved('quotes', { installerQuotes: true, emailPack: false });
const bothBoxes  = () => saved('both',   { installerQuotes: true, emailPack: true });
const packOnly   = () => saved('pack',   { installerQuotes: false, emailPack: true });
const neither    = () => saved('none',   { installerQuotes: false, emailPack: false });

test('quotes but no design pack still gets a withdrawal link — the bug', async () => {
  const { status, toHomeowner } = await quotesOnly();
  assert.strictEqual(status, 200);
  assert.strictEqual(toHomeowner.length, 1, 'this person used to receive nothing at all');
  assert.match(toHomeowner[0].html, WITHDRAW_LINK, 'their details went to two companies; they need a way to stop it');
  assert.match(toHomeowner[0].text, WITHDRAW_LINK, 'text-only clients need it too');
});

test('and it names the installers who got their details', async () => {
  // "We will tell you which installers received your details" — the notice
  // says so, so it is in the email rather than only on request.
  const { toHomeowner } = await quotesOnly();
  assert.match(toHomeowner[0].html, /Anglian/);
  assert.match(toHomeowner[0].html, /Zenith/);
  assert.match(toHomeowner[0].text, /Anglian/);
});

test('it says what it is, and what it is not', async () => {
  const { toHomeowner } = await quotesOnly();
  assert.match(toHomeowner[0].subject, /enquiry/i);
  assert.match(toHomeowner[0].html, /not a marketing email/i,
    'unsolicited-looking mail needs to explain itself');
});

test('both boxes ticked is one email, not two', async () => {
  const { toHomeowner } = await bothBoxes();
  assert.strictEqual(toHomeowner.length, 1, 'two emails for one submission is spam');
  assert.match(toHomeowner[0].html, WITHDRAW_LINK);
  assert.match(toHomeowner[0].html, /Anglian/, 'the design pack names them too');
  assert.match(toHomeowner[0].subject, /design/i, 'the pack is the better of the two to send');
});

test('the design pack alone still carries the link', async () => {
  const { toHomeowner } = await packOnly();
  assert.strictEqual(toHomeowner.length, 1);
  assert.match(toHomeowner[0].html, WITHDRAW_LINK);
  assert.ok(!/Anglian/.test(toHomeowner[0].html), 'nothing was shared, so nobody is named');
});

test('neither box means no email — we were not asked for one', async () => {
  const { status, toHomeowner } = await neither();
  assert.strictEqual(status, 200, 'the design still saves');
  assert.strictEqual(toHomeowner.length, 0);
});

test('the token in the email is the one that opens the page', async () => {
  const { toHomeowner } = await quotesOnly();
  const link = toHomeowner[0].html.match(/https?:\/\/[^"]*\/withdraw\?t=([A-Za-z0-9_-]+)/)[1];
  const page = await realFetch(`${BASE}/withdraw?t=${link}`);
  assert.strictEqual(page.status, 200, 'a link in an email that 404s is worse than no link');
  const html = await page.text();
  assert.match(html, /Anglian/, 'and it names who received their details');
});

test('the form is told the box can be offered', async () => {
  const cfg = await (await realFetch(`${BASE}/api/config`)).json();
  assert.strictEqual(cfg.installerQuotes, true);
});

test('the design pack does not claim sharing when nobody covers them', async () => {
  /* The three-state fix was applied first to the "quotes, no design pack"
     branch and skipped the busier one: somebody who wants installers to call
     will usually also want their picture. The HTML said "They may contact
     you" with no list above it for "they" to refer to, and the text version
     said outright that we were passing details to installers who cover the
     area — for exactly the people nobody covered. */
  const emails = require('../emails');
  const price = { cladding: 1, roof: 1, trim: 1, scaffolding: 1, waste: 1, vat: 1, total: 6, footprintM2: 95,
    selections: { cladding: 'A', trim: 'B', roof: 'C' } };
  const lead = { id: 'LD-1', name: 'Jane', postcode: 'M1 1AE', consent: { installerQuotes: true, emailPack: true } };

  for (const [what, body] of [
    ['html', emails.designPackHtml(lead, price, 'https://facetpro.co.uk', 'tok', [])],
    ['text', emails.designPackText(lead, price, 'https://facetpro.co.uk', 'tok', [])],
  ]) {
    assert.match(body, /haven.t passed\s+your details to anyone|haven.t\s+passed your details to anyone/,
      `${what} should say plainly that nothing was shared`);
    assert.ok(!/They may contact you/.test(body), `${what} has no "they" to refer to`);
    assert.ok(!/installers who cover your area/.test(body), `${what} claims coverage that does not exist`);
  }
});

test('and still does, when somebody does cover them', async () => {
  const emails = require('../emails');
  const price = { cladding: 1, roof: 1, trim: 1, scaffolding: 1, waste: 1, vat: 1, total: 6, footprintM2: 95,
    selections: { cladding: 'A', trim: 'B', roof: 'C' } };
  const lead = { id: 'LD-1', name: 'Jane', consent: { installerQuotes: true, emailPack: true } };
  const html = emails.designPackHtml(lead, price, 'https://facetpro.co.uk', 'tok', [{ id: 'a', name: 'Anglian' }]);
  assert.match(html, /Anglian/);
  assert.match(html, /They may contact you/, 'now "they" has an antecedent');
});
