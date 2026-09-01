/* A measured house is not an exact house.

   The homepage says the estimate is a range, and says why: two installers
   quote the same job differently, and the photo-to-area step has never been
   checked against a surveyed property. Then the panel printed £47,475 to the
   pound as soon as a photograph had been measured, because resolveFootprint
   returned `exact: true` for the door method and `range: null` followed from
   it. The range appeared only *before* the house had been looked at, which is
   exactly backwards — it vanished at the moment the page started claiming to
   have measured something.

   measure.js had already computed the band. It returns `low` and `high`
   alongside `m2`, wider when its door reading and its coverage reading
   disagree, and that band was being thrown away.

   Every UX brief from 27 August onward asked for "a realistic range rather
   than false precision" and I read it as already handled five times, because a
   range does exist and I checked for its existence rather than for when it is
   shown. These tests pin *when*, which is the part that was wrong.

   The three cases are genuinely different and each has its own reason:

     no photograph  → range, from the ±25% around the house-type prior
     measured photo → range, from measure.js's own band on the reading
     typed by hand  → exact, because it is their number and the Terms say the
                      manual entry overrides everything

   That last one is not an oversight. A homeowner who types 120 m² has told us
   the area; widening it would be second-guessing the one input we promised to
   respect. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3243;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'test-key-not-used-for-a-real-call';

/* A house with a front door, so the door method fires and produces a band.
   Geometry chosen to be an ordinary detached elevation rather than anything
   the measurer treats as a special case. */
const HOUSE = [
  { type: 'door-front', label: 'Front Door',  confidence: 0.95, x_pct: 45, y_pct: 58, w_pct: 7,  h_pct: 22 },
  { type: 'cladding',   label: 'Brick Wall',  confidence: 0.92, x_pct: 2,  y_pct: 25, w_pct: 96, h_pct: 62 },
  { type: 'roof',       label: 'Main Roof',   confidence: 0.94, x_pct: 3,  y_pct: 2,  w_pct: 94, h_pct: 26 },
  { type: 'window',     label: 'Window 1',    confidence: 0.9,  x_pct: 12, y_pct: 32, w_pct: 12, h_pct: 12 },
  { type: 'window',     label: 'Window 2',    confidence: 0.9,  x_pct: 68, y_pct: 32, w_pct: 12, h_pct: 12 },
  { type: 'window',     label: 'Window 3',    confidence: 0.9,  x_pct: 12, y_pct: 60, w_pct: 14, h_pct: 14 },
];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    // Same shape as the other detect stubs in this suite, including
    // stop_reason — the endpoint checks it to catch a truncated answer.
    return {
      ok: true, status: 200,
      json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(HOUSE) }] }),
    };
  }
  return realFetch(url, opts);
};

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

// A 1x1 JPEG is enough: the model call is stubbed, so only the bytes' hash and
// the decode path are exercised.
const PIXEL = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==';

const quote = async (body) => {
  const res = await realFetch(`${BASE}/api/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claddingId: 'clay-stone', trimId: 'ink-trim', roofId: 'slate-roof', ...body }),
  });
  assert.strictEqual(res.status, 200);
  return res.json();
};

const sane = (r, where) => {
  assert.ok(r, `${where}: expected a range`);
  assert.ok(Number.isFinite(r.low) && Number.isFinite(r.high), `${where}: range must be numbers`);
  assert.ok(r.high > r.low, `${where}: a range whose ends are equal is a single number wearing a dash`);
  assert.ok(r.low > 0, `${where}: a price cannot start at or below zero`);
};

test('with no photograph the estimate is a range around the house type', async () => {
  const q = await quote({ houseType: 'detached' });
  assert.strictEqual(q.footprintSource, 'house_type_prior');
  assert.strictEqual(q.exact, false, 'a typical figure is never exact');
  sane(q.range, 'house-type prior');
});

test('a measured photograph is still a range — this is the one that regressed', async () => {
  const det = await (await realFetch(`${BASE}/api/detect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: PIXEL, mimeType: 'image/jpeg' }),
  })).json();

  assert.ok(det.detectionId, 'the stub should have produced a detection');
  assert.ok(det.canMeasure, 'a front door and a wall is a measurable elevation');

  /* The measurement is attached to the detection record by /api/measure, which
     the client now calls automatically on upload — see autoMeasure(). Before
     that it was two opt-ins deep and almost nobody reached this path at all. */
  const m = await (await realFetch(`${BASE}/api/measure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ detectionId: det.detectionId, houseType: 'detached' }),
  })).json();
  assert.ok(Number.isFinite(m.m2), 'the door method should have produced an area');
  assert.ok(m.high > m.low, 'and a band around it — this is what the estimate range is built from');

  const q = await quote({ detectionId: det.detectionId, houseType: 'detached' });

  assert.match(q.footprintSource, /^photo_/, 'this must be the measured path, not a fallback');
  assert.strictEqual(q.exact, false,
    'a photograph measured against an uncalibrated door reference is not an exact figure');
  sane(q.range, 'measured photo');

  /* The point of the change: the total must sit inside the band rather than
     being replaced by it, so the itemisation and the headline still agree. */
  assert.ok(q.total >= q.range.low && q.total <= q.range.high,
    `the computed total ${q.total} should fall inside its own range ${q.range.low}–${q.range.high}`);
});

test('a figure the homeowner typed is exact, because the Terms say it overrides', async () => {
  const q = await quote({ houseType: 'detached', footprintM2: 120 });
  assert.strictEqual(q.footprintSource, 'manual_entry');
  assert.strictEqual(q.exact, true, 'their own number is not ours to widen');
  assert.strictEqual(q.range, null);
  assert.ok(q.total > 0);
});

test('the panel picks its layout on whether the house was seen, not on exactness', () => {
  /* buildPricePanel used to branch on `exact`, which was the same question
     while only a measured photo was exact. It is not the same question any
     more: a measured photo is now inexact, and branching on it would have sent
     somebody who had just uploaded a photograph back to the pre-photo panel —
     house-type picker, "typical semi", "not yours yet, add a photo above" —
     underneath the photo they had added. */
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

  assert.match(html, /const seenTheHouse = \/\^\(photo_\|manual_entry\)\//,
    'the panel must branch on the footprint source');
  assert.match(html, /if \(!seenTheHouse\) \{/,
    'and use it to choose the pre-photo panel');
  assert.ok(!/if \(!exact && range\) \{/.test(html),
    'the old exactness branch would strand a measured house in the pre-photo panel');
});
