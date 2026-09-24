/* The Postgres path used to drop most of a lead.

   `store.js` mapped a lead onto columns from an older shape — passing
   `o.design`, which no lead has ever had — so with DATABASE_URL set thirteen
   fields vanished on insert, including the consent record that evidences
   lawful basis under UK GDPR.

   Nothing here needs a database: the mapping and the read-back are pure, so
   they're exercised directly. That's the point — the bug lived in a code path
   nobody runs locally, which is exactly why it went unnoticed. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

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
  assert.strictEqual(params.length, 11);
  assert.deepStrictEqual(JSON.parse(params[9]), minimal);
  // The reference also goes in its own column, so the database can refuse a
  // duplicate rather than letting one lead silently overwrite another.
  assert.strictEqual(params[10], 'LD-1');
});

/* ── Every table that can be written must be writable ── */

test('every INSERT_SQL table has a parameter builder', () => {
  /* The structural guard, and the reason this test exists rather than one
     about lead events specifically.

     leadEvents had INSERT_SQL and SELECT_SQL and no INSERT_PARAMS entry, so
     record('leadEvents', …) threw "INSERT_PARAMS[table] is not a function" on
     every write with DATABASE_URL set. It went unseen for two reasons that
     will both recur: the file backend used in development writes by a
     different path and was always fine, and leadEvent() swallows its failures
     on purpose, because an audit trail that can fail a lead is worse than one
     with a gap in it.

     So the next table added to INSERT_SQL without its builder fails here,
     loudly, on a machine with no Postgres. */
  const { INSERT_SQL, INSERT_PARAMS, FILE_NAMES } = _internals;
  for (const table of Object.keys(INSERT_SQL)) {
    assert.strictEqual(typeof INSERT_PARAMS[table], 'function',
      `${table} can be written on the file backend and would throw on Postgres`);
    assert.ok(FILE_NAMES[table], `${table} has no file-backend name either`);
  }
});

test('a parameter builder supplies exactly what its SQL asks for', () => {
  /* The other half: present but wrong arity is the same outage, later. */
  const { INSERT_SQL, INSERT_PARAMS } = _internals;
  const sample = {
    ts: '2026-09-24T00:00:00.000Z', eventId: 'e1', leadId: 'l1', type: 'consent.recorded',
    detail: {}, id: 'x', design: {}, record: {}, name: 'n', email: 'e', phone: 'p',
    postcode: 'pc', message: 'm', source: 's', status: 'new', action: 'a',
    installerId: 'i', sessionId: 'sess', rating: 5, elementCount: 1, mimeType: 'image/jpeg',
    comment: 'c', role: 'r', products: [], notes: '', timeline: 't', type_: 't',
  };
  for (const [table, sql] of Object.entries(INSERT_SQL)) {
    const wanted = new Set((sql.match(/\$\d+/g) || []));
    const built = INSERT_PARAMS[table](sample);
    assert.strictEqual(built.length, wanted.size,
      `${table}: SQL takes ${wanted.size} parameters, the builder returns ${built.length}`);
  }
});

test('a consent event carries the lawful basis it is evidence of', () => {
  /* Not a shape test for its own sake. This row is what answers "what did
     this person agree to" — the detail must survive the trip, not be dropped
     the way thirteen lead fields once were. */
  const { INSERT_PARAMS } = _internals;
  const detail = { shareWithInstallers: true, wording: 'v2', ip: undefined };
  const row = INSERT_PARAMS.leadEvents({
    ts: '2026-09-24T00:00:00.000Z', eventId: 'e1', leadId: 'l1',
    type: 'consent.recorded', detail,
  });
  assert.strictEqual(row[3], 'consent.recorded');
  assert.deepStrictEqual(JSON.parse(row[4]), { shareWithInstallers: true, wording: 'v2' });

  /* An event with no lead yet — routing withheld before one exists — still
     writes, with a null rather than a crash. */
  const orphan = INSERT_PARAMS.leadEvents({ ts: 't', eventId: 'e2', type: 'routing.withheld' });
  assert.strictEqual(orphan[2], null);
  assert.strictEqual(orphan[4], '{}');
});
