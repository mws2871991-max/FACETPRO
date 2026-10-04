'use strict';
require('./helpers/data-dir');
/* 0064: a fairer, clearer before-and-after. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the before photo is shown as taken, not faded', () => {
  assert.match(h, /alt: 'Your home as it looks today', className: 'w-full h-full object-cover' \}\)/);
  assert.doesNotMatch(h, /opacity-60 grayscale-\[0\.2\]/);
});

test('once there is a photo, the sketch is never shown in its place', () => {
  const v = h.slice(h.indexOf('function buildVisualizer()'), h.indexOf('/* Two buttons, not a slider'));
  const photo = v.indexOf('} else if (state.uploadedImg) {'), sketch = v.indexOf('/* The colour, not the photograph.');
  assert.ok(photo > 0 && photo < sketch);
  assert.match(v, /Pictures are busy right now — your estimate still works/);
});

test('the reveal wipes the new picture across the photo (the fallback since 0077)', () => {
  assert.match(h, /state\.revealed = true;\s*revealFacets\(\);/);
  assert.match(h, /\.catch\(\(\) => revealWipe\(\)\)/);
  const f = h.slice(h.indexOf('function revealWipe()'), h.indexOf('function buildVisualizer()'));
  assert.match(f, /state\.afterPct = 0;/);
  assert.match(f, /prefers-reduced-motion/);
  assert.match(f, /clipPath = 'inset\(0 0% 0 0\)'/);
});

test('press and hold the picture shows before', () => {
  assert.match(h, /\.\.\.HOLD_TO_COMPARE,/);
  const f = h.slice(h.indexOf('var HOLD_TO_COMPARE'), h.indexOf('var REVEAL_MS'));
  assert.match(f, /onPointerdown/);
  assert.match(f, /onPointerup: restoreAfter, onPointerleave: restoreAfter, onPointercancel: restoreAfter/);
  assert.match(h, /Press and hold the picture/);
});
