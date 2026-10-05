/* What a stranger is shown first, and priced first. Run: npm test
 *
 * Mike's walk, 5 October, desktop. Coming from "Upload my house" with no
 * journey, the first look was a charcoal roof plus roofline at
 * £22,500 – £30,000, windows untouched.
 *
 * The homepage leads with windows and doors. The demo under the hero is
 * windows. The price printed beside that demo is £7,076 – £12,866. So the
 * first picture and the first number contradicted the page that sent them,
 * and the number was about three times too big for the work they came to see
 * — on a page whose whole argument is that its figures are honest.
 *
 * The reasoning is the brickwork rule from applyHouseTypePreset, one trade
 * further on: a roof is a finish in the ordinary sense, but it is also the
 * most expensive thing on the house, and opening on it prices a stranger for
 * work nobody mentioned.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
/* index.html ships its comments, so the note explaining a rule reads the same
   as the rule to a bare search. */
const code = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const preset = code.slice(code.indexOf('function applyHouseTypePreset()'),
                          code.indexOf('async function autoRenderStart('));

test('a visitor who chose nothing opens on windows', () => {
  assert.match(preset, /!state\.journey && !state\.resumedDesign/,
    'the opening is no longer special-cased for somebody who has not chosen');
  assert.match(preset, /JOURNEYS\.windows\.prefs/,
    'the windows opening must come from the journey that already defines it');
});

test('and is not given a roof or a roofline they never mentioned', () => {
  assert.match(preset, /groups = \[\];/,
    'the swatch preset still runs for a visitor who asked for nothing');
});

test('the windows opening is the one the homepage advertises', () => {
  /* casement, anthracite, no door — the demo beside the hero and the figure
     printed under it. If this drifts, the first price stops matching the
     homepage again. */
  const j = code.slice(code.indexOf('windows:  { keeps:'), code.indexOf('doors:    { keeps:'));
  assert.match(j, /windowStyleId: 'casement'/);
  assert.match(j, /windowDoorColourId: 'anthracite'/);
  assert.match(j, /doorStyleId: 'none'/);
});

test('it never overwrites a choice already made', () => {
  assert.match(preset, /if \(state\.prefs\[k\] == null\)/,
    'an opening that overwrites a chosen style is worse than no opening');
  assert.match(preset, /if \(state\.hasCustomised\) return false;/,
    'the customised guard has gone');
});

test('the estimate moves with the opening', () => {
  /* autoRenderStart only refreshes the price when the preset applied
     something. Setting the windows without saying so would leave the panel
     showing the price of swatches the page happened to load with, beside a
     render of different ones — the exact mismatch the visualiser exists to
     prevent. */
  assert.match(preset, /let applied = openedOnWindows;/);
  const start = code.slice(code.indexOf('async function autoRenderStart('), code.indexOf('async function autoRenderStart(') + 700);
  assert.match(start, /if \(presetApplied\) \{\s*\n\s*await refreshPrice\(\);/);
});

test('a journey still opens on what it came for', () => {
  /* Somebody who arrived from a roof page must still get a roof. The change
     is only about the visitor who asked for nothing. */
  assert.match(preset, /const JOURNEY_GROUP = \{ cladding: 'cladding', roof: 'roof', roofline: 'trim' \}/);
  assert.match(preset, /if \(group === ownGroup\) continue;/);
});
