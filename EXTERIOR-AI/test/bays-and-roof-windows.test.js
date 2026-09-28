'use strict';

require('./helpers/data-dir');

/* Number 14, photographed 28 September: a yellow-brick Edwardian mid-terrace
   with two white-painted bays, two flat sashes and a dormer. These are the
   live detections for it, as /api/detect returned them.

   It priced on four windows: both bays thrown away as implausible (their
   boxes include the cornice, columns and sill, so 3.6–3.9 m "tall"), and the
   neighbour's roof window, cut by the left edge of the photo, counted as the
   customer's. */
const test = require('node:test');
const assert = require('node:assert');
const glazing = require('../glazing');
const rates = require('../catalogue.json').glazing;
const detections = require('./fixtures/edwardian-14-detections.json');

const estimate = () => glazing.estimateGlazing({
  detections, aspectRatio: 0.75, houseType: 'terrace', rates,
  selections: { windowStyleId: 'sliding-sash', windowDoorColourId: 'chartwell-green' },
  seenOnly: true, backCount: null,
});

test('both bays are counted, and priced as bays', () => {
  const r = estimate();
  assert.strictEqual(r.frontCount, 5, 'two bays, two flat sashes and the dormer');
  assert.strictEqual(r.discarded.implausible, 0);
  assert.strictEqual(r.windows.filter(w => w.isBay).length, 2);
});

test('a bay is measured across, and its height is said to be typical', () => {
  const r = estimate();
  for (const w of r.windows.filter(x => x.isBay)) {
    assert.ok(w.widthM > 2 && w.widthM < 4, `bay width ${w.widthM}`);
    assert.strictEqual(w.heightM, 2);
    assert.strictEqual(w.heightAssumed, true);
  }
  assert.strictEqual(r.bayHeightsAssumed, 2);
  const line = glazing.windowBasis(r, { backCountSource: 'not priced' }).lines[0];
  assert.match(line, /Bay widths measured; heights typical/);
});

test("the neighbour's roof window, cut by the photo's edge, is not the customer's", () => {
  const c = glazing._internals.windowCandidates(detections);
  assert.strictEqual(c.neighbours, 1);
  assert.strictEqual(glazing.frontWindowCount(detections), 5);
});

test('our own dormer, in the middle of the photo, is still counted', () => {
  const c = glazing._internals.windowCandidates(detections);
  assert.ok(c.kept.some(k => k.b.x === 53 && k.b.y === 0), 'the dormer went missing');
});

test('a window at the edge but below the roofline is not assumed to be next door', () => {
  const d = detections.concat([{ type: 'window', label: 'Window', confidence: 0.8, x_pct: 0, y_pct: 30, w_pct: 7, h_pct: 15 }]);
  assert.strictEqual(glazing._internals.windowCandidates(d).neighbours, 1);
});

test('a single box called a bay is a bay', () => {
  const d = [{ type: 'window', label: 'Ground Floor Bay Window', confidence: 0.9, x_pct: 40, y_pct: 50, w_pct: 30, h_pct: 25 }];
  assert.strictEqual(glazing._internals.windowCandidates(d).bays, 1);
});
