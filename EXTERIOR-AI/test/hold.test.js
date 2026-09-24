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
  const left = Math.ceil((60 - 20 * 0.45) / 100 * 400);
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
  for (const cond of ['glazingColour', 'windowStyle', '!cladding']) {
    assert.ok(line[1].includes(cond), `doorRestore no longer checks ${cond}`);
  }
  // Which restores run: the door only when it is kept, the surroundings only
  // when the roofline and roof are kept too.
  const settings = server.slice(server.indexOf('const doorRestore = ('), server.indexOf('const doorRestore = (') + 500);
  assert.match(settings, /door: !doorStyle/);
  assert.match(settings, /surroundings: !trim/);
  /* And it can find the door without a detectionId — the automatic render
     starts alongside detection and never has one. */
  const block = server.slice(server.indexOf('const doorRestore = ('), server.indexOf('const doorRestore = (') + 400);
  assert.match(block, /fingerprint: imageFingerprint\(img\.buffer\)/);
});

test('a detection box that misses the hinge side still restores the whole door', () => {
  /* 23 September, live: box at 66–75% across, door at 62–74%. The 8% margin
     left an anthracite strip down the left of a grey door. */
  const offset = { ...door, x_pct: 64, w_pct: 16 };        // box starts 4% right of the "door"
  const out = restoreDoor({ render, renderMime: 'image/png', original, originalMime: 'image/jpeg', detections: [offset] });
  // 60% across is where the real door (60–80%) begins; it must be the photograph.
  const [r] = pixel(out.buffer, Math.round(0.605 * 400), 210);
  assert.ok(r > 150, `the hinge side of the door was left as rendered (${r})`);
});

test('the restore never reaches into a window', () => {
  // A window immediately left of the door, inside the widened margin.
  const win = { type: 'window', label: 'Hall window', confidence: 0.9, x_pct: 45, y_pct: 50, w_pct: 12, h_pct: 30 };
  const out = restoreDoor({ render, renderMime: 'image/png', original, originalMime: 'image/jpeg', detections: [door, win] });
  assert.ok(out.restored);
  // Inside the window box: still the render.
  assert.deepStrictEqual(pixel(out.buffer, Math.round(0.55 * 400), 210), [30, 30, 30]);
});

/* ── restoreSurroundings: the fascia the model recoloured to match ── */

const { restoreSurroundings } = require('../hold');

// A 400×300 photograph: light wall everywhere. The "render" darkens a window
// (asked for) and a fascia strip at the top (not asked for).
const photo = solidJpeg(400, 300, [200, 190, 180]);
const withChanges = (() => {
  const p = new PNG({ width: 400, height: 300 });
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const i = (y * 400 + x) * 4;
    const inWindow = x >= 100 && x < 180 && y >= 100 && y < 200;   // 25–45% across, 33–67% down
    const inFascia = x >= 20 && x < 380 && y >= 20 && y < 32;      // 5–95% across, 7–11% down
    const c = (inWindow || inFascia) ? 30 : 200;
    p.data.set([c, inWindow || inFascia ? 30 : 190, inWindow || inFascia ? 30 : 180, 255], i);
  }
  return PNG.sync.write(p);
})();
// The window's box drawn loose, as detection draws them: shifted down 5%.
const win = { type: 'window', label: 'Window', confidence: 0.9, x_pct: 25, y_pct: 38, w_pct: 20, h_pct: 33 };

test('a patch the model changed away from the windows is put back', () => {
  const out = restoreSurroundings({ render: withChanges, renderMime: 'image/png', original: photo, originalMime: 'image/jpeg', detections: [win] });
  assert.ok(out.restored, out.reason);
  const [r] = pixel(out.buffer, 200, 26);             // middle of the fascia strip
  assert.ok(r > 170, `the fascia should be back to the photograph (${r})`);
});

test('the window we were asked for is kept whole, even where its box is loose', () => {
  const out = restoreSurroundings({ render: withChanges, renderMime: 'image/png', original: photo, originalMime: 'image/jpeg', detections: [win] });
  // Top edge of the real window, above where its box starts.
  assert.deepStrictEqual(pixel(out.buffer, 140, 102), [30, 30, 30]);
  assert.deepStrictEqual(pixel(out.buffer, 140, 150), [30, 30, 30]);
});

test('nothing to keep, or nothing changed, leaves the render as it came', () => {
  const none = restoreSurroundings({ render: withChanges, renderMime: 'image/png', original: photo, originalMime: 'image/jpeg', detections: [] });
  assert.strictEqual(none.restored, false);
  assert.strictEqual(none.buffer, withChanges);
  const same = solidPng(400, 300, [200, 190, 180]);
  const quiet = restoreSurroundings({ render: same, renderMime: 'image/png', original: photo, originalMime: 'image/jpeg', detections: [win] });
  assert.strictEqual(quiet.restored, false);
  assert.strictEqual(quiet.buffer, same);
});
