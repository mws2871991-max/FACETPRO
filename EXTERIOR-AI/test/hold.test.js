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

test('a thin fascia touching the top of a window frame is still put back', () => {
  /* 24 September, live: the fascia is a line a few px tall whose lower edge
     sits level with the upstairs frames, so the two joined and the whole
     fascia was kept as "part of the window". */
  const p = new PNG({ width: 400, height: 300 });
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const frame = x >= 100 && x < 180 && y >= 60 && y < 140 && (x < 110 || x >= 170 || y < 70 || y >= 130);
    const fascia = x >= 20 && x < 380 && y >= 56 && y < 60;           // 4 px tall, touching the frame's top
    const dark = frame || fascia;
    p.data.set(dark ? [30, 30, 30, 255] : [200, 190, 180, 255], (y * 400 + x) * 4);
  }
  const render = PNG.sync.write(p);
  const box = { type: 'window', label: 'Window', confidence: 0.9, x_pct: 25, y_pct: 22, w_pct: 20, h_pct: 26 };
  const out = restoreSurroundings({ render, renderMime: 'image/png', original: photo, originalMime: 'image/jpeg', detections: [box] });
  assert.ok(out.restored, out.reason);
  const [far] = pixel(out.buffer, 300, 58);                        // fascia, well away from the window
  assert.ok(far > 170, `the fascia away from the window was kept as rendered (${far})`);
  assert.deepStrictEqual(pixel(out.buffer, 104, 100), [30, 30, 30], 'the frame itself must stay');
});

test('a fascia strip inside a loose window box is still put back', () => {
  /* newbuild-before.jpg, live: the upstairs window's box started at 12% down,
     inside the fascia at 10–13%, so the fascia counted as "window". A strip is
     not a window, whatever box it sits in. */
  const p = new PNG({ width: 400, height: 300 });
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const frame = x >= 100 && x < 180 && y >= 80 && y < 160;          // a solid changed window block
    const fascia = x >= 20 && x < 380 && y >= 30 && y < 42;           // 12 px strip, well above it
    p.data.set((frame || fascia) ? [30, 30, 30, 255] : [200, 190, 180, 255], (y * 400 + x) * 4);
  }
  // Box drawn far too high: from 8% down, covering the fascia as well.
  const loose = { type: 'window', label: 'Window', confidence: 0.9, x_pct: 25, y_pct: 8, w_pct: 20, h_pct: 46 };
  const out = restoreSurroundings({ render: PNG.sync.write(p), renderMime: 'image/png', original: photo, originalMime: 'image/jpeg', detections: [loose] });
  assert.ok(out.restored, out.reason);
  assert.ok(pixel(out.buffer, 300, 36)[0] > 170, 'the fascia strip was kept as window');
  assert.deepStrictEqual(pixel(out.buffer, 140, 120), [30, 30, 30], 'the window block must stay');
});

/* ── drawGeorgianBars: the grid the model would not draw ── */

const { drawGeorgianBars } = require('../hold');

// A 400×300 wall with one two-pane window at x 100–220, y 80–180: white frame
// in the photograph, green in the render. Glass (grey-blue) is unchanged.
const BRICK = [180, 110, 90], GLASS = [120, 140, 160], WHITE = [240, 240, 240], GREEN = [60, 90, 60];
const windowPic = (frame) => {
  const p = new PNG({ width: 400, height: 300 });
  for (let y = 0; y < 300; y++) for (let x = 0; x < 400; x++) {
    const inWin = x >= 100 && x < 220 && y >= 80 && y < 180;
    const isFrame = inWin && (x < 108 || x >= 212 || y < 88 || y >= 172 || (x >= 156 && x < 164));
    const c = !inWin ? BRICK : isFrame ? frame : GLASS;
    p.data.set([...c, 255], (y * 400 + x) * 4);
  }
  return p;
};
const photoWithWindow = (() => {
  const p = windowPic(WHITE);
  return jpeg.encode({ width: 400, height: 300, data: p.data }, 100).data;
})();
const greenRender = PNG.sync.write(windowPic(GREEN));
const winBox = { type: 'window', label: 'Window', confidence: 0.9, x_pct: 25, y_pct: 27, w_pct: 30, h_pct: 33 };
const near = (a, b, tol = 30) => a.every((v, i) => Math.abs(v - b[i]) <= tol);

test('Georgian bars are drawn inside each pane, in the frame colour', () => {
  const out = drawGeorgianBars({ render: greenRender, renderMime: 'image/png', original: photoWithWindow, originalMime: 'image/jpeg', detections: [winBox] });
  assert.ok(out.drawn, out.reason);
  assert.strictEqual(out.panes, 2, 'two panes either side of the mullion');
  // Left pane spans x 108–155: its vertical bar sits at the middle, ~132.
  assert.ok(near(pixel(out.buffer, 132, 110), GREEN), 'no vertical bar in the left pane');
  // Glass away from the bars stays glass.
  assert.ok(near(pixel(out.buffer, 118, 100), GLASS), 'glass between the bars was painted');
});

test('no bars on the wall, only inside the window', () => {
  const out = drawGeorgianBars({ render: greenRender, renderMime: 'image/png', original: photoWithWindow, originalMime: 'image/jpeg', detections: [winBox] });
  for (const [x, y] of [[60, 130], [300, 130], [160, 40], [160, 250]]) {
    assert.ok(near(pixel(out.buffer, x, y), BRICK), `a bar was drawn on the wall at ${x},${y}`);
  }
});

test('no window changed, no bars — the render is left as it came', () => {
  const same = PNG.sync.write(windowPic(WHITE));
  const out = drawGeorgianBars({ render: same, renderMime: 'image/png', original: photoWithWindow, originalMime: 'image/jpeg', detections: [winBox] });
  assert.strictEqual(out.drawn, false);
  assert.strictEqual(out.buffer, same);
});

test('same colour as before: nothing found, nothing restored, and the page is told', () => {
  // White on white — the frames did not change, so there is no window to keep.
  const same = PNG.sync.write(windowPic(WHITE));
  const out = restoreSurroundings({ render: same, renderMime: 'image/png', original: photoWithWindow, originalMime: 'image/jpeg', detections: [winBox] });
  assert.strictEqual(out.restored, false);
  assert.strictEqual(out.buffer, same);
  const fs2 = require('fs');
  const server = fs2.readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /barsMissing = !drawn\.drawn/);
  const html = fs2.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /Georgian bars aren’t shown on this picture/);
});
