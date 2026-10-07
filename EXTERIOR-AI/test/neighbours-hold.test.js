/* The neighbours stay as they are (hold.js, holdOutsideHouse).

   7 Oct: four of seven test renders of the demo houses came back with a
   neighbour's window darkened to the new frame colour, because only the
   windows-only job had anything holding the picture outside the house. These
   pin the fix: outside the house box the photograph comes back, inside it
   the render stays, and a render that redrew the whole scene is left alone
   rather than given a double roofline. */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const { holdOutsideHouse, OUTSIDE_ALIGN_MAX } = require('../hold');

const png = (w, h, paint) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = paint(x, y);
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
};
const at = (buf, x, y) => { const p = PNG.sync.read(buf); const i = (y * p.width + x) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };

/* 200x100. Our house is x 0..119 (the box, in percent: 0..60); the
   neighbour's white window sits at x 160..179. The photograph is a textured
   street; the render repaints our house and — the fault — the neighbour's
   window too. */
const W = 200, H = 100;
const street = (x, y) => [120 + ((x * 7 + y * 3) % 40), 110 + ((x * 3) % 30), 100 + ((y * 5) % 30)];
const neighbourWindow = (x, y) => x >= 160 && x < 180 && y >= 20 && y < 50;
const ORIGINAL = png(W, H, (x, y) => (neighbourWindow(x, y) ? [250, 250, 250] : street(x, y)));
const RENDER = png(W, H, (x, y) => (x < 120 ? [60, 64, 70] : neighbourWindow(x, y) ? [60, 64, 70] : street(x, y)));
const BOX = { x: 0, y: 0, w: 60, h: 100 };

test('the neighbour comes back from the photograph; our house keeps the render', () => {
  const r = holdOutsideHouse({ render: RENDER, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png', box: BOX });
  assert.strictEqual(r.held, true, r.reason || '');
  assert.deepStrictEqual(at(r.buffer, 170, 35), [250, 250, 250], 'the neighbour’s window should be white again');
  assert.deepStrictEqual(at(r.buffer, 60, 50), [60, 64, 70], 'our new frames stay as rendered');
  assert.ok(r.outsideDiff <= OUTSIDE_ALIGN_MAX);
});

test('the edge is soft: just outside the house is a blend, not a cut', () => {
  // A box a little narrower than what the render repainted, so the edge falls
  // where render and photograph differ.
  const r = holdOutsideHouse({ render: RENDER, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png', box: { x: 0, y: 0, w: 55, h: 100 } });
  const edge = at(r.buffer, 111, 60);
  const photo = street(111, 60);
  assert.ok(edge[0] > 60 && edge[0] < photo[0], `expected a blend at the edge, got ${edge}`);
});

test('a render that redrew the whole scene is left alone, and says why', () => {
  const redrawn = png(W, H, (x, y) => [(x * 13 + y * 29) % 256, (x * 5) % 256, (y * 11) % 256]);
  const r = holdOutsideHouse({ render: redrawn, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png', box: BOX });
  assert.strictEqual(r.held, false);
  assert.match(r.reason, /redrew the whole picture/);
  assert.ok(r.buffer.equals(redrawn), 'untouched means byte for byte');
});

test('no house box, a house that fills the frame, or bad input: the render untouched', () => {
  for (const box of [null, { x: 0, y: 0, w: 0, h: 50 }]) {
    assert.strictEqual(holdOutsideHouse({ render: RENDER, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png', box }).held, false);
  }
  assert.match(holdOutsideHouse({ render: RENDER, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png', box: { x: 0, y: 0, w: 100, h: 100 } }).reason, /fills the picture/);
  assert.strictEqual(holdOutsideHouse({ render: Buffer.from('nope'), renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png', box: BOX }).held, false);
});

test('a photograph of a different size is scaled to the render, not refused', () => {
  const small = png(100, 50, (x, y) => (neighbourWindow(x * 2, y * 2) ? [250, 250, 250] : street(x * 2, y * 2)));
  const r = holdOutsideHouse({ render: RENDER, renderMime: 'image/png', original: small, originalMime: 'image/png', box: BOX });
  assert.strictEqual(r.held, true, r.reason || '');
  const px = at(r.buffer, 170, 35);
  assert.ok(px[0] > 200, `neighbour's window should be light again, got ${px}`);
});

test('every render but a driveway carries the hold, and it runs last', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /if \(!driveway\) \{\s*restorePlan = restorePlan\s*\? \{ \.\.\.restorePlan, holdNeighbours: true \}/);
  // After the bars, the last thing drawn, and before the render is stored.
  const bars = src.indexOf('const drawn = drawGeorgianBars({ render: bytes, ...common });');
  const hold = src.indexOf('const held = holdOutsideHouse({');
  const store = src.indexOf('await store.putRender(id, bytes, { mime });');
  assert.ok(bars > 0 && hold > bars && store > hold);
  // The box takes in our own windows and door, so a box without the roof cannot undo them.
  assert.match(src, /const own = \[\.\.\.glazing\.frontWindowBoxes\(detections, detectionAspectRatio\)/);
});
