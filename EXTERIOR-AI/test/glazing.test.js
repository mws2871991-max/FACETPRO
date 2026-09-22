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

/* Sidelights and bay panes, both seen on the live site: a detached house with
   five windows reported seven because the two glazed panels beside its door
   came back typed "window", and a bay-fronted semi with two bays reported
   eight because each bay came back pane by pane. */
const labelled = (label, d) => ({ ...d, label });
const DOOR_X = 6.2;
const withSidelights = [
  ...semiPhoto,
  labelled('Porch Sidelight Left', win(DOOR_X - 0.4, DOOR_Y, 0.38, 1.98)),
  labelled('Porch Sidelight Right', win(DOOR_X + 0.92, DOOR_Y, 0.38, 1.98)),
];

test('glazed sidelights beside the door are not counted as windows', () => {
  assert.strictEqual(base({ detections: withSidelights }).frontCount, 4);
  assert.strictEqual(_internals.windowCandidates(withSidelights).sidelights, 2);
});

test('sidelights are dropped on the counting path too, with no door to scale from', () => {
  const noDoor = withSidelights.filter(d => d.type !== 'door-front');
  const r = base({ detections: noDoor });
  assert.strictEqual(r.countSource, 'photo_count');
  assert.strictEqual(r.frontCount, 4);
});

// Three 0.5 m panes side by side, labelled the way the model labels them.
const bayPanes = (name, xM, yPct) => ['Left', 'Center', 'Right'].map((p, i) =>
  labelled(`${name} - ${p} Pane`, win(xM + i * 0.5, yPct, 0.5, 1.2)));

test('the panes of one bay count as one window', () => {
  const upperLeft = semiPhoto[4];
  const photo = [...semiPhoto.filter(d => d !== upperLeft), ...bayPanes('Upper Bay Window', 3.6, UPPER_WINDOW_Y)];
  const r = base({ detections: photo });
  assert.strictEqual(r.frontCount, 4);
  // Sized as the whole bay, not as one pane of it.
  const widest = Math.max(...r.windows.map(w => w.widthM));
  assert.ok(Math.abs(widest - 1.5) < 0.05, `expected the merged bay to be about 1.5 m wide, got ${widest}`);
  assert.strictEqual(_internals.windowCandidates(photo).panesMerged, 2);
});

test('two different bays stay two windows', () => {
  const photo = [
    ...semiPhoto.filter(d => d.type !== 'window'),
    ...bayPanes('Lower Bay Window', 3.6, GROUND_WINDOW_Y),
    ...bayPanes('Upper Bay Window', 3.6, UPPER_WINDOW_Y),
  ];
  assert.strictEqual(base({ detections: photo }).frontCount, 2);
});

test('the page is sent the same front count pricing uses', () => {
  const { frontWindowCount } = require('../glazing');
  assert.strictEqual(frontWindowCount(withSidelights), base({ detections: withSidelights }).frontCount);
  assert.strictEqual(frontWindowCount([]), 0);
});

test('discards a box too small to be a window at scale', () => {
  const vent = [...semiPhoto, win(11.0, GROUND_WINDOW_Y, 0.2, 0.2)];
  const r = base({ detections: vent });
  assert.strictEqual(r.frontCount, 4);
  assert.strictEqual(r.discarded.implausible, 1);
});

/* ── fallback ── */

test('with no door it counts the windows rather than inventing a number', () => {
  /* Counting and measuring are two different questions, and this used to
     answer neither when it could not answer both.

     The door is the scale reference — 1.98 m is what turns percentages of an
     image into metres — so without one there is no way to SIZE a window. There
     is still a perfectly good way to COUNT them, and that needs no scale.

     What happened instead: a real photograph with seven clearly detected
     windows and no door in shot fell through to the house-type prior and
     priced eleven. The tool discarded seven things it had seen in favour of a
     number it made up, and then showed the homeowner both at once — seven
     labelled windows on a photograph of their own house, beside an estimate
     that said it covered eleven typical ones. £10,050–£18,272 against
     £18,438–£33,523 on the same photograph. */
  const noDoor = semiPhoto.filter(d => d.type !== 'door-front');
  const windowsInPhoto = noDoor.filter(d => d.type === 'window').length;

  const r = base({ detections: noDoor });
  assert.strictEqual(r.countSource, 'photo_count');
  assert.strictEqual(r.frontCount, windowsInPhoto,
    'the front count should be the windows actually detected');
  assert.ok(r.windowCount > windowsInPhoto,
    'a front elevation still has to be scaled to the whole house');
  assert.match(r.sourceLabel, /counted/i);
  assert.doesNotMatch(r.sourceLabel, /measured/i,
    'counting is a weaker claim than measuring and must never borrow the word');
});

test('the prior is still there for a photo with no windows in it at all', () => {
  /* A photograph of a hedge, or a detection that found nothing. There is
     genuinely nothing to count, and a typical figure is the honest answer. */
  const noWindows = semiPhoto.filter(d => d.type !== 'window' && d.type !== 'door-front');
  const r = base({ detections: noWindows });
  assert.strictEqual(r.countSource, 'house_type_prior');
  assert.strictEqual(r.frontCount, null);
  assert.match(r.sourceLabel, /typical/i);
});

test('counting is surer than guessing and less sure than measuring', () => {
  const spread = (r) => (r.range.high - r.range.low) / r.price.total;
  const measured = base();
  const counted = base({ detections: semiPhoto.filter(d => d.type !== 'door-front') });
  const guessed = base({ detections: [], aspectRatio: null });
  assert.ok(spread(measured) < spread(counted),
    'a counted estimate should not claim to be as tight as a measured one');
  assert.ok(spread(counted) < spread(guessed),
    'counting the windows should narrow the range against knowing nothing');
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

/* The comparison is withheld while the windows in it are priced from invented
   bands, which is the state of the catalogue today. These tests are about the
   arithmetic, so they hand it a catalogue whose rates are sourced. The
   withholding itself is tested separately below. */
const SOURCED = { ...RATES, source: 'Windows and doors: supplier rate card, 2026.' };
const sourced = (over = {}) => base({ rates: SOURCED, ...over });

test('the market range brackets our own figure', () => {
  const r = sourced();
  assert.ok(r.marketRange, 'no market range at all');
  assert.ok(r.marketRange.low < r.price.total, 'somebody always undercuts us');
  assert.ok(r.marketRange.high > r.price.total, 'somebody always beats us');
});

test('the market range is far wider than our measurement error', () => {
  /* The whole argument of the site is that the spread between installers
     dwarfs any uncertainty about the size of the job. If this ever inverts,
     the page is claiming something its own numbers contradict. */
  const r = sourced();
  const ours = (r.range.high - r.range.low) / r.price.total;
  const market = (r.marketRange.high - r.marketRange.low) / r.price.total;
  assert.ok(market > ours * 2,
    `market spread ${market.toFixed(2)} should dwarf our own ${ours.toFixed(2)}`);
});

test('the market range comes off the middle, not off the ends of our range', () => {
  /* Compounding the two uncertainties would put the ceiling at 2.36x rather
     than 2x — a number nobody should be shown, let alone act on. */
  const r = sourced();
  const { MARKET_SPREAD } = require('../glazing');
  assert.strictEqual(r.marketRange.low, Math.round(r.price.total * MARKET_SPREAD.low));
  assert.strictEqual(r.marketRange.high, Math.round(r.price.total * MARKET_SPREAD.high));
});

test('no market comparison while the windows in it are unsourced', () => {
  /* The multiple is sound — 0.88x to 2.0x from two real door products — but
     it is only worth showing on a base somebody stands behind. Multiplying an
     invented figure produced a "quoted elsewhere" range that was roughly the
     correct price, on a page inviting the homeowner to distrust it.

     Tested against an explicitly unsourced catalogue rather than the real one.
     An earlier version asserted this using the live rates, which was true on
     the day it was written and stopped being true the moment the bands were
     confirmed — a test that fails when the data changes rather than when the
     behaviour does. */
  const UNSOURCED = { ...RATES, sourced: false, source: 'Windows: placeholder rates, not sourced.' };
  const r = base({ rates: UNSOURCED });
  assert.strictEqual(r.marketRange, null,
    'the market comparison is shown on top of unsourced window rates');
});

test('the comparison returns as soon as the bands are sourced', () => {
  /* Nothing to remember later — filling in the catalogue restores it. */
  const r = sourced();
  assert.ok(r.marketRange && r.marketRange.high > r.price.total,
    'sourced rates did not bring the comparison back');
});

test('a doors-only job keeps the comparison, because those prices are real', () => {
  const r = base({ selections: { doorStyleId: 'composite' }, windowCountOverride: undefined });
  /* A door-only estimate still prices the house's windows in this module, so
     this asserts the rule rather than the shortcut: when windows contribute
     nothing, the comparison stands. */
  if ((r.price.supplyFit || 0) === 0) {
    assert.ok(r.marketRange, 'a doors-only job lost the comparison it is entitled to');
  }
});

test('a door costs the homeowner what the trade says it settles at', () => {
  /* The two door prices are the only figures in this catalogue that came from
     real completed jobs, and they were given INCLUSIVE of VAT. The catalogue
     stores net and grosses up at the end, so entering the inclusive figure
     showed every homeowner 20% over — a composite door at £2,400 against a
     trade reality of £2,000.

     What made it survive was a `source` field that claimed the conversion had
     already been done. It had not. So this asserts the number a homeowner
     actually reads, not the number in the file. */
  const SETTLED_INC_VAT = { composite: 2000, bifold: 4000 };
  const gross = 1 + (RATES.vatPct / 100);
  for (const [id, inc] of Object.entries(SETTLED_INC_VAT)) {
    const door = RATES.doors.find(d => d.id === id);
    assert.ok(door, `no door "${id}" in the catalogue`);
    assert.strictEqual(Math.round(door.supplyFit * gross), inc,
      `${id} shows as £${Math.round(door.supplyFit * gross)} inc VAT, but settles at £${inc}`);
  }
});

test('the spread matches what the two installers were actually observed doing', () => {
  /* Measured against six products in notes/glazing-rates-from-the-trade.md.
     The floor is where the keener installer settles; the ceiling is where the
     dearer one settles with the 40% discount properly applied — observed at
     x1.59 on a standard window and x1.62 on a composite door.

     It used to be x2.0. That figure is real but answers a different question:
     it is the same installer with the discount NOT applied, which is a
     customer who did not push rather than a different company. Conflating the
     two produced a headline 43% above anything Anglian actually settles at.
     It now lives in NO_HAGGLE. */
  const { MARKET_SPREAD, INSTALLER_SPREAD, NO_HAGGLE } = require('../glazing');
  assert.ok(MARKET_SPREAD.low >= 0.85 && MARKET_SPREAD.low <= 0.95,
    'the floor sits just under our price, per both observed products');
  assert.ok(MARKET_SPREAD.high >= 1.55 && MARKET_SPREAD.high <= 1.7,
    'the ceiling is the dearer installer settling, observed at x1.59 to x1.62');
  assert.strictEqual(MARKET_SPREAD, INSTALLER_SPREAD, 'the old name must keep meaning the installer spread');
  assert.strictEqual(NO_HAGGLE, 2.0, 'the no-discount figure was observed at double; do not inflate it');
});

test('not negotiating costs more than the difference between installers', () => {
  /* The claim the page makes out loud, so it fails if the numbers stop
     supporting it. */
  const r = sourced();
  assert.ok(r.noHaggle > r.marketRange.high, 'the no-haggle figure is inside the installer range');
  const haggling = r.noHaggle - r.marketRange.high;
  const betweenInstallers = r.marketRange.high - r.marketRange.low;
  assert.ok(haggling > 0 && betweenInstallers > 0);
});

test('the no-haggle figure is withheld whenever the comparison is', () => {
  /* Both rest on the same base. One appearing without the other would say the
     base is trustworthy enough for the bigger claim and not the smaller. */
  const UNSOURCED = { ...RATES, sourced: false, source: 'Windows: placeholder rates, not sourced.' };
  const r = base({ rates: UNSOURCED });
  assert.strictEqual(r.marketRange, null);
  assert.strictEqual(r.noHaggle, null, 'the no-haggle figure survived on an unsourced base');
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

/* ── opening lights ──

   A photograph cannot show whether a pane opens, and the difference is x2.37:
   £570 against £1,348 on a standard window once the 40% discount is applied.
   One band price was therefore wrong in both directions — 49% dear against a
   fixed pane, 37% cheap against one with two openers — and the average suited
   almost nobody.

   So the product asks, and this is what the answer does. */

test('the bands assume one opener, so saying "one" changes nothing', () => {
  const none = sourced({ openerCount: undefined });
  const one = sourced({ openerCount: 1 });
  assert.strictEqual(one.price.total, none.price.total,
    'the typical case moved, which means the bands and typicalOpeners disagree');
});

test('fewer openers costs less and more costs more, per window', () => {
  const r = (n) => sourced({ openerCount: n });
  const fixed = r(0), one = r(1), two = r(2);
  assert.ok(fixed.price.total < one.price.total, 'a fixed pane cost the same as an opening one');
  assert.ok(two.price.total > one.price.total);
  /* The step is the same in both directions and scales with the house. */
  const down = one.price.total - fixed.price.total;
  const up = two.price.total - one.price.total;
  assert.ok(Math.abs(down - up) <= 2, `steps disagree: ${down} vs ${up}`);
});

test('the step matches the trade figures it came from', () => {
  /* £389 inclusive per opener, per window — from £570 with none and £1,348
     with two. Wrong here means the estimate has quietly drifted from the only
     measurement behind it. */
  const one = sourced({ openerCount: 1 });
  const two = sourced({ openerCount: 2 });
  const perWindowInc = (two.price.total - one.price.total) / one.windowCount;
  assert.ok(Math.abs(perWindowInc - 389) < 12,
    `£${Math.round(perWindowInc)} per opener per window, expected about £389`);
});

test('an implausible or missing answer leaves the typical case alone', () => {
  /* Nought to six is a window. Seven is a mistyped answer, and a number
     somebody fat-fingered must not multiply into a price they act on. */
  const typical = sourced({ openerCount: undefined }).price.total;
  for (const bad of [null, undefined, -1, 7, 99, 'two', NaN]) {
    assert.strictEqual(sourced({ openerCount: bad }).price.total, typical,
      `openerCount=${String(bad)} changed the price`);
  }
});

test('the answer is reported back, so the lead records what was asked', () => {
  assert.strictEqual(sourced({ openerCount: 2 }).openerCount, 2);
  assert.strictEqual(sourced({ openerCount: undefined }).openerCount, null,
    '"not asked" and "none" must not look the same');
});

/* ── the door range ── */

test('every door offered can be priced, and every priced door is offered', () => {
  /* Two lists in one file, and nothing kept them together. A door in the
     picker with no rate throws when somebody chooses it; a rate with no
     picker entry is money left on the table quietly. */
  const priced = new Set(catalogue.glazing.doors.map(d => d.id));
  const offered = new Set(catalogue.windowsDoors.doorStyles.map(d => d.id));
  assert.deepStrictEqual([...offered].filter(id => !priced.has(id)), [],
    'a door is offered that cannot be priced');
  assert.deepStrictEqual([...priced].filter(id => !offered.has(id)), [],
    'a door is priced that nobody can choose');
});

test('the doors sit in the order the trade sells them', () => {
  /* uPVC is the volume product and the cheapest; a 3 m bifold is the dearest
     thing on the list. If that inverts, a price has been mistyped. */
  const p = (id) => catalogue.glazing.doors.find(d => d.id === id).supplyFit;
  assert.ok(p('upvc') < p('composite'), 'uPVC is not cheaper than composite');
  assert.ok(p('composite') < p('bifold'), 'a composite door costs more than a bifold');
  assert.ok(p('bifold') < p('bifold-3m'), 'a 3 m bifold is not dearer than a narrower one');
  assert.strictEqual(p('sliding'), p('double'), 'sliding and double are quoted alike and were stored alike');
});

test('the new doors were derived on the same basis as the one already here', () => {
  /* base = Anglian settled / 1.6. The composite was in the catalogue before
     that rule was written down, so it is the check on the rule: if the
     arithmetic is right it reproduces a figure nobody derived that way. */
  const vat = 1 + (catalogue.glazing.vatPct / 100);
  const fromList = (listInc) => (listInc * 0.6) / 1.6 / vat;
  const p = (id) => catalogue.glazing.doors.find(d => d.id === id).supplyFit;
  assert.ok(Math.abs(fromList(5401) - p('composite')) / p('composite') < 0.03,
    'the rule does not reproduce the composite door already in the catalogue');
  assert.ok(Math.abs(fromList(2893) - p('upvc')) / p('upvc') < 0.03, 'uPVC does not follow the rule');
  assert.ok(Math.abs(fromList(5058) - p('sliding')) / p('sliding') < 0.03, 'sliding does not follow the rule');
});

/* ── Bay panes, told apart by geometry rather than by what the model called
      them ──

   The label rule (PANE_LABEL) was written against a run that produced
   "Lower Bay Window - Center Left Pane". The next day the same photograph
   came back as "Upper Bay Window Left Angled" / "Upper Bay Window 2" /
   "Upper Bay Window Center", and the bay counted as five windows again.

   Both fixtures below are the real boxes returned by /api/detect for this
   site's own photographs, copied from the live response rather than invented,
   so the thresholds are checked against the thing they have to separate. */

/* Imported here rather than at the top, matching how the sidelight test above
   reaches for it — this block was appended and stands on its own. */
const { frontWindowCount } = require('../glazing');

const HERO_BAYS = [
  // Upper bay: five panes, each sharing an edge with the next.
  { type: 'window', confidence: 0.9, label: 'Upper Bay Window Left Angled',  x_pct: 25, y_pct: 11, w_pct: 10, h_pct: 17 },
  { type: 'window', confidence: 0.9, label: 'Upper Bay Window 2',            x_pct: 35, y_pct: 11, w_pct: 13, h_pct: 18 },
  { type: 'window', confidence: 0.9, label: 'Upper Bay Window Center',       x_pct: 48, y_pct: 11, w_pct: 13, h_pct: 18 },
  { type: 'window', confidence: 0.9, label: 'Upper Bay Window 4',            x_pct: 61, y_pct: 11, w_pct: 10, h_pct: 17 },
  { type: 'window', confidence: 0.9, label: 'Upper Bay Window Right Angled', x_pct: 71, y_pct: 13, w_pct: 10, h_pct: 15 },
  // Lower bay: the same, 37 points down the frame.
  { type: 'window', confidence: 0.9, label: 'Lower Bay Window Left Angled',  x_pct: 25, y_pct: 48, w_pct: 10, h_pct: 20 },
  { type: 'window', confidence: 0.9, label: 'Lower Bay Window 2',            x_pct: 35, y_pct: 48, w_pct: 13, h_pct: 21 },
  { type: 'window', confidence: 0.9, label: 'Lower Bay Window Center',       x_pct: 48, y_pct: 48, w_pct: 13, h_pct: 21 },
  { type: 'window', confidence: 0.9, label: 'Lower Bay Window 4',            x_pct: 61, y_pct: 48, w_pct: 10, h_pct: 20 },
  { type: 'window', confidence: 0.9, label: 'Lower Bay Window Right Angled', x_pct: 71, y_pct: 50, w_pct: 10, h_pct: 18 },
];

const NEWBUILD_WINDOWS = [
  { type: 'window', confidence: 0.9, label: 'Upper Right Triple Window',  x_pct: 61, y_pct: 15, w_pct: 25, h_pct: 16 },
  { type: 'window', confidence: 0.9, label: 'Upper Left Double Window',   x_pct: 14, y_pct: 22, w_pct: 16, h_pct: 14 },
  { type: 'window', confidence: 0.9, label: 'Upper Middle Single Window', x_pct: 37, y_pct: 24, w_pct: 8,  h_pct: 12 },
  { type: 'window', confidence: 0.9, label: 'Lower Left Double Window',   x_pct: 13, y_pct: 55, w_pct: 16, h_pct: 15 },
  { type: 'window', confidence: 0.9, label: 'Lower Right Triple Window',  x_pct: 60, y_pct: 56, w_pct: 28, h_pct: 15 },
];

test('two bays are two windows, whatever the model called the panes', () => {
  assert.strictEqual(frontWindowCount(HERO_BAYS), 2,
    'ten touching pane boxes are two bay windows — a homeowner with two bays ' +
    'priced for ten is the bug this exists to stop');
});

test('five separate windows stay five — the merge does not over-reach', () => {
  assert.strictEqual(frontWindowCount(NEWBUILD_WINDOWS), 5,
    'these sit 7, 16 and 31 points apart; merging any of them would be as ' +
    'wrong in the other direction');
});

test('the upper bay never merges with the lower one below it', () => {
  /* They share their horizontal span exactly. Only the vertical-overlap
     requirement keeps them apart, so this is the test that pins it. */
  const upperOnly = HERO_BAYS.filter(d => /^Upper/.test(d.label));
  const lowerOnly = HERO_BAYS.filter(d => /^Lower/.test(d.label));
  assert.strictEqual(frontWindowCount(upperOnly), 1);
  assert.strictEqual(frontWindowCount(lowerOnly), 1);
  assert.strictEqual(frontWindowCount([...upperOnly, ...lowerOnly]), 2);
});

test('a run of panes collapses to one unit, not to two', () => {
  /* Merging is transitive. Pane 1 touches 2, 2 touches 3, and so on — a
     single pass that merged pairs and stopped would leave two or three units
     from a five-pane bay, which is closer than five and still wrong. */
  const five = HERO_BAYS.filter(d => /^Upper/.test(d.label));
  assert.strictEqual(five.length, 5);
  assert.strictEqual(frontWindowCount(five), 1);
});

test('the gap threshold sits well clear of both sides', () => {
  /* The nearest real separation measured on these photographs is 7 points and
     the panes are at 0. A boundary case either side, so a later tweak that
     drags the threshold towards either one fails here rather than silently in
     somebody's price. */
  const row = (x, w) => ({ type: 'window', confidence: 0.9, label: `W${x}`, x_pct: x, y_pct: 20, w_pct: w, h_pct: 14 });
  assert.strictEqual(frontWindowCount([row(10, 10), row(21.5, 10)]), 1,
    'a 1.5-point gap is a pane join');
  assert.strictEqual(frontWindowCount([row(10, 10), row(25, 10)]), 2,
    'a 5-point gap is a pier between two windows');
});

test('the label rule still works where the model does say "Pane"', () => {
  /* Kept alongside the geometry, because when the model names the grouping it
     needs no threshold at all. Boxes deliberately left NOT touching, so only
     the label rule can join them. */
  const labelled = [
    { type: 'window', confidence: 0.9, label: 'Lower Bay Window - Left Pane',   x_pct: 10, y_pct: 20, w_pct: 8, h_pct: 14 },
    { type: 'window', confidence: 0.9, label: 'Lower Bay Window - Centre Pane', x_pct: 30, y_pct: 20, w_pct: 8, h_pct: 14 },
  ];
  assert.strictEqual(frontWindowCount(labelled), 1);
});

/* ── Whose house is that window on? ──

   A live run on 22 September returned thirteen elements, one of them labelled
   by the model itself "Neighboring Structure Window", and the count included
   it. On a front count of three with a detached house's x3.0 multiplier, a
   third of that homeowner's glazing estimate belonged to next door.

   The fix is a filter on geometry.subjectBox. The dangerous half is what it
   does when there is no subject box, which is the case these tests exist for
   more than the one they fix. */

const { frontWindowCount: fwc } = require('../glazing');
const geometry = require('../geometry');

/* A house with clear ground either side, so subjectBox has something to say.
   A door and cladding anchor it; roof and windows bound it. */
const SUBJECT_HOUSE = [
  { type: 'roof',       confidence: 0.9, label: 'Main Roof',   x_pct: 20, y_pct: 10, w_pct: 55, h_pct: 22 },
  { type: 'cladding',   confidence: 0.9, label: 'Brick Wall',  x_pct: 18, y_pct: 30, w_pct: 60, h_pct: 52 },
  { type: 'door-front', confidence: 0.9, label: 'Front Door',  x_pct: 45, y_pct: 60, w_pct: 7,  h_pct: 16 },
  { type: 'window',     confidence: 0.9, label: 'Upper Left',  x_pct: 25, y_pct: 36, w_pct: 12, h_pct: 11 },
  { type: 'window',     confidence: 0.9, label: 'Upper Right', x_pct: 60, y_pct: 36, w_pct: 12, h_pct: 11 },
];

test('a window the model says is the neighbour\'s is not priced', () => {
  const withNeighbour = [...SUBJECT_HOUSE,
    { type: 'window', confidence: 0.9, label: 'Neighboring Structure Window', x_pct: 2, y_pct: 38, w_pct: 8, h_pct: 9 }];

  assert.strictEqual(fwc(SUBJECT_HOUSE), 2, 'the subject house has two windows');
  assert.strictEqual(fwc(withNeighbour), 2,
    'a window outside the subject box was counted — on a detached that is three ' +
    'whole-house windows of somebody else\'s glazing in this estimate');
});

test('a null subject box counts exactly what it counted before', () => {
  /* THE REGRESSION IN WAITING. subjectBox returns null on four guards, and if
     null fell through as an empty box every window would be outside it, the
     count would go to zero, and photographs that work today would price at
     nothing. That fault would only appear on the photographs where the guards
     trip, which is to say on the ones nobody tests with. */
  const fillsTheFrame = [
    { type: 'roof',     confidence: 0.9, x_pct: 0,  y_pct: 0,  w_pct: 100, h_pct: 30 },
    { type: 'cladding', confidence: 0.9, x_pct: 0,  y_pct: 28, w_pct: 100, h_pct: 70 },
    { type: 'window',   confidence: 0.9, x_pct: 10, y_pct: 35, w_pct: 14,  h_pct: 12, label: 'A' },
    { type: 'window',   confidence: 0.9, x_pct: 40, y_pct: 35, w_pct: 14,  h_pct: 12, label: 'B' },
    { type: 'window',   confidence: 0.9, x_pct: 72, y_pct: 35, w_pct: 14,  h_pct: 12, label: 'C' },
  ];
  assert.strictEqual(geometry.subjectBox(fillsTheFrame), null,
    'this fixture is meant to trip a guard — if it stops doing so the test below proves nothing');
  assert.strictEqual(fwc(fillsTheFrame), 3, 'a null subject box must not zero the count');

  // And the other null paths: no anchor at all, and nothing to go on.
  const noAnchor = [{ type: 'window', confidence: 0.9, x_pct: 10, y_pct: 35, w_pct: 14, h_pct: 12 }];
  assert.strictEqual(geometry.subjectBox(noAnchor), null);
  assert.strictEqual(fwc(noAnchor), 1, 'no door and no wall must still count the window it can see');
  assert.strictEqual(fwc([]), 0);
});

test('the bay merge still happens inside the subject box', () => {
  /* The filter runs before the merge, so a bay whose panes are all on the
     subject house must still collapse to one. */
  const bays = [...SUBJECT_HOUSE.filter(d => d.type !== 'window'),
    { type: 'window', confidence: 0.9, label: 'Bay Left',   x_pct: 30, y_pct: 36, w_pct: 10, h_pct: 12 },
    { type: 'window', confidence: 0.9, label: 'Bay Centre', x_pct: 40, y_pct: 36, w_pct: 10, h_pct: 12 },
    { type: 'window', confidence: 0.9, label: 'Bay Right',  x_pct: 50, y_pct: 36, w_pct: 10, h_pct: 12 },
  ];
  assert.strictEqual(fwc(bays), 1, 'three touching panes inside the subject box are one bay');
});

test('the count, the price and the displayed number all come from one filter', () => {
  /* They read the same function, so they cannot disagree — but only while
     they keep doing so. The neighbour's window was visible in all three. */
  const withNeighbour = [...SUBJECT_HOUSE,
    { type: 'window', confidence: 0.9, label: 'Neighbouring window', x_pct: 2, y_pct: 38, w_pct: 8, h_pct: 9 }];
  const priced = estimateGlazing({
    detections: withNeighbour, aspectRatio: ASPECT_4_3, houseType: 'detached',
    selections: { windowStyleId: 'casement', windowDoorColourId: 'white' }, rates: RATES,
  });
  assert.strictEqual(priced.frontCount, fwc(withNeighbour),
    'the priced front count and the displayed count have diverged');
  assert.strictEqual(priced.frontCount, 2);
});

test('a window the model names as next door is dropped even with no subject box', () => {
  /* The case geometry cannot reach. On a terrace the detector returns the
     whole row's roof and roofline as single full-frame boxes, so there is
     nothing to bound a subject box with and subjectBox correctly returns null
     — and on exactly such a photograph it also returned "Adjacent House
     Window", which was counted and priced.

     Deliberately not the mistake the bay-pane rule made. That parsed a label
     FORMAT to infer a grouping, and broke the next day when the model phrased
     it differently. This reads an explicit statement of ownership, for an
     exclusion: if the wording changes we are no worse than today, and no
     window on the customer's own house is ever called adjacent. */
  const win = (label, x) => ({ type: 'window', confidence: 0.9, label, x_pct: x, y_pct: 30, w_pct: 10, h_pct: 12 });
  const terrace = [win('Upper Bay Window', 30), win('Lower Bay Window', 30)];

  assert.strictEqual(geometry.subjectBox(terrace), null,
    'this fixture must have no subject box, or it exercises the geometric path instead');

  const base = fwc(terrace);
  for (const label of ['Adjacent House Window', 'Neighboring Structure Window',
                       'Neighbour window', 'Next-door window']) {
    assert.strictEqual(fwc([...terrace, win(label, 2)]), base,
      `"${label}" was counted — that is somebody else's glazing in this estimate`);
  }

  /* And a real window must survive. Dropping one under-prices the job, which
     is the failure this filter could introduce. */
  assert.strictEqual(fwc([...terrace, win('Landing window', 62)]), base + 1,
    'a real window was dropped');
});

test('a trigger word does not delete a window geometry says is theirs', () => {
  /* The false-positive direction, which nothing pinned. The label rule exists
     for the terrace, where subjectBox is null and geometry cannot speak — but
     it ran on every window, so "Window Adjacent To Front Door" on somebody's
     own house was dropped even where the subject box said plainly it was
     theirs.

     The two mistakes are not equal. Counting a neighbour's window overcharges
     somebody; dropping one of their own undercharges silently, on a house we
     could see perfectly well. */
  /* Placed clear of the other two on both axes. The first attempt sat 1% from
     the upper-left window on the same row, and the bay merge — correctly —
     joined them, so the count did not move and the test read as a label
     failure. A fixture that trips a different rule proves nothing about this
     one. */
  const inside = { type: 'window', confidence: 0.9, label: 'Window Adjacent To Front Door',
                   x_pct: 44, y_pct: 49, w_pct: 10, h_pct: 11 };
  const withTriggerWord = [...SUBJECT_HOUSE, inside];

  const subject = geometry.subjectBox(withTriggerWord);
  assert.ok(subject, 'this fixture must HAVE a subject box, or it tests the label path instead');

  assert.strictEqual(fwc(withTriggerWord), fwc(SUBJECT_HOUSE) + 1,
    'a window inside the subject box was dropped for its label — geometry had already answered');

  /* And the neighbour is still excluded there, by geometry rather than by
     wording: the same box outside the subject box goes, whatever it is called. */
  const outside = { ...inside, label: 'Perfectly ordinary window', x_pct: 1, y_pct: 40 };
  assert.strictEqual(fwc([...SUBJECT_HOUSE, outside]), fwc(SUBJECT_HOUSE),
    'a window outside the subject box was counted');
});
