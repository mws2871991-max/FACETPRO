/* Five real houses, counted by hand. Run: npm test
 *
 * The count is what installers pay for. On 28 September one house — number 14
 * — needed four separate fixes before it counted right: the neighbour's sash,
 * the fanlight over the door, bays rejected for their height, and windows
 * above next door's doorway. Every one of them was found by a person looking
 * at a photograph and saying "that's wrong". That does not scale, and it does
 * not survive a model change: switching detection from Sonnet to Opus on 28
 * September silently altered what comes back for every photograph on the site.
 *
 * So: real detections from the live service, and a number counted off the
 * photograph by eye. The fixtures pin the PIPELINE, which is deterministic and
 * ours. They cannot pin the model, which is neither — re-record them when the
 * model or the prompt changes, and look at the pictures again when you do.
 *
 * No images here. This repository is public and these are real homes; the
 * geometry is the whole of the test value, as test/fixtures/README.md says of
 * the fixture that started this practice.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const glazing = require('../glazing');

const DIR = path.join(__dirname, 'fixtures', 'houses');
const houses = fs.readdirSync(DIR).filter(f => f.endsWith('.json'))
  .map(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));

/* Number 14 lives in its own fixture, written when the two-front-doors rule
   was built, and carries the same kind of answer. */
const n14 = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'edwardian-14-opus-detections.json'), 'utf8'));
const ALL = [...houses, { house: 'edwardian-14', aspectRatio: 888 / 1184,
  countedByHand: { windows: 4, bays: 2 }, detections: n14.detections,
  note: 'Edwardian mid-terrace, two painted bays, photographed beside number 12.' }];

test('the set is real houses, not one house five times', () => {
  assert.ok(ALL.length >= 5, `only ${ALL.length} houses — the point is breadth`);
  const shapes = new Set(ALL.map(h => h.detections.length + ':' + h.countedByHand.windows));
  assert.ok(shapes.size >= 4, 'these fixtures look like copies of each other');
  for (const h of ALL) {
    assert.ok(h.detections.length > 5, `${h.house} has almost no detections`);
    assert.ok(Number.isFinite(h.aspectRatio) && h.aspectRatio > 0,
      `${h.house} has no frame shape, so the two-front-doors rule cannot run on it`);
  }
});

test('every house is priced on the windows it actually has', () => {
  /* The one number this whole file exists for. */
  const wrong = [];
  for (const h of ALL) {
    const got = glazing.frontWindowCount(h.detections, h.aspectRatio);
    if (got !== h.countedByHand.windows) {
      wrong.push(`${h.house}: counted ${got}, the house has ${h.countedByHand.windows}`);
    }
  }
  assert.deepStrictEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`);
});

test('the count does not depend on the model volunteering the right words', () => {
  /* Labels are model prose and they drift — that is the standing lesson of the
     bay-pane rule, which broke overnight when the wording changed. Strip the
     words the pipeline reads for exclusions and the count must hold up on
     geometry: two front doors, a fanlight's shape, a box at the frame's edge.
     Number 14 is the case that matters here, and it was found in the live
     run-through rather than in a test. */
  const blind = (dets) => JSON.parse(JSON.stringify(dets)).map(d => {
    d.label = String(d.label || '')
      .replace(/\bneighbou?r(ing|s|'s)?\b/ig, '')
      .replace(/\bnext[\s-]door\b/ig, '')
      .replace(/\badjacent\b/ig, '')
      .replace(/\bfan[\s-]?light\b/ig, 'glazing');
    return d;
  });
  const wrong = [];
  for (const h of ALL) {
    const got = glazing.frontWindowCount(blind(h.detections), h.aspectRatio);
    if (got !== h.countedByHand.windows) {
      wrong.push(`${h.house}: ${got} with the words removed, ${h.countedByHand.windows} by hand`);
    }
  }
  assert.deepStrictEqual(wrong, [], `\n  ${wrong.join('\n  ')}\n`);
});

test('a window that is not theirs is neither charged for nor repainted', () => {
  /* One answer feeds the price and the render mask, so a house with a
     neighbour in shot must exclude the same window from both. */
  for (const h of ALL) {
    const boxes = glazing.neighbourWindowBoxes(h.detections, h.aspectRatio);
    const counted = glazing.frontWindowCount(h.detections, h.aspectRatio);
    assert.strictEqual(counted, h.countedByHand.windows, `${h.house} count moved`);
    for (const b of boxes) {
      assert.ok(Number.isFinite(b.x) && Number.isFinite(b.w) && b.w > 0,
        `${h.house} produced an unusable exclusion box, which would crash the mask cut`);
    }
  }
});

/* ── Bays: a real disagreement, recorded rather than hidden ──
 *
 * A bay carries catalogue.glazing.bayUplift, which is 1.45. Getting it wrong
 * is £765 on the newbuild, measured.
 *
 * Two rules are available and neither is right on its own, across these five:
 *
 *   the model's word "bay"   4 of 5 — wrong on the newbuild, where it calls a
 *                            flat four-light window a bay and overcharges
 *   geometry alone           3 of 5 — misses the real bays on tilehung and
 *                            detached, because each came back as ONE box, and
 *                            undercharges
 *
 * The word is currently trusted, which c4b13fa did deliberately: number 14's
 * real bays arrived as single boxes and were being missed entirely. So the
 * present rule errs towards overcharging, and the alternative errs towards
 * undercharging. Which is worse is a pricing decision, not a coding one.
 *
 * These tests therefore assert what is TRUE of each house, and the newbuild's
 * disagreement is asserted as the known defect it is, so that anyone who fixes
 * it is told by a failing test rather than left wondering.
 */
test('the bays the pipeline finds, against the bays the houses have', () => {
  const rows = ALL.map(h => ({
    house: h.house,
    byHand: h.countedByHand.bays,
    found: glazing.frontBayCount(h.detections, h.aspectRatio),
  }));
  const right = rows.filter(r => r.found === r.byHand).map(r => r.house);
  const wrong = rows.filter(r => r.found !== r.byHand);

  assert.ok(right.length >= 4, `only ${right.length} of ${rows.length} houses get their bays right`);
  assert.deepStrictEqual(wrong.map(r => r.house), ['newbuild-before'],
    `bay accuracy changed: ${JSON.stringify(wrong)}`);
  assert.strictEqual(wrong[0].found, 1, 'the newbuild over-counts by exactly one');
  assert.strictEqual(wrong[0].byHand, 0, 'and the house has no bay at all');
});

test('a mislabelled bay is worth knowing the price of', () => {
  /* Recorded so the decision is made against a number rather than a feeling.
     bayUplift is 1.37 (Mike's 2.4 m bay, 30 September); on the newbuild that
     single word is several hundred pounds, and the homeowner has no way to tell. */
  const cat = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalogue.json'), 'utf8'));
  assert.strictEqual(cat.glazing.bayUplift, 1.37, 'the uplift moved — re-measure what a wrong bay costs');

  const nb = houses.find(h => h.house === 'newbuild-before');
  const without = JSON.parse(JSON.stringify(nb.detections))
    .map(d => { d.label = String(d.label || '').replace(/\bbay\b/ig, ''); return d; });
  const opts = { rates: cat.glazing, aspectRatio: nb.aspectRatio, houseType: 'detached', seenOnly: true, backCount: 0 };
  const asDetected = glazing.estimateGlazing({ ...opts, detections: nb.detections });
  const asFlat = glazing.estimateGlazing({ ...opts, detections: without });

  const cost = asDetected.price.total - asFlat.price.total;
  assert.ok(cost > 400 && cost < 1200,
    `one mislabelled window moves this estimate by £${Math.round(cost)} — update the note in this file if that changed`);
});
