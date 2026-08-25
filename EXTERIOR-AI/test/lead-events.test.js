/* The append-only account of what happened to a lead.

   From the August 2026 code audit: "when multiple installers can receive a
   lead, you need to prove exactly who was eligible, who received it, when they
   received it and whether the homeowner consented... keep the event IDs
   separate from mutable lead records."

   Everything else about a lead is mutable on purpose — withdrawal redacts the
   row, and should. That is the whole reason this exists beside it: redaction
   rewrites what a lead IS and leaves no account of what was DONE, and the
   second is what a buyer disputing an invoice, or the ICO asking what somebody
   agreed to, actually needs.

   The tests below are about the properties that make it an audit trail rather
   than a second log: it survives the erasure of its own subject, it carries no
   contact details, and it says which buyer, not how many. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

process.env.LEAD_CAPTURE = 'on';

const { test, before } = require('node:test');
const assert = require('node:assert');
const store = require('../store');
const wd = require('../withdrawal');

const PORT = 3216;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
/* Two buyers, so "which one" is a question with a wrong answer available.
   Both point at a closed port: delivery fails, which is the more interesting
   case — a failed delivery still has to be provable. */
process.env.LEAD_RECIPIENTS = JSON.stringify([
  { id: 'anglian', name: 'Anglian', url: 'https://127.0.0.1:9/hook', leadPrice: 100 },
  { id: 'zenith', name: 'Zenith', url: 'https://127.0.0.1:9/hook', leadPrice: 130 },
]);
require('./helpers/email').configureEmail();

const realFetch = globalThis.fetch;
require('../server');

before(async () => { await require('./helpers/server-ready')(BASE); });

const PERSON = {
  name: 'Jane Farrow', email: 'jane.farrow@example.com', phone: '07700 900123',
  postcode: 'SW11 4NP', claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
};

const submit = async (consent) => {
  const res = await realFetch(BASE + '/api/lead', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...PERSON, consent }),
  });
  return (await res.json()).lead;
};

const events = async (leadId) =>
  (await store.readAll('leadEvents')).filter(e => e.leadId === leadId);

const settle = () => new Promise(r => setTimeout(r, 500));

/* Delivery is fired without awaiting the response, and both buyers here point
   at a closed port — so each one spends three attempts and two backoffs before
   it gives up. A fixed sleep is either too short (which is what a 500 ms one
   was) or slows every run to the worst case. Poll instead: fast when the
   events land quickly, patient when they do not. */
async function waitFor(leadId, predicate, what, ms = 15000) {
  const deadline = Date.now() + ms;
  let seen = [];
  while (Date.now() < deadline) {
    seen = await events(leadId);
    if (predicate(seen)) return seen;
    await new Promise(r => setTimeout(r, 150));
  }
  assert.fail(`timed out waiting for ${what}; saw: ${seen.map(e => e.type).join(', ') || '(nothing)'}`);
}

const countOf = (type) => (list) => list.filter(e => e.type.startsWith(type)).length;

test('consent is recorded as its own event, with the wording version', async () => {
  const lead = await submit({ terms: true, installerQuotes: true, emailPack: true, version: 'v3' });
  await settle();

  const recorded = (await events(lead.id)).find(e => e.type === 'consent.recorded');
  assert.ok(recorded, 'no consent event');
  assert.strictEqual(recorded.detail.version, 'v3',
    'which wording they agreed to is the part that matters six years later');
  assert.strictEqual(recorded.detail.installerQuotes, true);
  assert.ok(recorded.eventId, 'every event carries its own id, separate from the lead');
});

test('the trail names which buyer, not how many', async () => {
  /* "delivered to 1 of 2" cannot answer an invoice dispute. Anglian pays £100
     and Zenith £130; the log has to say which one, and what they pay. */
  const lead = await submit({ terms: true, installerQuotes: true, emailPack: true, version: 'v3' });
  const all = await waitFor(lead.id, (l) => countOf('delivery.')(l) === 2,
    'both delivery events');

  const decided = all.find(e => e.type === 'routing.decided');
  assert.ok(decided, 'no routing decision recorded');
  assert.deepStrictEqual(decided.detail.chosen.slice().sort(), ['anglian', 'zenith']);
  assert.strictEqual(decided.detail.cap, 3, 'the consented cap is part of the decision');

  const perBuyer = all.filter(e => e.type.startsWith('delivery.'));
  assert.strictEqual(perBuyer.length, 2, 'one event per recipient, not one per lead');

  const anglian = perBuyer.find(e => e.detail.recipientId === 'anglian');
  const zenith = perBuyer.find(e => e.detail.recipientId === 'zenith');
  assert.ok(anglian && zenith, 'both buyers are named');
  assert.strictEqual(anglian.detail.leadPrice, 100, 'priced at the moment of delivery');
  assert.strictEqual(zenith.detail.leadPrice, 130);
});

test('a lead nobody consented to share leaves a positive record of that', async () => {
  const lead = await submit({ terms: true, installerQuotes: false, emailPack: true, version: 'v3' });
  await settle();

  const withheld = (await events(lead.id)).find(e => e.type === 'routing.withheld');
  assert.ok(withheld, 'refusing to share is a decision, and decisions are recorded');
  assert.match(withheld.detail.reason, /consent/i);
});

test('the trail carries no contact details — it is what happened, not who', async () => {
  /* This is what keeps the log outside the erasure path. If a name could reach
     it, withdrawal would have to choose between honouring the request and
     keeping its own evidence that it honoured it. */
  const lead = await submit({ terms: true, installerQuotes: true, emailPack: true, version: 'v3' });
  await settle();

  const serialised = JSON.stringify(await events(lead.id));
  for (const value of [PERSON.name, PERSON.email, PERSON.phone, PERSON.postcode]) {
    assert.ok(!serialised.includes(value),
      `"${value}" reached the audit trail, which erasure does not clean`);
  }
});

test('the trail survives the erasure of the lead it describes', async () => {
  /* The point of the whole table. After a full withdrawal the lead is redacted
     and its ancillary records are purged; what must remain is the account of
     what was done, or there is no way to show the request was honoured. */
  const lead = await submit({ terms: true, installerQuotes: true, emailPack: true, version: 'v3' });
  const before = await waitFor(lead.id, (l) => countOf('delivery.')(l) === 2,
    'the lead to finish being delivered before withdrawing it');
  assert.ok(before.length >= 3, 'expected consent, routing and delivery events');

  /* The raw token only ever exists in the email — the response never carries
     it, which is the point. Swap in one we know, exactly as the withdrawal
     tests do. */
  const { token, hash } = wd.newToken();
  const leads = await store.readAll('leads');
  await store.replaceAll('leads', leads.map(l => (l.id === lead.id ? { ...l, withdrawTokenHash: hash } : l)));

  const res = await realFetch(BASE + '/api/withdraw', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, scope: 'all' }),
  });
  assert.strictEqual(res.status, 200, await res.text());
  const after = await waitFor(lead.id, (l) => l.some(e => e.type === 'withdrawal.completed'),
    'the withdrawal event');
  assert.ok(after.length > before.length, 'the withdrawal is itself an event');

  const done = after.find(e => e.type === 'withdrawal.completed');
  assert.ok(done, 'no record that the request was honoured');
  assert.strictEqual(done.detail.scope, 'all');

  for (const earlier of before) {
    assert.ok(after.some(e => e.eventId === earlier.eventId),
      `event ${earlier.type} was erased along with the lead — the trail is append-only`);
  }

  /* And the lead itself really was redacted, so the test above is proving
     something rather than passing because nothing happened. */
  const leadRow = (await store.readAll('leads')).find(l => l.id === lead.id);
  assert.ok(!leadRow || leadRow.redacted, 'the lead should have been redacted');
});
