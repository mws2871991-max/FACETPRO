'use strict';
require('./helpers/data-dir');
/* 0078: the wait shows what was really found on their house, and the first
   picture is chosen to change something visible. Checked in a headless
   browser on the Manningtree photo: boxes on the five windows, door and
   roofline; frame band luma 210 (white frames, stays anthracite) vs 47 on
   an anthracite render (switches to white). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const block = h.slice(h.indexOf('THE WAIT, MADE PART OF THE SHOW (0078)'), h.indexOf('/* ── END WAIT (0078)'));

function load(state) {
  return new Function('state', 'renderStartedAt', 'document', 'Image', 'setInterval', 'clearInterval', 'setTimeout', 'renderVisualizerOnly', 'h',
    block.slice(block.indexOf('function photoAspect')) + '; return { scanFound, scanStepText, chooseContrastFrame };')(
    state, Date.now() - 4000, {}, function () {}, () => 0, () => {}, () => 0, () => {}, () => ({}));
}

test('the steps name only what was found', () => {
  const none = load({ frontWindowBoxes: [], detections: [] });
  assert.deepStrictEqual(none.scanFound().found, []);
  const s = load({ frontWindowBoxes: [{ x: 10, y: 10, w: 5, h: 8 }, { x: 30, y: 10, w: 5, h: 8 }],
    detections: [{ type: 'door-front', x_pct: 20, y_pct: 50, w_pct: 5, h_pct: 20 }] });
  const f = s.scanFound();
  assert.strictEqual(f.windows, 2);
  assert.strictEqual(f.door, true);
  assert.strictEqual(f.roofline, false);
  assert.ok(f.found.some(x => x.label === '2 windows'));
  assert.ok(!f.found.some(x => x.label === 'Roofline'), 'no roofline box when none was found');
  assert.strictEqual(s.scanStepText(), 'Found your front door', 'about four seconds in: the second step');
});

test('the rendering pane shows the scan, not a faded pulsing photo', () => {
  const i = h.indexOf('} else if (state.rendering && state.uploadedImg) {');
  const seg = h.slice(i, h.indexOf('} else if (state.uploadedImg) {', i));
  assert.match(seg, /buildScanLayer\(\)/);
  assert.doesNotMatch(seg, /animate-pulse/);
  assert.match(h, /@media \(prefers-reduced-motion: reduce\) \{ \.fp-scanline \{ display: none; \}/);
});

test('the contrast choice only ever replaces the journey default, before anyone has touched a control', async () => {
  for (const st of [
    { hasCustomised: true, journey: 'windows', prefs: { windowDoorColourId: 'anthracite' } },
    { hasCustomised: false, journey: 'doors', prefs: { windowDoorColourId: 'anthracite' } },
    { hasCustomised: false, journey: 'windows', prefs: { windowDoorColourId: 'black' } },
    { hasCustomised: false, journey: 'windows', prefs: { windowDoorColourId: 'anthracite' }, frontWindowBoxes: [] },
  ]) {
    const s = load({ uploadedImg: 'x', frontWindowBoxes: [{ x: 1, y: 1, w: 1, h: 1 }], ...st });
    assert.strictEqual(await s.chooseContrastFrame(), false, JSON.stringify(st));
    assert.notStrictEqual(st.prefs.windowDoorColourId, 'white');
  }
  assert.match(block, /if \(luma == null \|\| luma >= CONTRAST_DARK_LUMA\) return false;/);
  assert.match(block, /state\.prefs\.windowDoorColourId = 'white';/);
});

test('the first automatic picture goes through the contrast choice', () => {
  assert.match(h, /async function autoRenderStart\(presetApplied\) \{\s*\/\*[^*]*\*\/\s*if \(await chooseContrastFrame\(\)\) presetApplied = true;/);
  const s = h.slice(h.indexOf('function startAutoRender()'), h.indexOf('function maybeAutoRender()'));
  assert.match(s, /autoRenderStart\(false\);/);
});
