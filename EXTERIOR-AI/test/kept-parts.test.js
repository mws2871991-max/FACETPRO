'use strict';
require('./helpers/data-dir');
/* Handoff 5 Oct §4: Ink Trim painting gates, door surrounds and gable timbers;
   a new roof laid over the gable wall and the tile-hanging. Held by two masks
   — what stays, what is changing — and the photograph pasted back where the
   first claims a pixel and the second does not. See keptparts.js. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');
const keptparts = require('../keptparts');
const { restoreKeptParts, KEPT_MAX_SHARE } = require('../hold');

const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const W = 40, H = 20;
function png(fill) {
  const p = new PNG({ width: W, height: H });
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const [r, g, b] = fill(x, y); const i = (y * W + x) * 4;
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
}
const mask = (on) => png((x, y) => on(x, y) ? [255, 255, 255] : [0, 0, 0]);
const at = (buf, x, y) => { const p = PNG.sync.read(buf); const i = (y * W + x) * 4; return [p.data[i], p.data[i + 1], p.data[i + 2]]; };

const photo = png(() => [200, 50, 50]);   // red tile-hanging, the old gate
const render = png(() => [40, 40, 40]);   // the model made all of it dark
const base = { render, renderMime: 'image/png', original: photo, originalMime: 'image/png', keepMaskMime: 'image/png', changeMaskMime: 'image/png' };

test('what keep claims and change does not goes back to the photograph', () => {
  const r = restoreKeptParts({ ...base, keepMask: mask(x => x < 20), changeMask: mask(() => false) });
  assert.equal(r.restored, true);
  assert.deepEqual(at(r.buffer, 5, 10), [200, 50, 50], 'kept wall is the photograph');
  assert.deepEqual(at(r.buffer, 30, 10), [40, 40, 40], 'outside keep, the render');
});

test('where the masks argue, the new work wins', () => {
  // keep: left half. change: the top rows (the roof). The overlap stays rendered.
  const r = restoreKeptParts({ ...base, keepMask: mask(x => x < 20), changeMask: mask((x, y) => y < 8) });
  assert.equal(r.restored, true);
  assert.deepEqual(at(r.buffer, 5, 3), [40, 40, 40], 'roof they asked for is not undone');
  assert.deepEqual(at(r.buffer, 5, 15), [200, 50, 50]);
  assert.ok(r.ceded > 0.3 && r.ceded < 0.5, `ceded ${r.ceded}`);
});

test('windows or a door being replaced on the same job are never put back', () => {
  const r = restoreKeptParts({ ...base, keepMask: mask(x => x >= 5 && x < 30), changeMask: mask(() => false),
    ours: [{ x: 0, y: 0, w: 25, h: 100 }] });
  assert.equal(r.restored, true);
  assert.deepEqual(at(r.buffer, 8, 10), [40, 40, 40], 'inside ours stays rendered');
  assert.deepEqual(at(r.buffer, 25, 10), [200, 50, 50]);
});

test('a keep mask that took most of the picture is refused, render untouched', () => {
  const r = restoreKeptParts({ ...base, keepMask: mask(() => true), changeMask: mask(() => false) });
  assert.ok(KEPT_MAX_SHARE < 1);
  assert.equal(r.restored, false);
  assert.match(r.reason, /stopped telling things apart/);
  assert.equal(r.buffer, render);
});

test('without a change mask nothing is held: nothing says where the new work is', () => {
  const r = restoreKeptParts({ ...base, keepMask: mask(x => x < 20), changeMask: null });
  assert.equal(r.restored, false);
  assert.equal(r.buffer, render);
});

test('a JPEG render or a broken mask leaves the render exactly as it was', () => {
  assert.equal(restoreKeptParts({ ...base, renderMime: 'image/jpeg', keepMask: mask(x => x < 20), changeMask: mask(() => false) }).restored, false);
  const r = restoreKeptParts({ ...base, keepMask: Buffer.from('not a png'), changeMask: mask(() => false) });
  assert.equal(r.restored, false);
  assert.equal(r.buffer, render);
});

test('the plan: nothing on new walls or without a roof or roofline', () => {
  assert.equal(keptparts.plan({ trim: true, cladding: true }), null, 'pasted parts would halo against new render');
  assert.equal(keptparts.plan({ windows: true }), null, 'windows-only jobs have their own hold');
});

test('the plan for Ink Trim keeps the gate, door frame and timbers; changes the roofline', () => {
  const p = keptparts.plan({ trim: true });
  for (const w of ['gate', 'door frame', 'timber beam', 'wooden bracket', 'window frame', 'front door']) assert.match(p.keep, new RegExp(w));
  for (const w of ['fascia', 'soffit', 'gutter', 'bargeboard']) assert.match(p.change, new RegExp(w));
  assert.doesNotMatch(p.keep, /fascia|bargeboard/);
});

test('the plan for a roof keeps the gable wall and tile-hanging', () => {
  const p = keptparts.plan({ roof: true });
  assert.match(p.keep, /tile hanging/);
  assert.match(p.keep, /gable wall/);
  assert.equal(p.change, 'roof');
});

test('windows and door being replaced are not kept', () => {
  const p = keptparts.plan({ trim: true, windows: true, door: true });
  assert.doesNotMatch(p.keep, /window frame|front door|door frame|porch/);
  assert.doesNotMatch(keptparts.plan({ roof: true, windows: true }).keep, /bay window/,
    'a box missing the edge of a bay must not let the old frame back');
  assert.match(keptparts.plan({ roof: true }).keep, /bay window/);
});

test('a door being replaced that detection did not find stands the hold down', () => {
  assert.match(s, /if \(changing\.door && !door\) \{\s*obs\.record\('render', 'kept parts not held'/);
});

test('the masks are kept per photograph, and a failed one is forgotten', () => {
  assert.match(s, /keepRecord\.keptMasks = keepRecord\.keptMasks \|\| new Map\(\)/);
  assert.match(s, /if \(!m && keptCache\) keptCache\.delete\(prompt\)/);
});

test('switch: off by default, test needs the experiment, on is on', () => {
  assert.equal(keptparts.mode({}), 'off');
  assert.equal(keptparts.enabled({ experiments: ['kept-parts'] }, {}), false);
  assert.equal(keptparts.enabled({}, { KEPT_PARTS: 'test' }), false);
  assert.equal(keptparts.enabled({ experiments: ['kept-parts'] }, { KEPT_PARTS: 'test' }), true);
  assert.equal(keptparts.enabled({}, { KEPT_PARTS: 'on' }), true);
  assert.match(html, /exp=kept\\b\/\.test\(location\.search\)\) e\.push\('kept-parts'\)/);
});

test('the render asks for both masks beside the render, never on a driveway job', () => {
  assert.match(s, /const keptPlan = \(!driveway && keptparts\.enabled\(req\.body\)\)/);
  assert.match(s, /Promise\.all\(\[keptMask\(keptPlan\.keep, 'keep'\), keptMask\(keptPlan\.change, 'change'\)\]\)/);
  const i = s.indexOf('const keptPromise'), j = s.indexOf('runFluxOrRetry({ prompt, inputImage');
  assert.ok(i > 0 && i < j, 'started before the render, not after it');
});

test('the masks are waited for with the window mask\'s bound, and a miss says so', () => {
  assert.match(s, /const kept = await maskWithinGrace\(keptPromise, keptWaitMs\)/);
  assert.match(s, /const keptWaitMs = Math\.min\(MASK_MAX_WAIT_MS,/);
  assert.match(s, /'kept parts not held', \{ reason: 'masks not ready in time'/);
});

test('the hold runs first in keepRender, and keeps clear of windows and door being replaced', () => {
  const k = s.slice(s.indexOf('async function keepRender('), s.indexOf('async function respondWithRender('));
  const i = k.indexOf('restoreKeptParts('), d = k.indexOf('restoreDoor({');
  assert.ok(i > 0 && i < d, 'before the door and window holds');
  assert.match(k, /changing\.windows && detections \? glazing\.frontWindowBoxes/);
  assert.match(k, /\(changing\.windows \|\| changing\.door\) && !detections/);
});
