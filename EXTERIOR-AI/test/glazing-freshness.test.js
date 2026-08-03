/* Every input that changes the window answer must ask for a new one.

   The glazing panel prices before a photo exists, from the house-type prior.
   So anything that changes what the answer should be — a photo arriving, the
   house type changing, starting again — has to refresh it, or the panel keeps
   showing a previous result under a label that is no longer true. All three
   were missing, and none of them looked broken: a stale range is a plausible
   range.

   These assert on the source of index.html rather than on behaviour, because
   the front end is inline in that file and the suite has no DOM. That makes
   them a tripwire, not a proof: they catch the refresh being dropped or a new
   path forgetting it, and they cannot catch it being called at the wrong
   moment. headers.test.js reads the same file the same way.

   The behavioural check, which is worth doing by hand after touching any of
   this: pick a window style with no photo, note the range and the label, then
   upload a photo. The label must change from "a typical figure for your house
   type" to the measured one without touching anything else. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// The body of a named function, up to the next top-level function.
const bodyOf = (name) => {
  const start = html.indexOf(`function ${name}(`);
  assert.notStrictEqual(start, -1, `${name} not found — this test needs updating`);
  const next = html.indexOf('\nfunction ', start + 1);
  const alsoNext = html.indexOf('\nasync function ', start + 1);
  const end = Math.min(...[next, alsoNext].filter(i => i > 0));
  return html.slice(start, Number.isFinite(end) ? end : undefined);
};

test('a new photo re-measures the windows', () => {
  /* Without this: pick a style, get a prior-based range, upload a photo, and
     the cladding re-sizes to the real house while the glazing keeps the prior
     figure and its "a typical figure for your house type" label. */
  const upload = bodyOf('handleUpload');
  assert.match(upload, /refreshGlazing\(\)/, 'handleUpload must refresh the glazing estimate');
  assert.match(upload, /refreshPrice\(\)/, 'and the cladding price, as it always did');
});

test('a new photo drops the count corrected for the last one', () => {
  const upload = bodyOf('handleUpload');
  assert.match(upload, /state\.windowCount = null/,
    'a count corrected for a detached house must not price a terrace');
  assert.match(upload, /state\.glazing = null/);
});

test('changing the house type changes the window count too', () => {
  /* frontToTotal and the window priors both key off house type, so without
     this a terrace's glazing sits on screen beside a detached house's
     cladding total. */
  const picker = bodyOf('buildHouseTypePicker');
  assert.match(picker, /refreshGlazing\(\)/);
});

test('starting again clears the window state', () => {
  const start = html.slice(html.indexOf("'Start again'") - 1200, html.indexOf("'Start again'"));
  assert.match(start, /state\.windowCount = null/, 'the corrected count must not outlive the photo');
  assert.match(start, /state\.glazing = null/);
});

test('a style with no colour explains itself rather than doing nothing', () => {
  // glazingChoice() sends the pair or neither, so the render button was silent.
  assert.match(html, /Pick a frame colour/);
});

test('the two estimates say how they relate', () => {
  // A range and a total on one page, with nothing saying they are additive.
  assert.match(html, /Separate from the cladding and roof estimate above/);
});

test('the count buttons are big enough to hit', () => {
  const panel = html.slice(html.indexOf('function glazingPanel'), html.indexOf('function glazingPanel') + 4000);
  assert.ok(!/w-8 h-8/.test(panel), '32px is below the 44px floor for a touch target');
  assert.match(panel, /w-11 h-11/);
  assert.match(panel, /aria-live/, 'the range changes without a page change; it should be announced');
});
