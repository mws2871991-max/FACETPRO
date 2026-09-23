/* The kept front door, put back from the photograph. See hold.js.

   The rule the homeowner sees is "Keep my front door — don't price them".
   These pin that the door region comes from the photograph, that nothing
   outside it moves, and that every case hold.js declines leaves the render
   byte-for-byte as it arrived. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { restoreDoor } = require('../hold');

const solidPng = (w, h, rgb) => {
  const p = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i++) p.data.set([...rgb, 255], i * 4);
  return PNG.sync.write(p);
};
const solidJpeg = (w, h, rgb) => {
  const data = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([...rgb, 255], i * 4);
  return jpeg.encode({ width: w, height: h, data }, 95).data;
};
const pixel = (png, x, y) => {
  const p = PNG.sync.read(png);
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
};
const door = { type: 'door-front', label: 'Front Door', confidence: 0.9, x_pct: 60, y_pct: 50, w_pct: 20, h_pct: 40 };

// The render at twice the photograph's size, as FLUX returns it.
const render = solidPng(400, 300, [30, 30, 30]);          // the model's anthracite door
const original = solidJpeg(200, 150, [200, 200, 200]);    // the homeowner's grey one

test('the door region comes from the photograph and nothing else moves', () => {
  const out = restoreDoor({ render, renderMime: 'image/png', original, originalMime: 'image/jpeg', detections: [door] });
  assert.ok(out.restored, out.reason);
  // Centre of the door box: 70% across, 70% down.
  const [r] = pixel(out.buffer, 280, 210);
  assert.ok(r > 190, `the door should be the photograph's grey, got ${r}`);
  // Well outside the box, untouched.
  assert.deepStrictEqual(pixel(out.buffer, 40, 40), [30, 30, 30]);
  assert.deepStrictEqual(pixel(out.buffer, 200, 210), [30, 30, 30]);
});

test('the seam is feathered, not a hard edge', () => {
  const out = restoreDoor({ render, renderMime: 'image/png', original, originalMime: 'image/jpeg', detections: [door] });
  // Just inside the left edge of the margin: partway between the two.
  const left = Math.ceil((60 - 20 * 0.08) / 100 * 400);
  const [r] = pixel(out.buffer, left + 1, 210);
  assert.ok(r > 30 && r < 190, `expected a blend at the edge, got ${r}`);
});

test('every case it declines leaves the render exactly as it came', () => {
  const same = (args, why) => {
    const out = restoreDoor({ render, renderMime: 'image/png', original, originalMime: 'image/jpeg', detections: [door], ...args });
    assert.strictEqual(out.restored, false, why);
    assert.strictEqual(out.buffer, render, why);
  };
  same({ detections: [] }, 'no door detected');
  same({ detections: [{ ...door, confidence: 0.3 }] }, 'a door found without confidence');
  same({ renderMime: 'image/jpeg' }, 'a render that is not a PNG');
  same({ originalMime: 'image/webp' }, 'a photograph type it cannot read');
  same({ original: Buffer.from('not an image') }, 'a photograph that will not decode');
});

test('the route only asks for it when the door is kept, the windows change and the walls do not', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const line = server.match(/const doorRestore = \(([^?]*)\)/);
  assert.ok(line, 'doorRestore should be decided in one expression in the render route');
  for (const cond of ['glazingColour', 'windowStyle', '!doorStyle', '!cladding', 'detectionRecord']) {
    assert.ok(line[1].includes(cond), `doorRestore no longer checks ${cond}`);
  }
});
