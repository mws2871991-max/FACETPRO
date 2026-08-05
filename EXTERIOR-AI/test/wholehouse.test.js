/* Whole-house finishes: a walls-only path priced from the catalogue's
   illustrative finish rates. Runs offline — no AI call is involved. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const {test, before } = require('node:test');
const assert = require('node:assert');
const catalogue = require('../catalogue.json');

const PORT = 3094;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'test-pw';
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
require('../server');

/* The server listens asynchronously. Against JSONL that is a tick; against
   Postgres it is a schema, and a fetch issued before the socket exists fails
   with "fetch failed". See test/helpers/server-ready.js. */
before(async () => { await require('./helpers/server-ready')(BASE); });

const post = async (body) => {
  const res = await realFetch(BASE + '/api/whole-house', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

test('the catalogue still carries the whole-house data', () => {
  const wh = catalogue.wholeHouse;
  assert.ok(wh, 'wholeHouse section present');
  assert.strictEqual(wh.finishes.length, 8);
  assert.strictEqual(wh.roofColours.length, 4);
  assert.strictEqual(wh.windowColours.length, 4);
  for (const f of wh.finishes) {
    assert.ok(f.pricePerM2 > 0, `${f.id} needs a price`);
    assert.ok(f.hex && f.name && f.bestFor, `${f.id} needs display data`);
  }
});

test('each finish prices differently, in the order its rates imply', async () => {
  const totals = {};
  for (const f of catalogue.wholeHouse.finishes) {
    const { status, body } = await post({ finishId: f.id, areaM2: 95 });
    assert.strictEqual(status, 200);
    totals[f.id] = body.total;
    assert.strictEqual(body.finish.id, f.id);
  }
  // Stone (£95/m²) is the dearest, render (£45/m²) the cheapest.
  assert.ok(totals['stone-cladding'] > totals['brick-slips']);
  assert.ok(totals['brick-slips'] > totals['timber-clad']);
  assert.ok(totals['timber-clad'] > totals['white-render']);
});

test('the area is clamped to the sane range rather than trusted', async () => {
  const wh = catalogue.wholeHouse;
  const tooSmall = await post({ finishId: 'white-render', areaM2: 5 });
  const tooBig = await post({ finishId: 'white-render', areaM2: 100000 });
  const negative = await post({ finishId: 'white-render', areaM2: -50 });
  assert.strictEqual(tooSmall.body.areaM2, wh.areaMinM2);
  assert.strictEqual(tooBig.body.areaM2, wh.areaMaxM2);
  assert.strictEqual(negative.body.areaM2, wh.areaMinM2);
});

test('missing or nonsense input falls back instead of erroring', async () => {
  for (const body of [{}, { finishId: 'nope' }, { finishId: 'white-render', areaM2: 'abc' }]) {
    const { status, body: r } = await post(body);
    assert.strictEqual(status, 200);
    assert.ok(r.total > 0 && Number.isFinite(r.total), `total was ${r.total}`);
    assert.ok(r.finish.id, 'always resolves to a real finish');
  }
});

test('the price is recomputed server-side, never taken from the client', async () => {
  const { body } = await post({ finishId: 'white-render', areaM2: 95, total: 1, materials: 1, pricePerM2: 1 });
  const expected = catalogue.wholeHouse.finishes.find(f => f.id === 'white-render').pricePerM2 * 95;
  assert.strictEqual(body.materials, Math.round(expected));
  assert.ok(body.total > 1000, `client-sent total must be ignored, got ${body.total}`);
});

test('the response is flagged illustrative and carries the catalogue caveat', async () => {
  const { body } = await post({ finishId: 'brick-slips', areaM2: 95 });
  assert.strictEqual(body.illustrative, true);
  // The note returned to the client is the customer-facing one — the detailed
  // provenance names internal files and is stripped. It must still say the
  // prices are indicative and point at the sourced visualiser, since these
  // finish rates differ from the real cladding catalogue.
  assert.match(body.note, /indicative|illustrative|guide/i);
  assert.match(body.note, /visualizer|visualiser/i);
  assert.ok(!body.note.includes('.py'), 'no internal file names in a public response');
});

test('the build-up uses the same rates as the main quote', async () => {
  const { body } = await post({ finishId: 'white-render', areaM2: 100 });
  assert.strictEqual(body.labour, Math.round(catalogue.labour.claddingPerM2 * 100));
  assert.strictEqual(body.scaffolding, Math.round(catalogue.scaffoldingCost));
  assert.strictEqual(body.waste, Math.round(body.materials * catalogue.wastePct));
  assert.strictEqual(body.vat, Math.round((body.materials + body.labour + body.scaffolding + body.waste) * catalogue.vatPct));
  const sum = body.materials + body.labour + body.scaffolding + body.waste + body.vat;
  assert.ok(Math.abs(body.total - sum) <= 2, `total ${body.total} vs parts ${sum}`);
});

test('it is walls only — cheaper than the full quote for the same area', async () => {
  // The main quote covers roof and roofline too. If whole-house ever exceeded
  // it, the "walls only" framing in the UI would be misleading.
  const wholeHouse = await post({ finishId: 'stone-cladding', areaM2: 95 });
  const full = await realFetch(BASE + '/api/quote', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', footprintM2: 95 }),
  }).then(r => r.json());
  assert.ok(wholeHouse.body.total < full.total,
    `walls-only ${wholeHouse.body.total} should be below the full quote ${full.total}`);
});

test('roof and window colours are echoed back for display', async () => {
  const { body } = await post({ finishId: 'white-render', roofColourId: 'black', windowColourId: 'anthracite' });
  assert.strictEqual(body.roofColour.id, 'black');
  assert.strictEqual(body.windowColour.id, 'anthracite');
  assert.ok(body.roofColour.hex && body.windowColour.hex);

  const fallback = await post({ finishId: 'white-render', roofColourId: 'chartreuse' });
  assert.strictEqual(fallback.body.roofColour.id, catalogue.wholeHouse.roofColours[0].id);
});
