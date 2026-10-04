'use strict';
require('./helpers/data-dir');
/* The bay pillar hold (2 October): pillars the render painted go back to the
   photograph; a mask that has taken the whole bay is refused; off by default. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { restorePillars } = require('../hold');
const { PILLAR_PROMPT, PILLAR_DILATE } = require('../windowmask');

const W = 100, H = 100;
const png = (fn) => { const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const [r, g, b] = fn(x, y); const i = (y * W + x) * 4;
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255; } return PNG.sync.write(p); };
const bay = { x: 20, y: 40, w: 60, h: 40 };
const pillar = (x, y) => y >= 40 && y < 80 && ((x >= 30 && x < 36) || (x >= 64 && x < 70));
const original = png(() => [235, 235, 235]);
const render = png((x, y) => (x >= 20 && x < 80 && y >= 40 && y < 80 ? [20, 20, 20] : [235, 235, 235]));   // bay painted black, pillars too
const mask = png((x, y) => (pillar(x, y) ? [255, 255, 255] : [0, 0, 0]));
const px = (buf, x, y) => PNG.sync.read(buf).data[(y * W + x) * 4];
const base = { render, renderMime: 'image/png', original, originalMime: 'image/png', mask, maskMime: 'image/png', bay };

test('pillars go back to the photograph; frames keep the new colour', () => {
  const r = restorePillars(base);
  assert.ok(r.restored, r.reason);
  assert.strictEqual(px(r.buffer, 32, 60), 235, 'pillar restored');
  assert.strictEqual(px(r.buffer, 50, 60), 20, 'the window between keeps the render');
});

test('a "pillar" mask covering most of the bay is refused, render untouched', () => {
  const whole = png((x, y) => (x >= 20 && x < 80 && y >= 40 && y < 80 ? [255, 255, 255] : [0, 0, 0]));
  const r = restorePillars({ ...base, mask: whole });
  assert.strictEqual(r.restored, false);
  assert.match(r.reason, /of the bay/);
});

test('no mask, no change', () => {
  assert.strictEqual(restorePillars({ ...base, mask: null }).restored, false);
});

test('asked for positively, shrunk not grown, and off unless switched on', () => {
  assert.match(PILLAR_PROMPT, /pillar/);
  assert.ok(PILLAR_DILATE < 0);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.ok(server.includes("String(process.env.PILLAR_MASK).toLowerCase() : 'off';"), 'PILLAR_MASK defaults to off');
  assert.match(server, /hasBay && maskWanted && wantsPillarMask\(req\.body\)/);
});

test('a shaft the mask found is held the full height of the bay, carved top included', () => {
  /* IMG_2068, green, 2 October: the shafts held, the capitals stayed green. */
  const shaftOnly = png((x, y) => (pillar(x, y) && y >= 50 && y < 76 ? [255, 255, 255] : [0, 0, 0]));
  const r = restorePillars({ ...base, mask: shaftOnly });
  assert.ok(r.restored, r.reason);
  assert.strictEqual(px(r.buffer, 32, 42), 235, 'the capital above the shaft is the photograph');
  assert.strictEqual(px(r.buffer, 32, 78), 235, 'and the base below it');
  assert.strictEqual(px(r.buffer, 50, 42), 20, 'the frame between pillars keeps its colour');
});

test('the prompt asks for the shafts only (0044 took the whole bay)', () => {
  assert.doesNotMatch(PILLAR_PROMPT, /capital|corbel/);
});

test('the bay is cut out of the photograph for segmentation, and the box comes back', () => {
  const { cropToBox } = require('../hold');
  const c = cropToBox(original, 'image/png', bay, 0);
  const p = PNG.sync.read(c.buffer);
  assert.strictEqual(p.width, 60); assert.strictEqual(p.height, 40);
  assert.deepStrictEqual(c.box, { x: 20, y: 40, w: 60, h: 40 });
});

test('a mask made from the crop lands back on the bay, not the whole frame', () => {
  /* 60x40 mask of the bay alone: pillar shafts at crop x 10–16 and 44–50. */
  const p = new PNG({ width: 60, height: 40 });
  for (let y = 0; y < 40; y++) for (let x = 0; x < 60; x++) {
    const on = (x >= 10 && x < 16) || (x >= 44 && x < 50); const i = (y * 60 + x) * 4;
    p.data[i] = p.data[i + 1] = p.data[i + 2] = on ? 255 : 0; p.data[i + 3] = 255; }
  const r = restorePillars({ ...base, mask: PNG.sync.write(p), maskBox: { x: 20, y: 40, w: 60, h: 40 } });
  assert.ok(r.restored, r.reason);
  assert.strictEqual(px(r.buffer, 32, 60), 235, 'left pillar (frame x 30–36) restored');
  assert.strictEqual(px(r.buffer, 66, 60), 235, 'right pillar restored');
  assert.strictEqual(px(r.buffer, 50, 60), 20, 'the window between keeps the render');
});

test('the server segments a crop of the bay, not the full elevation', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /cropToBox\(img\.buffer, img\.mime, bayBox, 3\)/);
  assert.match(server, /image: bayCrop\.buffer/);
  assert.match(server, /maskBox: pm\.box/);
});

/* 0049: pillars picked by shape from every object segmentation finds. */
const { pillarsFromObjects } = require('../hold');
const C_W = 100, C_H = 60;
const cropPng = (fn) => { const p = new PNG({ width: C_W, height: C_H });
  for (let y = 0; y < C_H; y++) for (let x = 0; x < C_W; x++) { const v = fn(x, y); const i = (y * C_W + x) * 4;
    p.data[i] = p.data[i + 1] = p.data[i + 2] = v; p.data[i + 3] = 255; } return PNG.sync.write(p); };
// The photograph of the bay: smooth stone pillars at x 10–19 and 70–79, a stile at 30–31, textured curtains between.
const crop = cropPng((x, y) => ((x >= 10 && x < 20) || (x >= 70 && x < 80) || x === 30 || x === 31) ? 220 : ((x * 7 + y * 13) % 2 ? 250 : 150));
const obj = (fn) => ({ buffer: cropPng((x, y) => (fn(x, y) ? 255 : 0)), mime: 'image/png' });

test('the pillars are picked out of every object by shape and smoothness', () => {
  const masks = [
    obj((x, y) => x >= 10 && x < 20 && y >= 2 && y < 58),          // pillar
    obj((x, y) => x >= 70 && x < 80 && y >= 2 && y < 58),          // pillar
    obj((x, y) => (x === 30 || x === 31) && y >= 2 && y < 58),     // frame stile: too thin
    obj((x, y) => x >= 35 && x < 45 && y >= 2 && y < 58),          // a narrow pane of curtains: too textured
    obj((x, y) => x >= 22 && x < 68 && y >= 5 && y < 55),          // the whole window: too wide
    obj((x, y) => x >= 40 && x < 48 && y >= 2 && y < 12),          // something short, not on a pillar
  ];
  const r = pillarsFromObjects({ masks, crop });
  assert.ok(r, 'something kept');
  assert.strictEqual(r.kept, 2);
  const m = PNG.sync.read(r.buffer);
  const at = (x, y) => m.data[(y * C_W + x) * 4];
  assert.strictEqual(at(15, 30), 255); assert.strictEqual(at(75, 30), 255);
  assert.strictEqual(at(30, 30), 0, 'stile not kept'); assert.strictEqual(at(40, 30), 0, 'curtains not kept');
});

test('nothing pillar-shaped, nothing kept', () => {
  assert.strictEqual(pillarsFromObjects({ masks: [obj((x, y) => x >= 22 && x < 68)], crop }).buffer, null);
  assert.strictEqual(pillarsFromObjects({ masks: [], crop }), null);
});

test('the server picks pillars from all objects in the bay crop', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /fetchObjectMasks\(\{\s*image: bayCrop\.buffer/);
  assert.match(server, /pillarsFromObjects\(\{ masks, crop: bayCrop\.buffer/);
  const { SAM2_VERSION } = require('../windowmask');
  assert.match(SAM2_VERSION, /^[0-9a-f]{64}$/);
});

test('a capital or base sitting on a kept shaft is kept with it (0050)', () => {
  const masks = [
    obj((x, y) => x >= 10 && x < 20 && y >= 12 && y < 50),          // shaft
    obj((x, y) => x >= 7 && x < 23 && y >= 4 && y < 12),            // capital on top: squat, wider
    obj((x, y) => x >= 7 && x < 23 && y >= 50 && y < 57),           // base
    obj((x, y) => x >= 40 && x < 56 && y >= 4 && y < 12),           // same shape, not on a shaft
  ];
  const r = pillarsFromObjects({ masks, crop });
  assert.strictEqual(r.kept, 1); assert.strictEqual(r.attached, 2);
  const m = PNG.sync.read(r.buffer); const at = (x, y) => m.data[(y * C_W + x) * 4];
  assert.strictEqual(at(8, 8), 255, 'capital kept'); assert.strictEqual(at(8, 54), 255, 'base kept');
  assert.strictEqual(at(45, 8), 0, 'a squat object elsewhere is not');
  assert.ok(r.rejected.short >= 1, 'and the log says why the others were dropped');
});

test('a shaft held for 15% of the bay height is run the full height (0050)', () => {
  const { PILLAR_SHAFT_MIN } = require('../hold');
  assert.strictEqual(PILLAR_SHAFT_MIN, 0.15);
});

test('every bay in the photograph gets its own pillar pick and hold (0051)', () => {
  /* Number 14 (IMG_1830) has a bay on each floor; only the first was looked at. */
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /\.filter\(b => b\.isBay\)\.slice\(0, MAX_PILLAR_BAYS\)/);
  assert.match(server, /Promise\.all\(bayBoxes\.map\(/);
  assert.match(server, /for \(const \[n, pm\] of restore\.pillarMasks\.entries\(\)\)/);
  assert.match(server, /bay: pm\.bay/);
  assert.doesNotMatch(server, /\.find\(b => b\.isBay\)/, 'nothing should pick only the first bay any more');
});

test('two bays: each one\'s pillars are held inside its own box', () => {
  const W2 = 100, H2 = 100;
  const mk = (fn) => { const p = new PNG({ width: W2, height: H2 });
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) { const v = fn(x, y); const i = (y * W2 + x) * 4;
      p.data[i] = v[0]; p.data[i + 1] = v[1]; p.data[i + 2] = v[2]; p.data[i + 3] = 255; } return PNG.sync.write(p); };
  const upper = { x: 20, y: 10, w: 60, h: 30 }, lower = { x: 20, y: 55, w: 60, h: 35 };
  const inB = (x, y, b) => x >= b.x && x < b.x + b.w && y >= b.y && y < b.y + b.h;
  const orig = mk(() => [235, 235, 235]);
  let r = mk((x, y) => (inB(x, y, upper) || inB(x, y, lower) ? [20, 20, 20] : [235, 235, 235]));
  for (const b of [upper, lower]) {
    // a crop-sized mask with one pillar at crop x 4-10
    const cw = b.w, ch = b.h; const p = new PNG({ width: cw, height: ch });
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) { const on = x >= 4 && x < 10; const i = (y * cw + x) * 4;
      p.data[i] = p.data[i + 1] = p.data[i + 2] = on ? 255 : 0; p.data[i + 3] = 255; }
    const held = restorePillars({ render: r, renderMime: 'image/png', original: orig, originalMime: 'image/png',
      mask: PNG.sync.write(p), maskMime: 'image/png', maskBox: b, bay: b });
    assert.ok(held.restored, held.reason); r = held.buffer;
  }
  const at = (x, y) => PNG.sync.read(r).data[(y * W2 + x) * 4];
  assert.strictEqual(at(26, 25), 235, 'upper bay pillar held');
  assert.strictEqual(at(26, 70), 235, 'lower bay pillar held');
  assert.strictEqual(at(50, 25), 20, 'upper frames keep the new colour');
  assert.strictEqual(at(50, 70), 20, 'lower frames keep the new colour');
});

test('the pick log is flat, so it survives observability (0055)', () => {
  const masks = [
    obj((x, y) => x >= 10 && x < 20 && y >= 2 && y < 58),
    obj((x, y) => x >= 22 && x < 68 && y >= 5 && y < 55),
    obj((x, y) => x >= 40 && x < 48 && y >= 2 && y < 12),
  ];
  const r = pillarsFromObjects({ masks, crop });
  assert.strictEqual(typeof r.reasons, 'string');
  assert.match(r.reasons, /wide:1/); assert.match(r.reasons, /short:1/);
  assert.match(r.candidates, /^w10h93f1\.00a5\.6s\d+\+/, 'the kept shaft first, marked +');
  assert.match(r.candidates, /-wide/);
  const none = pillarsFromObjects({ masks: [masks[1]], crop });
  assert.strictEqual(none.buffer, null); assert.match(none.reasons, /wide:1/);
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /rejected: picked \? picked\.reasons \|\| '' : ''/);
  assert.doesNotMatch(server, /rejected: picked \? picked\.rejected/);
  const { scrubDetailForTest } = (() => { try { return require('../observability'); } catch (_) { return {}; } })();
  void scrubDetailForTest;
});

test('every way a pick fails to become a hold is logged (0055)', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /pillar pick not ready in time or kept nothing/);
  assert.match(server, /no window mask for this render/);
  assert.match(server, /window mask was not used, so the pillar hold did not run/);
});

test('the of-the-bay guard measures what will be held, after the shafts are run full height', () => {
  /* Dev, 4 October: ofBay was read before the extension. Thirty short columns
     are ~20% of the bay as found, ~46% once each is held top to bottom. */
  const stripes = png((x, y) => (x >= 20 && x < 80 && x % 2 === 0 && y >= 50 && y < 70 ? [255, 255, 255] : [0, 0, 0]));
  const r = restorePillars({ ...base, mask: stripes });
  assert.strictEqual(r.restored, false, 'refused: it would have held half the bay');
  assert.match(r.reason, /full height.*of the bay/);
  const ok = restorePillars(base);
  assert.ok(ok.restored && ok.ofBay < 0.45, 'real pillars still held, and ofBay reports the held area');
});
