/* What happens when the detections are not a list. Run: npm test
 *
 * Every price on the site is counted off parsed model JSON. The guard for a
 * missing list was `detections || []`, which catches null and undefined and
 * lets every other wrong type straight through to `.filter` — where it throws.
 *
 * Fuzzing found this on 1 October: 96 of 512 hostile calls into the counting
 * path crashed, and 64 of 160 into geometry.js, where doorReference and
 * observedDoorShape had no guard at all and threw on undefined. The wrong
 * types that get through are not exotic — `{}`, a string, a number — and an
 * object where an array was expected is exactly what a parse of unexpected
 * model output gives you.
 *
 * The cost of the crash is the whole point. frontWindowCount throwing is not
 * a wrong number, it is a homeowner looking at a page with no estimate on it
 * and no reason given. Returning the no-detections answer is honest: we did
 * not read any windows, so we say we counted none, and the caller falls back
 * to the typical-house figure that says what it is.
 *
 * So: the contract is that a malformed list is a refusal, never a throw. This
 * file holds every public entry point that takes detections to it. geometry.js
 * already had the right guard in subjectBox and roofFraming and simply had not
 * applied it to its other two — which is the reason it is now one named
 * helper, detectionList, rather than a line to remember to copy.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');

const geometry = require('../geometry');
const glazing = require('../glazing');
const hold = require('../hold');

/* Not a list, in the shapes a bad parse actually produces. The array-like is
   deliberate: it has .length and a .filter that throws, so anything checking
   for duck-typed arrays instead of Array.isArray fails here. */
const NOT_LISTS = [
  undefined, null, 0, -1, NaN, '', 'x', true, {}, { detections: [] },
  { length: 3, filter: () => { throw new Error('array-like, not an array'); } },
];

const RATIOS = [undefined, null, 0, -1, NaN, Infinity, 0.75, '0.75'];

test('a count is a number or nothing, never an exception', () => {
  for (const d of NOT_LISTS) {
    for (const r of RATIOS) {
      for (const fn of ['frontWindowCount', 'frontBayCount']) {
        let got;
        assert.doesNotThrow(() => { got = glazing[fn](d, r); },
          `${fn}(${JSON.stringify(d)}, ${String(r)}) threw — that is a page with no price on it`);
        assert.ok(Number.isFinite(got) && got >= 0,
          `${fn} returned ${got} for ${JSON.stringify(d)}`);
      }
    }
  }
});

test('the boxes the render mask cuts are always a list', () => {
  /* One answer feeds the price and the mask. If the mask side throws, the
     render fails rather than the count — a different symptom, same cause. */
  for (const d of NOT_LISTS) {
    for (const fn of ['frontWindowBoxes', 'neighbourWindowBoxes']) {
      let got;
      assert.doesNotThrow(() => { got = glazing[fn](d, 0.75); }, `${fn} threw on ${JSON.stringify(d)}`);
      assert.ok(Array.isArray(got), `${fn} returned ${typeof got}, which the mask cut would crash on`);
    }
  }
});

test('the ruler refuses to measure rather than falling over', () => {
  /* doorReference returning null is a supported answer its callers are built
     around — they measure another way and say which way they used. Throwing
     is not. */
  for (const d of NOT_LISTS) {
    for (const r of RATIOS) {
      assert.doesNotThrow(() => geometry.doorReference(d, r), `doorReference threw on ${JSON.stringify(d)}`);
      assert.doesNotThrow(() => geometry.observedDoorShape(d, r), `observedDoorShape threw on ${JSON.stringify(d)}`);
    }
    assert.doesNotThrow(() => geometry.subjectBox(d), `subjectBox threw on ${JSON.stringify(d)}`);
    assert.doesNotThrow(() => geometry.roofFraming(d), `roofFraming threw on ${JSON.stringify(d)}`);
  }
});

test('the render holds refuse a bad options object', () => {
  /* The same lesson one level up, found by the same fuzz run and fixed in
     0d3ea87: `function f({...} = {})` catches undefined and not null. These
     all advertise that any malformed input returns the render untouched. */
  for (const fn of ['restoreDoor', 'restoreSurroundings', 'restoreOutsideMask',
                    'correctFrameColour', 'drawGeorgianBars']) {
    for (const opts of [undefined, null, 0, 'x', {}, { render: null, detections: {} }]) {
      assert.doesNotThrow(() => hold[fn](opts),
        `hold.${fn}(${JSON.stringify(opts)}) threw — a render that fails to save is a lost render`);
    }
  }
});

test('the fragile guard has not come back', () => {
  /* The fix is one named helper, and the point of naming it was that the
     pattern it replaced reads as correct. If `detections || []` reappears,
     everything above still passes for the entry points listed here and fails
     silently for whatever new one copied the line. */
  const fs = require('node:fs');
  const path = require('node:path');
  const offenders = [];
  for (const f of ['geometry.js', 'glazing.js', 'hold.js', 'measure.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    src.split('\n').forEach((line, i) => {
      if (/\(\s*detections\s*\|\|\s*\[\]\s*\)/.test(line)) offenders.push(`${f}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(offenders, [],
    `use detectionList() — \`detections || []\` lets {} and 'x' through to .filter:\n  ${offenders.join('\n  ')}`);
});
