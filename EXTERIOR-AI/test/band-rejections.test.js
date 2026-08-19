/* The measurements the house-type band threw away.
 *
 * measure.js refuses any computed area outside a plausible range for the
 * declared house type and falls back to the typical figure. That is the right
 * behaviour — a wildly wrong number presented confidently is the worst thing
 * this system can do — but the observation written afterwards recorded the
 * answer we gave, not the answer we rejected: method 'prior', and the prior's
 * own m². The rejected figure existed only as English inside a notes string.
 *
 * So the one table built to answer "where should these bounds sit?" was
 * sampling only the cases where they did not fire. The bounds are five
 * judgements about five kinds of house, and nothing that could revise them was
 * being kept. geometry.js already gets this right for door shapes, and says so
 * in as many words — the rejects are the interesting half.
 *
 * Which side matters as much as the value. Above the ceiling usually means the
 * scale reference was too small — a door leaf read without its frame. Below
 * the floor usually means it was too large, which is the garage-door and
 * sidelight case. Opposite fixes, in different files.
 */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const { estimateWallArea, HOUSE_TYPE_PRIORS } = require('../measure');
const store = require('../store');

const ASPECT_4_3 = 4 / 3;
const FRAME_H_M = 10;
const FRAME_W_M = FRAME_H_M * ASPECT_4_3;
const pctW = (m) => (m / FRAME_W_M) * 100;
const pctH = (m) => (m / FRAME_H_M) * 100;

/* The same house at different apparent sizes. The door stays 1.98 m, so
   scaling the wall alone is exactly the failure the band exists to catch: a
   front elevation that cannot belong to the house type claimed. */
const photo = (scale) => [
  { type: 'cladding',   x_pct: pctW(3.2), y_pct: pctH(3.4), w_pct: pctW(7 * scale), h_pct: pctH(6 * scale), confidence: 0.9 },
  { type: 'door-front', x_pct: pctW(6.2), y_pct: pctH(7.4), w_pct: pctW(0.9), h_pct: pctH(1.98), confidence: 0.95 },
];

const measure = (scale, houseType) =>
  estimateWallArea({ detections: photo(scale), aspectRatio: ASPECT_4_3, houseType });

test('a figure too large for the house type is kept, not just refused', () => {
  const r = measure(2, 'detached');
  const [lo, hi] = HOUSE_TYPE_PRIORS.detached.band;

  assert.strictEqual(r.method, 'prior', 'the band should have refused this and fallen back');
  assert.ok(r.observed.rejected, 'the refused figure was thrown away');
  assert.strictEqual(r.observed.rejected.side, 'above');
  assert.ok(r.observed.rejected.m2 >= hi, `${r.observed.rejected.m2} m² is not above the ${lo}–${hi} band`);
  /* The method that produced the rejected figure, which is never the method
     that ends up answering — that one is always 'prior' once the band fires.
     Without this the table cannot tell a bad door reading from a bad coverage
     reading, and they are fixed in different places. */
  assert.strictEqual(r.observed.rejected.method, 'door');
  assert.deepStrictEqual([r.observed.rejected.lo, r.observed.rejected.hi], [lo, hi],
    'the bounds it failed against are not recorded, so the row cannot be read later');
});

test('a figure too small for the house type is kept too', () => {
  /* The half that matters most. An under-measurement quotes low, and a quote
     that is too low is the one nobody complains about until the installer
     arrives. */
  const r = measure(0.5, 'detached');
  const [lo] = HOUSE_TYPE_PRIORS.detached.band;

  assert.strictEqual(r.method, 'prior');
  assert.ok(r.observed.rejected, 'the refused figure was thrown away');
  assert.strictEqual(r.observed.rejected.side, 'below');
  assert.ok(r.observed.rejected.m2 <= lo, `${r.observed.rejected.m2} m² is not below ${lo}`);
});

test('a measurement the band accepted records no rejection', () => {
  /* The common path. A rejection field that is populated on every row would
     make the count meaningless. */
  const r = measure(1, 'semi');
  assert.notStrictEqual(r.method, 'prior', 'this fixture should measure cleanly');
  assert.strictEqual(r.observed.rejected, null);
});

test('every house type has a band with a floor as well as a ceiling', () => {
  /* One-sided bands were the earlier state of this, and a one-sided band is
     silently biased: it catches over-estimates and lets under-estimates
     through, so every error it misses quotes low. */
  for (const [key, prior] of Object.entries(HOUSE_TYPE_PRIORS)) {
    assert.ok(Array.isArray(prior.band) && prior.band.length === 2, `${key} has no band`);
    const [lo, hi] = prior.band;
    assert.ok(Number.isFinite(lo) && lo > 0, `${key} has no lower bound`);
    assert.ok(hi > lo, `${key} band is inverted: ${lo}–${hi}`);
    assert.ok(prior.wallM2 > lo && prior.wallM2 < hi,
      `${key}'s own typical figure ${prior.wallM2} sits outside its band ${lo}–${hi}`);
  }
});

test('the rejected figure survives a round trip through the store', async () => {
  /* The wiring, which is the part that would silently not happen — measure.js
     can return this field perfectly while the store quietly drops it, and the
     evidence would be missing with nothing to show for it. */
  const before = (await store.readMeasurements(5000)).length;
  const r = measure(2, 'detached');

  await store.recordMeasurement({
    houseType: r.houseType,
    method: r.method,
    m2: r.m2,
    doorRatio: r.observed.doorRatio,
    doorHeightPct: r.observed.doorHeightPct,
    doorBoxes: r.observed.doorBoxes,
    rejected: r.observed.rejected,
  });

  const rows = await store.readMeasurements(5000);
  assert.strictEqual(rows.length, before + 1);
  const row = rows[0];
  assert.strictEqual(row.method, 'prior', 'the answer given is still the prior');
  assert.strictEqual(Number(row.rejectedM2), r.observed.rejected.m2);
  assert.strictEqual(row.rejectedSide, 'above');
  assert.strictEqual(row.rejectedMethod, 'door');
});

test('a row with no rejection stores nulls, not zeroes', async () => {
  /* Number.isFinite(0) is true and 0 m² is a real-looking area. A rejection
     column defaulting to zero would put a fabricated observation in the one
     table that exists to be believed. */
  const r = measure(1, 'semi');
  await store.recordMeasurement({
    houseType: r.houseType, method: r.method, m2: r.m2,
    doorRatio: r.observed.doorRatio, doorHeightPct: r.observed.doorHeightPct,
    doorBoxes: r.observed.doorBoxes, rejected: r.observed.rejected,
  });
  const row = (await store.readMeasurements(5000))[0];
  assert.strictEqual(row.rejectedM2, null);
  assert.strictEqual(row.rejectedSide, null);
  assert.strictEqual(row.rejectedMethod, null);
});
