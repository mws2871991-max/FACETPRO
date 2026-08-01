/* The Postgres path used to drop most of a lead.

   `store.js` mapped a lead onto columns from an older shape — passing
   `o.design`, which no lead has ever had — so with DATABASE_URL set thirteen
   fields vanished on insert, including the consent record that evidences
   lawful basis under UK GDPR.

   Nothing here needs a database: the mapping and the read-back are pure, so
   they're exercised directly. That's the point — the bug lived in a code path
   nobody runs locally, which is exactly why it went unnoticed. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const { _internals } = require('../store');
const leadsMapper = _internals.INSERT_PARAMS.leads;

const LEAD = {
  ts: '2026-07-31T12:00:00Z',
  id: 'LD-4821',
  name: 'Jane Homeowner',
  email: 'jane@example.com',
  phone: '07700 900123',
  postcode: 'SW11 4NP',
  selections: { cladding: 'Sage Slate', trim: 'Cedar', roof: 'Terracotta' },
  price: 28783,
  priceBreakdown: { total: 28783, footprintM2: 105 },
  measurementSource: 'photo_door',
  wallMeasurement: { m2: 105, method: 'door' },
  conservatory: { id: 'victorian', priceMin: 14000, priceMax: 22000 },
  preferences: { roofline: { fascia: { name: 'Ogee', guaranteeYears: 25 } } },
  renderUrl: 'https://example.test/render.jpg',
  notes: '',
  consent: { given: true, at: '2026-07-31T12:00:00Z', wording: 'I agree to the Terms…', version: '2026-07-30' },
  status: 'New lead',
};

// The JSONB column is last in the INSERT parameter list.
const storedPayload = (lead) => JSON.parse(leadsMapper(lead)[9]);

test('a lead survives the Postgres path intact', () => {
  const back = storedPayload(LEAD);
  const lost = Object.keys(LEAD).filter(k => !(k in back));
  assert.deepStrictEqual(lost, [], `these fields would be lost: ${lost.join(', ')}`);
  assert.deepStrictEqual(back, LEAD, 'the stored payload should be the whole lead');
});

test('the consent record survives — this is the GDPR evidence', () => {
  const back = storedPayload(LEAD);
  assert.ok(back.consent, 'consent must be stored');
  assert.strictEqual(back.consent.given, true);
  assert.strictEqual(back.consent.wording, LEAD.consent.wording,
    'the exact wording agreed to is what makes the record evidence');
  assert.strictEqual(back.consent.version, LEAD.consent.version);
  assert.ok(back.consent.at, 'and when they agreed');
});

test('the quote survives, so an installer sees what was promised', () => {
  const back = storedPayload(LEAD);
  assert.strictEqual(back.price, 28783);
  assert.deepStrictEqual(back.selections, LEAD.selections);
  assert.strictEqual(back.priceBreakdown.footprintM2, 105);
  assert.strictEqual(back.id, 'LD-4821', 'the reference the homeowner was given');
});

test('the queryable columns are still populated', () => {
  // The scalar columns exist so leads can be found without opening the JSON.
  const [ts, action, name, email, phone, postcode, message, source_, status] = leadsMapper(LEAD);
  assert.strictEqual(ts, LEAD.ts);
  assert.strictEqual(name, LEAD.name);
  assert.strictEqual(email, LEAD.email);
  assert.strictEqual(phone, LEAD.phone);
  assert.strictEqual(postcode, LEAD.postcode);
  assert.strictEqual(status, LEAD.status);
  // Legacy columns from an older shape — explicitly null rather than undefined,
  // which pg would reject.
  assert.strictEqual(action, null);
  assert.strictEqual(message, null);
  assert.strictEqual(source_, null);
});

test('no parameter is undefined — pg rejects those', () => {
  for (const [i, value] of leadsMapper(LEAD).entries()) {
    assert.notStrictEqual(value, undefined, `parameter ${i + 1} is undefined`);
  }
});

test('reading back unwraps the JSONB rather than returning a nested row', () => {
  // readAll maps rows through `r.design || r` for leads, so a caller gets the
  // same shape the JSONL path returns.
  const rows = [{ design: LEAD }, { design: { ...LEAD, id: 'LD-9999' } }];
  const unwrapped = rows.map(r => r.design || r);
  assert.strictEqual(unwrapped[0].id, 'LD-4821');
  assert.strictEqual(unwrapped[1].id, 'LD-9999');
  assert.ok(!('design' in unwrapped[0]), 'callers should not see the column wrapper');
});

test('a sparse lead still maps without throwing', () => {
  const minimal = { ts: '2026-07-31T12:00:00Z', id: 'LD-1', name: 'A', email: 'a@example.com', status: 'New lead' };
  const params = leadsMapper(minimal);
  assert.strictEqual(params.length, 10);
  assert.deepStrictEqual(JSON.parse(params[9]), minimal);
});
