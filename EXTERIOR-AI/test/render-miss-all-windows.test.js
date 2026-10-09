'use strict';
require('./helpers/data-dir');
/* 9 Oct: a close photograph, asked for anthracite, came back with every
   window still white, and the page said "That is the look you chose". Two
   faults: the judge gave up waiting for detection before the automatic
   render's detection landed, and it only called a window missed when another
   had plainly changed. judgeRender is not exported, so the wiring is read
   from the source, the way the other render tests here do. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const { rgbToLab, hexToRgb } = require('../hold');
const catalogue = require('../catalogue.json');

test('the judge waits for detection as long as the render budget allows', () => {
  assert.match(src, /detectionsForRestore\(original, waitMs\)/);
  assert.match(src, /judgeOpts\.waitMs = Math\.max\(15_000, deadlineAt - Date\.now\(\) - RETRY_NEEDS_MS - 10_000\)/);
  assert.match(src, /judgeRender\(second\.url, trades, original, judgeOpts\)/);
});

test('every window left alone is a miss for a dark or coloured frame, never for white or cream', () => {
  const L = Number(src.match(/const WINDOW_DARK_L = (\d+);/)[1]);
  const dark = catalogue.windowsDoors.colours.filter(c => rgbToLab(...hexToRgb(c.hex))[0] < L).map(c => c.id);
  for (const id of ['anthracite', 'black', 'chartwell-green', 'agate-grey']) assert.ok(dark.includes(id), id);
  for (const id of ['white', 'cream']) assert.ok(!dark.includes(id), id);
  const none = Number(src.match(/const WINDOW_NONE_CHANGED = ([\d.]+);/)[1]);
  assert.ok(none > 0.13 && none < 0.9, 'between the reframed untouched house (0.13) and a real recolour (0.9)');
});

test('the page does not say "the look you chose" over a picture that missed it', () => {
  const at = page.indexOf("'That is the look you chose, on your house.");
  assert.ok(at > 0);
  assert.match(page.slice(at - 400, at), /state\.missedChanges\?\.length/);
});
