/* Withdrawing consent.

   The privacy notice promises four things, and each one is a test here: that
   withdrawing is as easy as agreeing was, that the link in the email works,
   that we tell the installers who already have the details, and that we can
   tell the homeowner which installers those were.

   The two that would be easy to get quietly wrong are the ones about copies.
   Erasing the lead while leaving a delivery-failure record holding the same
   name, email and phone number would look like erasure and not be one. And a
   withdrawal notice has to go to whoever actually received the lead, which is
   not the same list as whoever is configured to receive one today. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const wd = require('../withdrawal');
const { redactLead, classifyLead, PERIODS, DAY } = require('../retention');

const PORT = 3095;
const BASE = `http://127.0.0.1:${PORT}`;
const DATA = process.env.FACETPRO_DATA_DIR;

process.env.PORT = String(PORT);
process.env.LEAD_CAPTURE = 'on';
process.env.LEAD_RECIPIENTS = JSON.stringify([{ id: 'anglian', name: 'Anglian', url: 'https://buyer.test/hook' }]);
/* Installer-quotes consent is refused unless we can email the homeowner —
   that is where the withdrawal link lives — so email is made to look
   configured. Nothing is sent; the stub records it. */
require('./helpers/email').configureEmail();

/* The buyer is stubbed, so nothing leaves the machine and we can read exactly
   what we would have sent them. */
const posted = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('buyer.test')) { posted.push(JSON.parse(opts.body)); return { ok: true, status: 200 }; }
  return realFetch(url, opts);
};

const store = require('../store');
require('../server');

/* ── the policy, without a server ── */

test('the token is never stored in the form that opens the link', () => {
  const { token, hash } = wd.newToken();
  assert.notStrictEqual(token, hash);
  assert.strictEqual(hash, wd.hashToken(token));
  assert.ok(token.length >= 32, 'needs enough randomness to be unguessable');
  // Which means a stored record cannot be turned back into a working link.
  assert.ok(!wd.findByToken([{ id: 'x', withdrawTokenHash: hash }], hash));
  assert.ok(wd.findByToken([{ id: 'x', withdrawTokenHash: hash }], token));
});

test('a token belonging to an erased record is spent', () => {
  const { token, hash } = wd.newToken();
  assert.strictEqual(wd.findByToken([{ id: 'x', withdrawTokenHash: hash, redacted: true }], token), null);
});

test('rubbish tokens are refused without throwing', () => {
  const leads = [{ id: 'x', withdrawTokenHash: wd.hashToken('real') }, { id: 'y' }, null];
  for (const bad of ['', null, undefined, 'short', 'x'.repeat(500), {}, []]) {
    assert.strictEqual(wd.findByToken(leads, bad), null, JSON.stringify(bad));
  }
});

test('each consent is withdrawn on its own — they were given separately', () => {
  const lead = { id: 'LD-1', name: 'Jane', consent: { terms: true, installerQuotes: true, emailPack: true } };
  const noEmail = wd.applyWithdrawal(lead, 'emailPack', { now: 'T1' });
  assert.strictEqual(noEmail.consent.emailPack, false);
  assert.strictEqual(noEmail.consent.installerQuotes, true, 'withdrawing one must not withdraw the other');
  assert.strictEqual(noEmail.name, 'Jane', 'they did not ask to be forgotten');

  const noShare = wd.applyWithdrawal(noEmail, 'installerQuotes', { now: 'T2' });
  assert.strictEqual(noShare.consent.installerQuotes, false);
  assert.strictEqual(noShare.withdrawals.length, 2, 'both decisions are on the record');
  assert.deepStrictEqual(noShare.withdrawals.map(w => w.scope), ['emailPack', 'installerQuotes']);
});

test('withdrawing does not mutate the lead it was given', () => {
  const lead = { id: 'LD-1', consent: { installerQuotes: true } };
  wd.applyWithdrawal(lead, 'installerQuotes', { now: 'T1' });
  assert.strictEqual(lead.consent.installerQuotes, true, 'the original must be untouched');
});

test('erasure keeps the evidence and drops the person', () => {
  const lead = {
    id: 'LD-1', ts: '2026-01-01T00:00:00Z', name: 'Jane', email: 'jane@example.com',
    phone: '07700900000', postcode: 'SW11 4NP', price: 28783,
    consent: { terms: true, installerQuotes: true, at: '2026-01-01T00:00:00Z', wording: { terms: 'I agree…' } },
  };
  const r = wd.applyWithdrawal(lead, 'all', { now: 'T1', redactLead });
  const serialised = JSON.stringify(r);
  for (const v of ['Jane', 'jane@example.com', '07700900000', 'SW11 4NP']) {
    assert.ok(!serialised.includes(v), `"${v}" survived erasure`);
  }
  assert.strictEqual(r.redacted, true);
  assert.strictEqual(r.withdrawTokenHash, null, 'the link must not work twice');
  assert.strictEqual(r.consent.wording.terms, 'I agree…', 'what they agreed to is the one thing we must keep');
  assert.strictEqual(r.consent.installerQuotes, false);
  assert.strictEqual(r.withdrawals[0].scope, 'all');
});

test('an unknown scope is refused rather than guessed at', () => {
  assert.ok(!wd.isScope('everything'));
  assert.throws(() => wd.applyWithdrawal({ id: 'x' }, 'everything', {}), /unknown withdrawal scope/);
  assert.throws(() => wd.applyWithdrawal({ id: 'x' }, 'all', {}), /redactLead is required/);
});

test('the installers we notify are the ones who received it, not the ones configured today', () => {
  const deliveries = [
    { leadId: 'LD-1', ts: 'T', results: [{ id: 'anglian', name: 'Anglian', ok: true, at: 'T' },
                                         { id: 'broken', name: 'Broken', ok: false }] },
    { leadId: 'LD-1', ts: 'T2', results: [{ id: 'gone', name: 'Departed Buyer', ok: true, at: 'T2' }] },
    { leadId: 'LD-2', ts: 'T', results: [{ id: 'other', name: 'Other', ok: true }] },
  ];
  const got = wd.recipientsWhoReceived(deliveries, 'LD-1').map(r => r.id);
  assert.deepStrictEqual(got, ['anglian', 'gone']);
  assert.ok(!got.includes('broken'), 'a failed delivery means they never had it');
  assert.ok(!got.includes('other'), 'that was somebody else');
  assert.deepStrictEqual(wd.recipientsWhoReceived([], 'LD-1'), []);
});

test('a recipient is only listed once however many times we sent to them', () => {
  const rows = [
    { leadId: 'LD-1', results: [{ id: 'a', name: 'A', ok: true }] },
    { leadId: 'LD-1', results: [{ id: 'a', name: 'A', ok: true }] },
  ];
  assert.strictEqual(wd.recipientsWhoReceived(rows, 'LD-1').length, 1);
});

test('the notice we send carries no personal data — they already hold it', () => {
  const p = wd.withdrawalPayload('LD-1', 'all', 'T');
  assert.strictEqual(p.erasureRequested, true);
  assert.deepStrictEqual(Object.keys(p).sort(), ['at', 'erasureRequested', 'leadId', 'message', 'scope', 'type']);
  assert.strictEqual(wd.withdrawalPayload('LD-1', 'installerQuotes', 'T').erasureRequested, false,
    'stopping the sharing is not the same as asking them to erase');
});

/* ── retention, once a withdrawal has happened ── */

test('an already-redacted lead is not redacted again on every run', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const ago = (d) => new Date(now - d * DAY).toISOString();
  const erased = { id: 'LD-1', ts: ago(400), redacted: true, redactedAt: ago(200), consent: { at: ago(400) } };
  assert.strictEqual(classifyLead(erased, now), 'keep', 'nothing left to strip');
  const old = { ...erased, ts: ago(2300), consent: { at: ago(2300) } };
  assert.strictEqual(classifyLead(old, now), 'delete', 'but it still goes at six years');
});

test('withdrawing installer consent shortens how long we keep it', () => {
  const now = Date.parse('2026-08-01T00:00:00Z');
  const ago = (d) => new Date(now - d * DAY).toISOString();
  const shared = { id: 'LD-1', ts: ago(300), consent: { installerQuotes: true, at: ago(300) } };
  assert.strictEqual(classifyLead(shared, now), 'keep', 'shared enquiries run to 24 months');
  const withdrawn = wd.applyWithdrawal(shared, 'installerQuotes', { now: ago(1) });
  assert.strictEqual(classifyLead(withdrawn, now), 'redact',
    'once they have withdrawn, the six-month design-only period applies again');
});

test('redaction keeps the withdrawal, not just the consent', () => {
  const withdrawn = wd.applyWithdrawal(
    { id: 'LD-1', ts: 'T', name: 'Jane', consent: { installerQuotes: true, at: 'T' } },
    'installerQuotes', { now: 'T2' });
  const r = redactLead(withdrawn);
  assert.strictEqual(r.withdrawals.length, 1, 'the half most likely to be asked about later');
  assert.strictEqual(r.withdrawnAt, 'T2');
});

/* ── the routes ── */

const jsonPost = async (path, body) => {
  const res = await realFetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// One lead, reused by the route tests below — the lead endpoint allows five a
// minute and there is nothing here that needs a second one.
const makeLead = async () => {
  const { body } = await jsonPost('/api/lead', {
    name: 'Jane Doe', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', footprintM2: 100,
    consent: { terms: true, installerQuotes: true, emailPack: true, version: 'test' },
  });
  await new Promise(r => setTimeout(r, 200));      // delivery happens after the response
  // Swap in a token we know, since the raw one only ever existed in the email.
  const { token, hash } = wd.newToken();
  const leads = await store.readAll('leads');
  await store.replaceAll('leads', leads.map(l => (l.id === body.lead.id ? { ...l, withdrawTokenHash: hash } : l)));
  return { lead: body.lead, token };
};

test('the hash never leaves the server', async () => {
  const { lead } = await makeLead();
  assert.ok(!('withdrawTokenHash' in lead), 'not to the browser');
  assert.ok(posted.length, 'the buyer should have received the lead');
  assert.ok(!('withdrawTokenHash' in posted[0]), 'not to the installer');
  const stored = (await store.readAll('leads')).find(l => l.id === lead.id);
  assert.ok(stored.withdrawTokenHash, 'but it is kept');
});

test('the page names the installers who received the details', async () => {
  const { token } = await makeLead();
  const res = await realFetch(`${BASE}/withdraw?t=${token}`);
  const html = await res.text();
  assert.strictEqual(res.status, 200);
  assert.ok(html.includes('Anglian'), 'we promised to tell them who has it');
  assert.ok(html.includes('Delete everything'), 'erasure must be offered, not just described');
  assert.strictEqual(res.headers.get('referrer-policy'), 'no-referrer', 'the token is in the URL');
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});

test('a wrong token gives nothing away', async () => {
  const res = await realFetch(`${BASE}/withdraw?t=${'x'.repeat(32)}`);
  assert.strictEqual(res.status, 404);
  const html = await res.text();
  assert.ok(!html.includes('Anglian') && !/LD-\d/.test(html), 'no reference, no installer, no confirmation it exists');
  const post = await jsonPost('/api/withdraw', { token: 'x'.repeat(32), scope: 'all' });
  assert.strictEqual(post.status, 404);
});

test('a GET never withdraws anything — mail scanners open every link', async () => {
  const { lead, token } = await makeLead();
  await realFetch(`${BASE}/withdraw?t=${token}`);
  const after = (await store.readAll('leads')).find(l => l.id === lead.id);
  assert.strictEqual(after.consent.installerQuotes, true, 'opening the page must change nothing');
  assert.ok(!after.withdrawals, 'and record nothing');
});

test('withdrawing sharing tells the installers who already had it', async () => {
  const { lead, token } = await makeLead();
  const before = posted.length;
  const res = await jsonPost('/api/withdraw', { token, scope: 'installerQuotes' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.recipientsNotified, 1);

  const notice = posted[before];
  assert.strictEqual(notice.type, 'consent_withdrawn');
  assert.strictEqual(notice.leadId, lead.id);
  assert.strictEqual(notice.erasureRequested, false);
  assert.ok(!JSON.stringify(notice).includes('jane@example.com'), 'a withdrawal notice repeating their email would be an odd way to honour one');

  const after = (await store.readAll('leads')).find(l => l.id === lead.id);
  assert.strictEqual(after.consent.installerQuotes, false);
  assert.strictEqual(after.name, 'Jane Doe', 'they asked us to stop sharing, not to forget them');

  const logged = (await store.readAll('withdrawals')).filter(w => w.leadId === lead.id);
  assert.strictEqual(logged.length, 1, 'a withdrawal is a record we have to be able to produce');
  assert.strictEqual(logged[0].recipientsNotified[0].ok, true);
});

test('erasure reaches the copies, the render and the ancillary records', async () => {
  const { lead, token } = await makeLead();
  const renderId = 'wtest' + lead.id.replace(/\W/g, '');
  await store.putRender(renderId, Buffer.from([1, 2, 3]), { mime: 'image/png' });
  const leads = await store.readAll('leads');
  await store.replaceAll('leads', leads.map(l => (l.id === lead.id ? { ...l, renderUrl: `/r/${renderId}` } : l)));
  // A failed delivery keeps its own copy of the contact details, so that one
  // can be chased by hand. Erasure has to reach it.
  await store.append('notificationFailures', {
    ts: new Date().toISOString(), kind: 'lead-notification', leadId: lead.id,
    name: 'Jane Doe', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
  });

  const before = posted.length;
  const res = await jsonPost('/api/withdraw', { token, scope: 'all' });
  assert.strictEqual(res.status, 200);
  assert.strictEqual(posted[before].erasureRequested, true, 'the installers are asked to erase too');

  const after = (await store.readAll('leads')).find(l => l.id === lead.id);
  assert.strictEqual(after.redacted, true);
  assert.ok(after.consent, 'the agreement survives; the person does not');
  const serialised = JSON.stringify(after);
  for (const v of ['Jane Doe', 'jane@example.com', '07700900000', 'SW11 4NP']) {
    assert.ok(!serialised.includes(v), `"${v}" survived on the lead`);
  }

  const failures = (await store.readAll('notificationFailures')).filter(f => f.leadId === lead.id);
  assert.ok(failures.length, 'the row stays, so the count still reconciles');
  for (const f of failures) {
    assert.ok(!f.name && !f.email && !f.phone, 'but not the contact details');
    assert.strictEqual(f.erased, true);
  }
  const deliveries = (await store.readAll('deliveries')).filter(d => d.leadId === lead.id);
  for (const d of deliveries) assert.ok(!d.name && !d.email, 'nor in the delivery log');

  assert.strictEqual(await store.getRender(renderId), null, 'an image of their house is not "everything else"');

  const reuse = await jsonPost('/api/withdraw', { token, scope: 'all' });
  assert.strictEqual(reuse.status, 404, 'the link is spent');
});

test('an unknown scope is refused by the route too', async () => {
  // Checked before the token is looked up, so this needs no lead — and the
  // lead endpoint only allows five a minute.
  for (const scope of ['everything', '', null, '__proto__', 'consent']) {
    const res = await jsonPost('/api/withdraw', { token: wd.newToken().token, scope });
    assert.strictEqual(res.status, 400, `scope "${scope}" should be refused`);
  }
});

test('the design pack carries a link that works', async () => {
  const emails = require('../emails');
  const price = { cladding: 1, roof: 1, trim: 1, scaffolding: 1, waste: 1, vat: 1, total: 6, footprintM2: 95,
    selections: { cladding: 'A', trim: 'B', roof: 'C' } };
  const { token } = wd.newToken();
  const html = emails.designPackHtml({ id: 'LD-1', name: 'Jane' }, price, `http://127.0.0.1:${PORT}`, token);
  const href = html.match(/href="([^"]*withdraw[^"]*)"/)?.[1];
  assert.ok(href, 'the notice promises a link in the email');
  const res = await realFetch(href.replace(/&amp;/g, '&'));
  assert.strictEqual(res.status, 404, 'a token for no lead, but the route is real and reachable');
});
