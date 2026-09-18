/* The whole-house calculator's area, and the measurement it used to ignore.

   The bug this pins was invisible: the calculator seeded its slider from a
   generic 95 m² at startup and never looked again, so a house measured at
   85 m² was costed against 95 while its own measurement sat a few hundred
   pixels up the same page. Nothing failed. Two numbers for one wall, and the
   wrong one was ours.

   syncWholeHouseArea() lives in the inline script in index.html, which no
   other test can require. The trick used here is the same one
   inline-script.test.js relies on — read the source, and hand it to vm — only
   this time it is run rather than merely parsed, in a context holding nothing
   but a fake `state`. That keeps the test honest about which function it is
   checking: if somebody renames or deletes it, the extraction fails loudly
   instead of quietly testing a copy that has drifted.

   Everything below is arithmetic over a plain object. No DOM, no network. */

'use strict';

/* Required of every test file without exception — see integrity.test.js.
   A rule with a "only when you write" carve-out is one somebody has to think
   about each time, and the file that forgets it is the one that runs beside a
   mounted volume. */
require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* Pull a top-level `function name(...) { ... }` out of the page by counting
   braces from its opening one. Crude, and it only has to work for functions
   this test names — a mismatch shows up as a syntax error the moment vm
   compiles it, not as a silently truncated body that happens to parse. */
function extractFunction(name) {
  const start = html.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1,
    `${name}() is no longer in index.html under that name — find what replaced it and ` +
    'retarget this test, rather than deleting it; the behaviour it pins had no other cover');

  let depth = 0, i = html.indexOf('{', start);
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}' && --depth === 0) break;
  }
  assert.ok(depth === 0, `braces never balanced while reading ${name}()`);
  return html.slice(start, i + 1);
}

function extractConst(name) {
  const m = html.match(new RegExp(`^const ${name} = [^;]+;`, 'm'));
  assert.ok(m, `${name} is no longer declared at module scope in index.html`);
  return m[0];
}

/* One fresh sandbox per case. Sharing it would let an earlier case's mutation
   decide a later one, which is exactly the failure this whole file exists to
   catch. */
function run(state, catalogue = { wholeHouse: { areaMinM2: 60, areaMaxM2: 200, areaDefaultM2: 95 } }) {
  const ctx = { state: { ...state, catalogue } };
  vm.createContext(ctx);
  vm.runInContext(
    [extractConst('MEASURED_FROM_PHOTO'), extractConst('ABOUT_THIS_HOUSE'),
     extractFunction('syncWholeHouseArea'),
     'globalThis.__changed = syncWholeHouseArea();'].join('\n'),
    ctx, { filename: 'index.html (syncWholeHouseArea)' });
  return { changed: ctx.__changed, areaM2: ctx.state.wh.areaM2 };
}

const wh = (over = {}) => ({ areaM2: 95, areaTouched: false, ...over });

test('a measured house replaces the generic default — the bug in one line', () => {
  const r = run({ wh: wh(), price: { footprintM2: 85, footprintSource: 'photo_door' } });
  assert.strictEqual(r.changed, true);
  assert.strictEqual(r.areaM2, 85,
    'the calculator is still costing 95 m² for a house we measured at 85');
});

test('coverage-based measurement counts too', () => {
  assert.strictEqual(run({ wh: wh(), price: { footprintM2: 132, footprintSource: 'photo_coverage' } }).areaM2, 132);
});

test('dimensions typed in by hand count — they are about this house', () => {
  assert.strictEqual(run({ wh: wh(), price: { footprintM2: 140, footprintSource: 'manual_entry' } }).areaM2, 140,
    'somebody who walked out with a tape measure has told us more than the camera did');
});

test('photo_prior does NOT count, however much it looks like it does', () => {
  /* The whole reason both lists are spelled out rather than prefix-matched.
     photo_prior is the typical figure for the house type wearing a photo_
     prefix; adopting it would replace one generic number with another and
     call it a measurement. */
  const r = run({ wh: wh(), price: { footprintM2: 110, footprintSource: 'photo_prior' } });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.areaM2, 95);
});

test('a house-type figure does not count either', () => {
  assert.strictEqual(run({ wh: wh(), price: { footprintM2: 110, footprintSource: 'house_type' } }).changed, false);
});

test('their hand on the slider beats any measurement, including a later one', () => {
  const r = run({ wh: wh({ areaM2: 120, areaTouched: true }), price: { footprintM2: 85, footprintSource: 'photo_door' } });
  assert.strictEqual(r.changed, false);
  assert.strictEqual(r.areaM2, 120,
    'somebody who said "no, more like 120" told us something the photograph did not');
});

test('an area past the end of the slider is clamped, not shown off the track', () => {
  assert.strictEqual(run({ wh: wh(), price: { footprintM2: 260, footprintSource: 'photo_coverage' } }).areaM2, 200);
  assert.strictEqual(run({ wh: wh(), price: { footprintM2: 12, footprintSource: 'photo_coverage' } }).areaM2, 60);
});

test('nothing to sync is not a change', () => {
  for (const price of [null, {}, { footprintM2: 0, footprintSource: 'photo_door' },
                       { footprintM2: null, footprintSource: 'photo_door' },
                       { footprintM2: 'eighty', footprintSource: 'photo_door' }]) {
    assert.strictEqual(run({ wh: wh(), price }).changed, false,
      `${JSON.stringify(price)} should leave the area alone`);
  }
});

test('re-syncing the same area reports no change, so it cannot loop', () => {
  /* refreshPrice() awaits refreshWholeHouse() when this returns true. A
     function that kept returning true for an unchanged number would turn
     every price refresh into a second network call for ever. */
  const r = run({ wh: wh({ areaM2: 85 }), price: { footprintM2: 85, footprintSource: 'photo_door' } });
  assert.strictEqual(r.changed, false);
});

test('the two source lists have not been collapsed into one', () => {
  const measured = extractConst('MEASURED_FROM_PHOTO');
  assert.ok(measured.includes('photo_door') && measured.includes('photo_coverage'),
    'MEASURED_FROM_PHOTO is what earns the phrase "we measured"');
  assert.ok(!measured.includes('manual_entry'),
    'manual entry is about this house but was not read off the picture — keeping it out of ' +
    'MEASURED_FROM_PHOTO is what stops the page claiming a measurement it did not take');
  assert.ok(!measured.includes('photo_prior'),
    'photo_prior is a typical figure, not a measurement');
});
