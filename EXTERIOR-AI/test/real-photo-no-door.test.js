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
