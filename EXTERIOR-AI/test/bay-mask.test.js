'use strict';
require('./helpers/data-dir');
/* IMG_2068, 1 October: the window mask found the two upstairs windows and not
   the bay, so the bay was put back to the photograph and stayed white beside
   an anthracite price. A window of ours that the mask misses is now held by
   its box; one the mask found is still decided by the mask. */
const { test } = require('node:test');
const assert = require('node:assert');
const { PNG } = require('pngjs');
const { restoreOutsideMask } = require('../hold');

const W = 100, H = 100;
const png = (fn) => {
  const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fn(x, y); const i = (y * W + x) * 4;
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
};
const inBox = (x, y, b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
const up1 = { x: 10, y: 10, w: 20, h: 20 }, up2 = { x: 60, y: 10, w: 20, h: 20 }, bay = { x: 40, y: 50, w: 45, h: 30 };
const original = png(() => [230, 230, 230]);                       // white frames, pale wall
const render = png((x, y) => ([up1, up2, bay].some(b => inBox(x, y, b)) ? [40, 40, 45] : [230, 230, 230]));
const mask = png((x, y) => ([up1, up2].some(b => inBox(x, y, b)) ? [255, 255, 255] : [0, 0, 0]));   // the bay missed
const px = (buf, x, y) => { const p = PNG.sync.read(buf); return p.data[(y * W + x) * 4]; };
const base = { render, renderMime: 'image/png', original, originalMime: 'image/png', mask, maskMime: 'image/png' };

test('without our windows, the bay the mask missed goes back to the photograph', () => {
  const r = restoreOutsideMask(base);
  assert.ok(r.restored);
  assert.strictEqual(px(r.buffer, 60, 65), 230, 'the bay was restored to white');
});

test('with our windows, a window the mask missed keeps the render', () => {
  const r = restoreOutsideMask({ ...base, ours: [up1, up2, bay] });
  assert.ok(r.restored);
  assert.strictEqual(r.windowsFilled, 1);
  assert.strictEqual(px(r.buffer, 60, 65), 40, 'the bay keeps its new colour');
  assert.strictEqual(px(r.buffer, 20, 20), 40, 'upstairs is still the render');
  assert.strictEqual(px(r.buffer, 5, 90), 230, 'the wall is still the photograph');
});

test('a window the mask did find is left to the mask', () => {
  const r = restoreOutsideMask({ ...base, ours: [up1, up2] });
  assert.strictEqual(r.windowsFilled, 0);
});

test('the render check judges windows one by one, and only relative to each other', () => {
  const server = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /\.\.\.\(glazingColour && windowStyle \? \['windows'\] : \[\]\)/);
  assert.match(server, /if \(hi >= WINDOW_CHANGED && lo < WINDOW_MISSED\)/);
  assert.match(server, /ours: glazing\.frontWindowBoxes\(detections, detectionAspectRatio\)/);
});

test('paint on stonework the mask calls window, outside our boxes, goes back to the photograph', () => {
  /* IMG_2068, 2 October: the stone head above the upstairs left window. */
  const head = { x: 8, y: 2, w: 24, h: 6 };   // above up1, outside its box
  const r2 = png((x, y) => ([up1, head].some(b => inBox(x, y, b)) ? [40, 40, 45] : [230, 230, 230]));
  const m2 = png((x, y) => ([up1, head, bay].some(b => inBox(x, y, b)) ? [255, 255, 255] : [0, 0, 0]));
  const r = restoreOutsideMask({ ...base, render: r2, mask: m2, ours: [up1, bay] });
  assert.ok(r.restored);
  assert.strictEqual(px(r.buffer, 20, 4), 230, 'the stone head is the photograph again');
  assert.strictEqual(px(r.buffer, 20, 20), 40, 'the window keeps its new colour');
});
