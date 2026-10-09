'use strict';
require('./helpers/data-dir');
/* House numbers and number plates pixelated in stored pictures and the
   project pack (customer journey review, test 2, 9 Oct: "No. 14" on the
   door in the shareable picture). Detection says whether there is one;
   segmentation finds it precisely; these check the boxes and the blocks. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { blurBoxes, boxesFromMask } = require('../hold');

const png = (w, h, paint) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4; const [r, g, b] = paint(x, y);
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
};

test('a mask with one small patch gives one box around it, in percent', () => {
  const mask = png(200, 100, (x, y) => (x >= 150 && x < 170 && y >= 40 && y < 50 ? [255, 255, 255] : [0, 0, 0]));
  const boxes = boxesFromMask({ mask, maskMime: 'image/png' });
  assert.strictEqual(boxes.length, 1);
  const b = boxes[0];
  assert.ok(Math.abs(b.x_pct - 75) < 1 && Math.abs(b.y_pct - 40) < 1.5 && Math.abs(b.w_pct - 10) < 1.5 && Math.abs(b.h_pct - 10) < 1.5, JSON.stringify(b));
});

test('a patch the size of a wall is not a house number', () => {
  const mask = png(100, 100, (x, y) => (x < 60 && y < 60 ? [255, 255, 255] : [0, 0, 0]));
  assert.strictEqual(boxesFromMask({ mask, maskMime: 'image/png' }).length, 0);
});

test('the box is pixelated into flat blocks, and nothing outside it moves', () => {
  // Black digits-like stripes on white, inside the box only.
  const render = png(100, 100, (x, y) => (x >= 40 && x < 60 && y >= 40 && y < 60 && x % 3 === 0 ? [0, 0, 0] : [255, 255, 255]));
  const r = blurBoxes({ render, renderMime: 'image/png', boxes: [{ x_pct: 40, y_pct: 40, w_pct: 20, h_pct: 20 }] });
  assert.strictEqual(r.blurred, 1);
  const out = PNG.sync.read(r.buffer);
  const at = (x, y) => out.data[(y * 100 + x) * 4];
  assert.strictEqual(at(45, 45), at(46, 45), 'neighbouring pixels in a block are the same — the stripes are gone');
  assert.strictEqual(at(5, 5), 255, 'far outside the box is untouched');
});

test('wired: started at upload when detection saw one, applied before the picture is stored, boxes back to the page', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(server, /const PRIVATE_MASK_PROMPT = 'house number, number plate';/);
  assert.match(server, /preparePrivateMask\(detectionRecords\.get\(detectionId\), elevation\);/);
  assert.match(server, /privateBoxes = m \? boxesFromMask\(/);
  assert.ok(server.indexOf('house numbers and plates pixelated') < server.indexOf('await store.putRender(id, bytes, { mime });'), 'pixelated before it is stored');
  assert.match(page, /const html = packHtml\(await pixelatedBefore\(\)\);/);
  assert.match(page, /state\.privateBoxes = null;/);
});
