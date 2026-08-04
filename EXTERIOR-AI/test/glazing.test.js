/* Tests for per-unit window and door pricing. Run: npm test
   Plain node:test — no dependencies, no build step, consistent with the
   rest of the project.

   The fixtures are built from metres and converted to percentages, the same
   discipline measure.test.js uses: an arbitrary set of boxes can easily
   describe a house that could not exist, and a pricing bug hiding behind an
   impossible fixture is worse than no test. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const test = require('node:test');
const assert = require('node:assert');
const { estimateGlazing, _internals, MAX_WINDOWS } = require('../glazing');
const catalogue = require('../catalogue.json');

const RATES = catalogue.glazing;
const ASPECT_4_3 = 4 / 3;

/* A physically consistent 4:3 photo of a two-storey semi.
   Frame 10 m tall, so 13.33 m wide. House front 7 m x 6 m, ground level at
   y = 9.38 m. Door 0.9 x 1.98 sitting on the ground. Four windows at
   1.2 x 1.2 — two ground floor either side of the door, two directly above. */
const FRAME_H_M = 10;
const FRAME_W_M = FRAME_H_M * ASPECT_4_3;
const pctW = (m) => (m / FRAME_W_M) * 100;
const pctH = (m) => (m / FRAME_H_M) * 100;

const DOOR_Y = pctH(7.4);          // top of the door
const GROUND_WINDOW_Y = pctH(7.6); // just below the door head
const UPPER_WINDOW_Y = pctH(4.4);  // clearly above it

const win = (xM, yPct, wM = 1.2, hM = 1.2, confidence = 0.9) => ({
  type: 'window', x_pct: pctW(xM), y_pct: yPct,
  w_pct: pctW(wM), h_pct: pctH(hM), confidence,
});

const semiPhoto = [
  { type: 'cladding',   x_pct: pctW(3.2), y_pct: pctH(3.4), w_pct: pctW(7), h_pct: pctH(6), confidence: 0.9 },
  { type: 'door-front', x_pct: pctW(6.2), y_pct: DOOR_Y, w_pct: pctW(0.9), h_pct: pctH(1.98), confidence: 0.95 },
  win(4.0, GROUND_WINDOW_Y),
  win(8.0, GROUND_WINDOW_Y),
  win(4.0, UPPER_WINDOW_Y),
  win(8.0, UPPER_WINDOW_Y),
];

const base = (over = {}) => estimateGlazing({
  detections: semiPhoto,
  aspectRatio: ASPECT_4_3,
  houseType: 'semi',
  selections: { windowStyleId: 'casement', windowDoorColourId: 'white' },
  rates: RATES,
  ...over,
});

/* ── sizing ── */

test('sizes a window from the door reference to within a few centimetres', () => {
  const r = base();
  for (const w of r.windows) {
    assert.ok(Math.abs(w.widthM - 1.2) < 0.05, `width ${w.widthM} should be ~1.2 m`);
    assert.ok(Math.abs(w.heightM - 1.2) < 0.05, `height ${w.heightM} should be ~1.2 m`);
  }
});

test('a 1.2 x 1.2 window lands in the standard band', () => {
  const r = base();
  assert.ok(r.windows.every(w => w.bandId === 'standard'));
});

test('sizing is independent of how far away the photographer stood', () => {
  // Halve every dimension and every position: the same house, shot from
  // further back. The door shrinks with everything else, so metres hold.
  const shrink = (d) => ({ ...d,
    x_pct: d.x_pct / 2 + 25, y_pct: d.y_pct / 2 + 25,
    w_pct: d.w_pct / 2, h_pct: d.h_pct / 2 });
  const far = base({ detections: semiPhoto.map(shrink) });
  const near = base();
  assert.strictEqual(far.windowCount, near.windowCount);
  assert.ok(Math.abs(far.price.total - near.price.total) < 1);
});

/* ── storey detection ── */

test('separates ground-floor from upper-storey windows', () => {
  const r = base();
  assert.strictEqual(r.windows.filter(w => w.upperStorey).length, 2);
  assert.strictEqual(r.windows.filter(w => !w.upperStorey).length, 2);
});

test('a bungalow with no upper windows is not charged for access', () => {
  const bungalow = [
    semiPhoto[0], semiPhoto[1],
    win(4.0, GROUND_WINDOW_Y), win(8.0, GROUND_WINDOW_Y),
  ];
  const r = base({ detections: bungalow, houseType: 'bungalow' });
  assert.strictEqual(r.price.access, 0);
});

test('any upper-storey window brings in the access cost, once', () => {
  const r = base();
  assert.strictEqual(r.price.access, RATES.accessCost);
});

/* ── detection hygiene ── */

test('discards a duplicate box over the same window', () => {
  const dupe = [...semiPhoto, win(4.02, GROUND_WINDOW_Y, 1.18, 1.22)];
  const r = base({ detections: dupe });
  assert.strictEqual(r.frontCount, 4);
  assert.strictEqual(r.discarded.duplicates, 1);
});

test('discards a low-confidence detection', () => {
  const noisy = [...semiPhoto, win(11.0, GROUND_WINDOW_Y, 1.2, 1.2, 0.2)];
  assert.strictEqual(base({ detections: noisy }).frontCount, 4);
});

test('discards a box too small to be a window at scale', () => {
  const vent = [...semiPhoto, win(11.0, GROUND_WINDOW_Y, 0.2, 0.2)];
  const r = base({ detections: vent });
  assert.strictEqual(r.frontCount, 4);
  assert.strictEqual(r.discarded.implausible, 1);
});

/* ── fallback ── */

test('falls back to the house-type prior when no door was detected', () => {
  const noDoor = semiPhoto.filter(d => d.type !== 'door-front');
  const r = base({ detections: noDoor });
  assert.strictEqual(r.countSource, 'house_type_prior');
  assert.strictEqual(r.windowCount, 8);
  assert.strictEqual(r.frontCount, null);
});

test('the prior range is wider than the measured range', () => {
  const measured = base();
  const prior = base({ detections: semiPhoto.filter(d => d.type !== 'door-front') });
  const spread = (r) => (r.range.high - r.range.low) / r.price.total;
  assert.ok(spread(prior) > spread(measured));
});

test('always returns a usable estimate, even with nothing to go on', () => {
  const r = base({ detections: [], aspectRatio: null });
  assert.ok(r.price.total > 0);
  assert.strictEqual(r.countSource, 'house_type_prior');
});

/* ── what the market charges, as opposed to what we measured ── */

test('the market range brackets our own figure', () => {
  const r = base();
  assert.ok(r.marketRange, 'no market range at all');
  assert.ok(r.marketRange.low < r.price.total, 'somebody always undercuts us');
  assert.ok(r.marketRange.high > r.price.total, 'somebody always beats us');
});

test('the market range is far wider than our measurement error', () => {
  /* The whole argument of the site is that the spread between installers
     dwarfs any uncertainty about the size of the job. If this ever inverts,
     the page is claiming something its own numbers contradict. */
  const r = base();
  const ours = (r.range.high - r.range.low) / r.price.total;
  const market = (r.marketRange.high - r.marketRange.low) / r.price.total;
  assert.ok(market > ours * 2,
    `market spread ${market.toFixed(2)} should dwarf our own ${ours.toFixed(2)}`);
});

test('the market range comes off the middle, not off the ends of our range', () => {
  /* Compounding the two uncertainties would put the ceiling at 2.36x rather
     than 2x — a number nobody should be shown, let alone act on. */
  const r = base();
  const { MARKET_SPREAD } = require('../glazing');
  assert.strictEqual(r.marketRange.low, Math.round(r.price.total * MARKET_SPREAD.low));
  assert.strictEqual(r.marketRange.high, Math.round(r.price.total * MARKET_SPREAD.high));
});

test('the spread matches what the two installers were actually observed doing', () => {
  /* Derived in notes/glazing-rates-from-the-trade.md from a composite door
     (£1,800-£4,000 against our £2,000) and a 3-panel bifold (£3,500-£8,000
     against our £4,000). If somebody widens these for effect, this fails. */
  const { MARKET_SPREAD } = require('../glazing');
  assert.ok(MARKET_SPREAD.low >= 0.85 && MARKET_SPREAD.low <= 0.95,
    'the floor sits just under our price, per both observed products');
  assert.strictEqual(MARKET_SPREAD.high, 2.0,
    'both observed products topped out at double; do not inflate this');
});

/* ── whole-house scaling ── */

test('scales the measured front elevation to the whole house', () => {
  const r = base();
  // 4 front windows x 2.6 for a semi = 10.4, rounded to 10.
  assert.strictEqual(r.frontToTotal, 2.6);
  assert.strictEqual(r.windowCount, 10);
});

test('a mid-terrace scales less than a detached', () => {
  const terrace = base({ houseType: 'terrace' });
  const detached = base({ houseType: 'detached' });
  assert.ok(detached.windowCount > terrace.windowCount);
});

/* ── the homeowner's own count wins ── */

test('a typed window count overrides the photo', () => {
  const r = base({ windowCountOverride: 14 });
  assert.strictEqual(r.windowCount, 14);
  assert.strictEqual(r.countSource, 'manual_entry');
});

test('an implausible typed count is ignored, not clamped', () => {
  const r = base({ windowCountOverride: 4000 });
  assert.strictEqual(r.countSource, 'photo_door');
  assert.strictEqual(r.windowCount, 10);
});

test('never returns more windows than a house can have', () => {
  const many = [semiPhoto[0], semiPhoto[1]];
  for (let i = 0; i < 40; i++) many.push(win(0.2 + i * 0.31, GROUND_WINDOW_Y, 0.5, 0.6));
  const r = base({ detections: many });
  assert.ok(r.windowCount <= MAX_WINDOWS);
});

/* ── money ── */

test('style and colour move the price in the right direction', () => {
  const casement = base().price.total;
  const sash = base({ selections: { windowStyleId: 'sliding-sash', windowDoorColourId: 'white' } }).price.total;
  const anthracite = base({ selections: { windowStyleId: 'casement', windowDoorColourId: 'anthracite' } }).price.total;
  assert.ok(sash > casement, 'sliding sash should cost more than casement');
  assert.ok(anthracite > casement, 'a non-white frame should cost more than white');
});

test('adding a front door adds a per-leaf cost, not a per-m2 one', () => {
  const without = base().price;
  const withDoor = base({
    selections: { windowStyleId: 'casement', windowDoorColourId: 'white', doorStyleId: 'composite' },
  }).price;
  assert.strictEqual(without.doors, 0);
  assert.strictEqual(withDoor.doors, RATES.doors.find(d => d.id === 'composite').supplyFit);
});

test('VAT is 20% of everything else and shown separately', () => {
  const p = base().price;
  const net = p.total - p.vat;
  assert.ok(Math.abs(p.vat / net - 0.2) < 0.001);
});

test('a two-window job hits the minimum charge', () => {
  const r = base({ windowCountOverride: 1, selections: { windowStyleId: 'casement' } });
  assert.strictEqual(r.price.minimumApplied, true);
  assert.strictEqual(r.price.total, Math.round(RATES.minJobCharge * 1.2));
});

test('the total is the sum of the lines', () => {
  const p = base({ selections: { windowStyleId: 'casement', doorStyleId: 'composite' } }).price;
  const sum = p.supplyFit + p.doors + p.access + p.disposal + p.vat;
  assert.ok(Math.abs(p.total - sum) <= 2, `${p.total} vs ${sum}`);
});

test('an unknown band in the catalogue throws rather than pricing at zero', () => {
  assert.throws(() => _internals.priceGlazing({
    windows: [{ bandId: 'enormous', upperStorey: false }],
    totalCount: 1,
    selections: {},
    rates: RATES,
    houseType: 'semi',
  }), /No rate for window band/);
});

test('a plausible semi lands in a plausible range', () => {
  // Not a precision test — a tripwire. If a full semi ever prices below £3k
  // or above £30k, something upstream has broken.
  const t = base().price.total;
  assert.ok(t > 3000 && t < 30000, `£${t} is not a plausible semi`);
});
