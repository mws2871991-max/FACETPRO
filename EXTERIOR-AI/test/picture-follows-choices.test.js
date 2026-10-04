'use strict';
require('./helpers/data-dir');
/* 0058: the picture follows the choices, and carries the price.
   3 Oct, a homeowner on a phone: picked sliding sash and a composite door,
   saw the price move, never saw her house with them. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('every choice that clears the picture schedules a new one', () => {
  const clears = h.split('\n').filter(l => /state\.renderUrl = null; state\.renderId = null;/.test(l)).length;
  const scheduled = (h.match(/scheduleSettledRender\(\);/g) || []).length;
  assert.ok(scheduled >= 6, `only ${scheduled} schedule calls`);
  assert.ok(clears >= 5);
});

test('it waits for the choices to settle, and is capped per photo', () => {
  assert.match(h, /var SETTLE_MS = 3000;/);
  assert.match(h, /var MAX_SETTLED_RENDERS = 4;/);
  const f = h.slice(h.indexOf('function scheduleSettledRender()'), h.indexOf('function pictureTotal()'));
  assert.match(f, /clearTimeout\(settledTimer\)/, 'a new tap restarts the wait');
  assert.match(f, /settledRenders >= MAX_SETTLED_RENDERS\) return;/);
  assert.match(f, /if \(state\.rendering\) \{ scheduleSettledRender\(\); return; \}/);
  assert.match(f, /generateRealRender\(\{ settled: true \}\)/);
  // a new photo starts a new allowance
  assert.match(h, /state\.renderUrl = null;\n  settledRenders = 0;/);
});

test('a picture of choices they have since changed is not shown', () => {
  const g = h.slice(h.indexOf('async function generateRealRender('), h.indexOf('function renderVisualizerOnly('));
  assert.match(g, /const askedFor = choiceKey\(\);/);
  assert.match(g, /if \(askedFor !== choiceKey\(\)\) \{[\s\S]{0,200}stale = true;[\s\S]{0,200}return;/);
  assert.match(g, /if \(stale\) scheduleSettledRender\(\);/);
  const ck = h.slice(h.indexOf('function choiceKey()'), h.indexOf('function scheduleSettledRender()'));
  for (const k of ['cladding', 'trim', 'roof', 'glazingChoice()', 'driveway?.materialId']) assert.ok(ck.includes(k), k);
});

test('the price is on the picture, read from the panel, with its conditions', () => {
  assert.match(h, /id: 'picture-price'/);
  assert.match(h, /\(state\.renderUrl && state\.revealed && showing === 'after' && !state\.rendering && pictureLines\(\)\.length\)/);
  assert.match(h, /'Planning estimate · inc\. VAT'/);
  const p = h.slice(h.indexOf('function pictureTotal()'), h.indexOf('function pictureTotal()') + 300);
  assert.match(p, /getElementById\('estimate-total'\)/);
});

test('the page says a picture is coming', () => {
  assert.match(h, /'Updating your picture — or tap to start now'/);
});
