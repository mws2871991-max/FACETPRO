/* The photograph that found the bug.

   A real two-storey detached home, curved bay, photographed mid-build during a
   window replacement — and no front door in shot. The front door is the scale
   reference: 1.98 m is what turns percentages of an image into metres. Without
   one there is no way to size a window, and the code concluded from that that
   there was no way to count them either.

   So it threw away six windows it had plainly detected, priced the house-type
   prior of eleven instead, and drew six labels on the homeowner's photograph
   beside an estimate that said it covered eleven typical ones. £10,050–£18,272
   against £18,438–£33,523 on the same house.

   Every synthetic fixture in this suite has a door in it, which is exactly why
   none of them found this. The detections here are what /api/detect actually
   returned on 7 August 2026 — see test/fixtures/README.md, including why the
   photograph itself is not in the repository. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');

const glazing = require('../glazing');
const catalogue = require('../catalogue.json');
const detections = require('./fixtures/no-door-bay.detections.json');

const estimate = (extra = {}) => glazing.estimateGlazing({
  detections,
  aspectRatio: 720 / 960,        // the photograph was portrait 3:4
  houseType: 'detached',
  selections: { windowStyleId: 'casement', windowDoorColourId: 'white' },
  rates: catalogue.glazing,
  ...extra,
});

test('the fixture is the case it exists for: windows, and no door', () => {
  /* If someone re-records this against a photograph with a door in it, every
     assertion below still passes for the wrong reason. */
  const windows = detections.filter(d => d.type === 'window').length;
  assert.ok(windows >= 5, `only ${windows} windows in the fixture — it no longer exercises a real count`);
  assert.ok(!detections.some(d => d.type === 'door-front'),
    'this fixture must have no front door in it, or it is testing the measured path');
});

test('it counts the windows it can see instead of pricing a guess', () => {
  const r = estimate();
  const visible = detections.filter(d => d.type === 'window').length;

  assert.strictEqual(r.countSource, 'photo_count',
    'fell back to the house-type prior on a photograph with six clear windows in it');
  assert.strictEqual(r.frontCount, visible);
  assert.ok(r.windowCount > visible, 'a front elevation still scales to the whole house');
});

test('and says which it did, without claiming to have measured', () => {
  const r = estimate();
  assert.match(r.sourceLabel, /counted/i);
  assert.doesNotMatch(r.sourceLabel, /measured/i);
  assert.doesNotMatch(r.sourceLabel, /typical figure/i,
    'this is not the house-type prior and must not describe itself as one');
});

test('the estimate is materially higher than the guess it replaced', () => {
  /* The point of the change, in money. The prior is what this photograph used
     to produce; if the two ever converge, one of them has drifted. */
  const counted = estimate();
  const prior = glazing.estimateGlazing({
    detections: [],                       // nothing to count — the old outcome
    aspectRatio: null,
    houseType: 'detached',
    selections: { windowStyleId: 'casement', windowDoorColourId: 'white' },
    rates: catalogue.glazing,
  });

  assert.strictEqual(prior.countSource, 'house_type_prior');
  assert.ok(counted.windowCount > prior.windowCount,
    `counted ${counted.windowCount} windows but the guess was ${prior.windowCount} — the guess should be the smaller, weaker answer`);
  assert.ok(counted.price.total > prior.price.total,
    'the counted estimate should not be cheaper than knowing nothing about the house');
});

test('the upstairs windows are still found, because that needs no scale', () => {
  /* Which windows are upstairs decides the access charge, and it comes from
     where the box sits in the frame — the one thing a photograph with no scale
     reference still says plainly. Losing the door must not lose the
     scaffolding. */
  const r = estimate();
  assert.ok(r.price.upperStoreyCount > 0,
    'no upper-storey windows found on a two-storey house — the access charge has gone');
  assert.ok(r.price.upperStoreyCount < r.windowCount,
    'every window cannot be upstairs');
});

test('a homeowner correcting the count still overrides everything', () => {
  const r = estimate({ windowCountOverride: 14 });
  assert.strictEqual(r.countSource, 'manual_entry');
  assert.strictEqual(r.windowCount, 14);
});

/* ── the same photograph, as the model might actually have sent it ──

   The fixture above is a clean recording: six windows, all confident, all with
   integer coordinates, none overlapping. Real replies are not reliably like
   that, and the counting path shipped with none of the hygiene the measured
   path has — so noise went straight into the count and was then multiplied by
   the front-to-total ratio.

   These are the four ways it broke, on the same house. */

const hostile = (extra) => glazing.estimateGlazing({
  detections: extra,
  aspectRatio: 720 / 960,
  houseType: 'detached',
  selections: { windowStyleId: 'casement', windowDoorColourId: 'white' },
  rates: catalogue.glazing,
});

const win = (o = {}) => ({ type: 'window', label: 'W', confidence: 0.9, x_pct: 10, y_pct: 30, w_pct: 12, h_pct: 18, ...o });

test('three boxes over one window is one window, not three', () => {
  /* Bays and mullioned units are the two things the model most often boxes
     more than once. Uncaught, one bay window became nine after scaling. */
  const r = hostile([win(), win({ x_pct: 10.5, y_pct: 30.2 }), win({ x_pct: 9.6, y_pct: 29.7 })]);
  assert.strictEqual(r.frontCount, 1,
    `counted ${r.frontCount} windows where three boxes describe one`);
});

test('a detection the measured path would throw away is not counted either', () => {
  /* MIN_CONFIDENCE is 0.45. Six boxes at 0.05 used to count as six, scale to
     eighteen, and price above the prior they replaced — while claiming to have
     been counted from the photograph, which is a stronger claim than the prior
     makes. */
  const junk = Array.from({ length: 6 }, (_, i) => win({ confidence: 0.05, x_pct: 5 + i * 14 }));
  const r = hostile(junk);
  assert.strictEqual(r.countSource, 'house_type_prior',
    'noise below the confidence floor was counted as windows');
});

test('coordinates arriving as strings still count', () => {
  /* Number.isFinite("20") is false. Everything else goes through box(), which
     coerces — so a model emitting "x_pct": "20", which they do, made the whole
     counting path silently fail and fall back to the prior. */
  const r = hostile([
    win({ x_pct: '10', y_pct: '30', w_pct: '12', h_pct: '18' }),
    win({ x_pct: '40', y_pct: '30', w_pct: '12', h_pct: '18' }),
  ]);
  assert.strictEqual(r.countSource, 'photo_count',
    'string coordinates were treated as no coordinates');
  assert.strictEqual(r.frontCount, 2);
});

test('a detection with no y_pct is rejected, not silently put downstairs', () => {
  /* It was read without being checked: undefined + h/2 is NaN, NaN < 50 is
     false, so every window became ground floor and the access charge for a
     two-storey house quietly disappeared. */
  const r = hostile([win({ y_pct: undefined }), win({ x_pct: 40, y_pct: undefined })]);
  assert.strictEqual(r.countSource, 'house_type_prior',
    'a detection with no vertical position was counted anyway');
});

test('upstairs is still found on a mixed elevation, so access survives', () => {
  const r = hostile([
    win({ y_pct: 12 }), win({ x_pct: 40, y_pct: 12 }),
    win({ x_pct: 10, y_pct: 62 }), win({ x_pct: 40, y_pct: 62 }),
  ]);
  assert.strictEqual(r.frontCount, 4);
  assert.ok(r.price.upperStoreyCount > 0, 'no upstairs windows found on a two-storey elevation');
  assert.ok(r.price.access > 0, 'the scaffolding charge has gone');
});

test('the counted path never prices above the guess it replaced, on noise', () => {
  /* The whole justification for counting is that it uses more information than
     the prior. If noise can push it above the prior, it is using less. */
  const junk = Array.from({ length: 8 }, (_, i) => win({ confidence: 0.1, x_pct: 2 + i * 12 }));
  const noisy = hostile(junk);
  const prior = hostile([]);
  assert.ok(noisy.price.total <= prior.price.total * 1.01,
    `noise priced ${noisy.price.total} against a prior of ${prior.price.total}`);
});
