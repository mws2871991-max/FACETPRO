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

/* ── Findings 2 and 10, from the 27 September code review ── */

const fsFB = require('node:fs');
const pathFB = require('node:path');
const pageFB = fsFB.readFileSync(pathFB.join(__dirname, '..', 'index.html'), 'utf8');

test('a typed whole-house total is never labelled front only', () => {
  /* glazing nulls backCount for a manual_entry reading because there is no
     front/back split to report. A raw `backCount === null` therefore could not
     tell that apart from "front photographed, back question unanswered", and
     four places on the page called a whole-house figure "front only":
     "(front only)" in the sticky bar, "at the front" under the total, a "Back
     and sides not priced yet — add them" button for windows already in the
     price, and "This is the front only. The typical figure was for a whole
     house" — which understates the homeowner's own number against the
     typical, the one direction this site must never err in. */
  assert.match(pageFB, /function frontOnlyPrice\(g\) \{\s*return !!\(g && g\.seenOnly && g\.backCount === null && g\.countSource !== 'manual_entry'\);/,
    'the predicate has gone or stopped excluding a typed total');

  /* The four sites that could be reached with a manual_entry reading now ask
     the predicate. */
  assert.match(pageFB, /frontOnlyPrice\(glaz\) \? ' \(front only\)' : ''/, 'the sticky bar');
  assert.match(pageFB, /frontOnlyPrice\(g\) \? ' at the front' : ''/, 'the line under the total');
  assert.match(pageFB, /\(frontOnlyPrice\(g\) && !doorOnly\)/, 'the "add them" nudge');
  assert.match(pageFB, /if \(frontOnlyPrice\(state\.glazing\)\) \{/, 'the typical-figure comparison');

  /* The raw null survives in exactly one other place, and legitimately: the
     back-and-sides panel, which is not rendered for a typed total at all. Pin
     that gate, because it is what makes the raw reads inside it safe — if
     frontAndBack is ever called unguarded, three more sites start lying. */
  const calls = [...pageFB.matchAll(/frontAndBack\(g\)/g)];
  assert.strictEqual(calls.length, 1, 'frontAndBack is called from more than one place');
  const before = pageFB.slice(Math.max(0, calls[0].index - 90), calls[0].index);
  assert.match(before, /g\.seenOnly && g\.countSource !== 'manual_entry'\) \? $/,
    'the back-and-sides panel is no longer gated on the reading not being a typed total');
});

test('a wall area read by coverage is shown, and not called measured', () => {
  /* measure.js sizes a wall two ways. The door method measures the front
     elevation, so the summary could name it. The coverage method — used when
     no front door was found — calibrates frame coverage straight to a
     whole-house figure and leaves frontElevationM2 null, so the server records
     kind:'estimated' and the summary's `kind === 'measured'` lookup found
     nothing. The line vanished, and with it the only sight of the wall area
     the cladding price is built on — under a green "Sized to your home"
     badge. */
  const at = pageFB.indexOf("const sizedWall = wallsBasis.find");
  assert.ok(at > 0, 'the coverage wall line has gone');
  const block = pageFB.slice(at - 200, at + 500);
  assert.match(block, /kind === 'estimated' && \/\^photo_\/\.test/,
    'the fallback no longer restricts itself to a wall a photo produced');
  assert.match(block, /sized from your photo rather than measured/,
    'a coverage figure is being presented as a measurement');
  /* And it must not claim a front wall it never measured. */
  assert.ok(!/sizedWall\.m2\} m² of front wall/.test(block),
    'a coverage figure is being called front wall');
});

test('coverage is the no-door case, so the summary already says the door is missing', () => {
  /* The honesty of the new line rests on this: measureByCoverage only runs
     when no door was found, and the same summary lists what it could not pick
     out. If that list ever stopped naming the door, "sized from your photo"
     would be the only hint that nothing was measured. */
  const m = fsFB.readFileSync(pathFB.join(__dirname, '..', 'measure.js'), 'utf8');
  assert.match(m, /Only used when no door was found/, 'coverage is no longer the no-door fallback');
  assert.match(pageFB, /if \(!hits\(\/door\/i\)\.length\) missing\.push\('a front door'\)/,
    'the summary no longer reports a missing front door');
});
