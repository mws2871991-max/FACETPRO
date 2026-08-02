/* Conservatory styles. Guide price ranges, not a computed quote — the only
   server-side logic is resolving a style from our own catalogue so a lead
   can't attach an invented price to itself. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const catalogue = require('../catalogue.json');

const PORT = 3093;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
/* Installer-quotes consent is refused unless we can email the homeowner —
   that is where the withdrawal link lives — so email is made to look
   configured. Nothing is sent; the stub records it. */
require('./helpers/email').configureEmail();

const realFetch = globalThis.fetch;
require('../server');

const post = async (path, body) => {
  const res = await realFetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};
const lead = (extra) => post('/api/lead', {
  name: 'Jane', email: 'jane@example.com',
  claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
  consent: { terms: true, installerQuotes: true, version: 'v' },
  ...extra,
});

test('all eight styles are present and complete', () => {
  const styles = catalogue.conservatories.styles;
  assert.strictEqual(styles.length, 8);
  for (const s of styles) {
    assert.ok(s.id && s.name, 'needs an id and name');
    assert.ok(s.priceMin > 0 && s.priceMax > s.priceMin, `${s.id}: range should ascend`);
    assert.ok(s.lightPct > 0 && s.lightPct <= 100, `${s.id}: light % out of range`);
    assert.ok(s.description && s.bestFor && s.footprint, `${s.id}: missing display copy`);
    assert.ok(Array.isArray(s.pros) && s.pros.length, `${s.id}: needs pros`);
    assert.ok(Array.isArray(s.cons) && s.cons.length, `${s.id}: needs cons`);
  }
});

test('the catalogue keeps saying these prices are not sourced', () => {
  // The whole UI treatment rests on this being a placeholder range rather
  // than a real quote. The provenance now lives in internalNote — it names
  // internal files, so it is stripped from the public response — while `note`
  // is what a customer could see. Both must keep carrying the caveat.
  assert.match(catalogue.conservatories.internalNote, /placeholder|estimated/i);
  assert.match(catalogue.conservatories.internalNote, /not sourced|NOT sourced/i);
  assert.match(catalogue.conservatories.note, /guide/i,
    'the customer-facing note must still say these are guide ranges');
});

test('the ordering matches the story the copy tells', () => {
  const by = Object.fromEntries(catalogue.conservatories.styles.map(s => [s.id, s]));
  // Lean-to is pitched as the cheapest, orangery as the most expensive.
  const cheapest = Math.min(...Object.values(by).map(s => s.priceMin));
  const dearest = Math.max(...Object.values(by).map(s => s.priceMax));
  assert.strictEqual(by['lean-to'].priceMin, cheapest);
  assert.strictEqual(by['orangery'].priceMax, dearest);
  // Garden Room has a tiled roof, so it must not claim the most light.
  const maxLight = Math.max(...Object.values(by).map(s => s.lightPct));
  assert.ok(by['garden-room'].lightPct < maxLight, 'a tiled roof should not top the light scale');
  assert.strictEqual(by['t-shaped'].lightPct, maxLight);
});

test('the styles reach the front end via /api/catalogue', async () => {
  const res = await realFetch(BASE + '/api/catalogue');
  const body = await res.json();
  assert.ok(body.conservatories, 'served to the client');
  assert.strictEqual(body.conservatories.styles.length, 8);
  assert.ok(!('internalNote' in body), 'internal provenance still stripped');
});

test('a chosen style is attached to the lead, priced from our catalogue', async () => {
  const { status, body } = await lead({ conservatoryStyleId: 'victorian' });
  assert.strictEqual(status, 200);
  const c = body.lead.conservatory;
  const source = catalogue.conservatories.styles.find(s => s.id === 'victorian');
  assert.strictEqual(c.id, 'victorian');
  assert.strictEqual(c.name, source.name);
  assert.strictEqual(c.priceMin, source.priceMin);
  assert.strictEqual(c.priceMax, source.priceMax);
  assert.strictEqual(c.indicative, true);
});

test('a client cannot invent a conservatory price', async () => {
  const { body } = await lead({
    conservatoryStyleId: 'lean-to',
    conservatory: { id: 'lean-to', name: 'Free one', priceMin: 1, priceMax: 2 },
  });
  const source = catalogue.conservatories.styles.find(s => s.id === 'lean-to');
  assert.strictEqual(body.lead.conservatory.priceMin, source.priceMin);
  assert.notStrictEqual(body.lead.conservatory.name, 'Free one');
});

test('an unknown style leaves the lead clean rather than guessing', async () => {
  const { body } = await lead({ conservatoryStyleId: 'sun-lounge-deluxe' });
  assert.strictEqual(body.lead.conservatory, null);
});

/* Deliberately one lead submission, not two. /api/lead is rate limited to 5
   per minute per IP, and an earlier version of this file made seven — the
   limiter correctly refused the last ones and the test failed on a missing
   body. Compare against /api/quote instead of a second lead. */
test('conservatory interest does not disturb the main quote', async () => {
  const withInterest = await lead({ conservatoryStyleId: 'orangery', footprintM2: 95 });
  assert.strictEqual(withInterest.status, 200, 'expected a lead, not a rate-limit refusal');
  assert.strictEqual(withInterest.body.lead.conservatory.id, 'orangery');

  const quote = await post('/api/quote', {
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', footprintM2: 95,
  });
  assert.strictEqual(withInterest.body.lead.price, quote.body.total,
    'the cladding quote must be unchanged by a conservatory preference');
});
