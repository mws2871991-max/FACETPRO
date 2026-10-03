'use strict';
require('./helpers/data-dir');
/* 0059: a chosen front door stays in the picture.
   Since 0045 the window mask is only believed inside our window boxes, and the
   door was never one of them, so a new composite door was put back to the old
   one from the photograph: priced, never drawn. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { restoreOutsideMask } = require('../hold');

const W = 100, H = 100;
const png = (fn) => { const p = new PNG({ width: W, height: H }); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y); const i = (y * W + x) * 4; p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255; } return PNG.sync.write(p); };
const render = png(() => [200, 0, 0]);          // the new picture
const photo = png(() => [0, 0, 200]);           // the old photograph
const win = { x: 10, y: 10, w: 30, h: 30 }, door = { x: 60, y: 50, w: 20, h: 40 };
const inBox = (b, x, y) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
const windowOnlyMask = png((x, y) => inBox(win, x, y) ? [255, 255, 255] : [0, 0, 0]);   // what the upload-time mask holds
const at = (buf, x, y) => { const p = PNG.sync.read(buf); const i = (y * W + x) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };
const base = { render, renderMime: 'image/png', original: photo, originalMime: 'image/png', mask: windowOnlyMask, maskMime: 'image/png' };

test('without the door among our boxes, the new door is put back to the old one', () => {
  const r = restoreOutsideMask({ ...base, ours: [win] });
  assert.ok(r.restored);
  assert.deepStrictEqual(at(r.buffer, 70, 70), [0, 0, 200], 'the old door: this is the bug');
});

test('with the chosen door among our boxes, the new door stays', () => {
  const r = restoreOutsideMask({ ...base, ours: [win, door] });
  assert.ok(r.restored);
  assert.deepStrictEqual(at(r.buffer, 70, 70), [200, 0, 0], 'new door kept');
  assert.deepStrictEqual(at(r.buffer, 20, 20), [200, 0, 0], 'new window kept');
  assert.deepStrictEqual(at(r.buffer, 50, 20), [0, 0, 200], 'brick between them is the photograph');
});

test('the render route adds the door only when a new door was chosen', () => {
  const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(s, /const newDoor = !restore\.door \? doorBox\(detections\) : null;/);
  assert.match(s, /const oursHere = \[\.\.\.glazing\.frontWindowBoxes\(detections, detectionAspectRatio\), \.\.\.\(newDoor \? \[newDoor\] : \[\]\)\];/);
  assert.match(s, /ours: oursHere,/);
});
