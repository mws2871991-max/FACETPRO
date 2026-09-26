/* Front and back, priced separately (seenOnly).

   The photograph shows the front. With seenOnly the estimate prices what it
   shows and nothing else, until the homeowner tells us how many windows are
   at the back and sides. No front x 2.6 for elevations nobody has seen. */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const { estimateGlazing } = require('../glazing');
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


test('seenOnly prices the four front windows and nothing else', () => {
  const r = base({ seenOnly: true });
  assert.strictEqual(r.frontCount, 4);
  assert.strictEqual(r.windowCount, 4);
  assert.strictEqual(r.seenOnly, true);
  assert.strictEqual(r.backCount, null, 'back and sides are not priced, not zero');
  assert.strictEqual(r.frontToTotal, null, 'no multiplier is applied or reported');
});

test('without seenOnly the old front-to-total scaling still applies', () => {
  const r = base();
  assert.ok(r.windowCount > 4, `expected scaling above the front count, got ${r.windowCount}`);
  assert.strictEqual(r.seenOnly, false);
});

test('a back-and-sides count is added to the front, and zero is a real answer', () => {
  const withBack = base({ seenOnly: true, backCount: 5 });
  assert.strictEqual(withBack.windowCount, 9);
  assert.strictEqual(withBack.backCount, 5);
  const none = base({ seenOnly: true, backCount: 0 });
  assert.strictEqual(none.windowCount, 4);
  assert.strictEqual(none.backCount, 0);
});

test('more windows costs more: front plus back is dearer than the front alone', () => {
  const front = base({ seenOnly: true });
  const all = base({ seenOnly: true, backCount: 5 });
  assert.ok(all.range.low > front.range.low && all.range.high > front.range.high);
});

test('an implausible back count is ignored rather than priced', () => {
  const r = base({ seenOnly: true, backCount: 900 });
  assert.strictEqual(r.backCount, null);
  assert.strictEqual(r.windowCount, 4);
});

test('a typed total still beats everything', () => {
  const r = base({ seenOnly: true, backCount: 5, windowCountOverride: 12 });
  assert.strictEqual(r.windowCount, 12);
  assert.strictEqual(r.countSource, 'manual_entry');
  assert.strictEqual(r.backCount, null);
});

test('with no windows in the photo, the house-type figure is unchanged by seenOnly', () => {
  const r = estimateGlazing({ detections: [], houseType: 'semi', selections: { windowStyleId: 'casement', windowDoorColourId: 'white' }, rates: RATES, seenOnly: true });
  assert.strictEqual(r.countSource, 'house_type_prior');
  assert.strictEqual(r.seenOnly, false);
});
