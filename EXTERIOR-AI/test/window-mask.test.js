/* The window mask: asking what is a window at the pixel, and holding the
   render to it. Run: npm test

   The case behind all of it is number 14, an Edwardian mid-terrace with two
   painted bays, rendered live on 28 September in Chartwell Green. Both bays
   came back lime — pilasters, cornice, the corbels under the sill, the sill,
   the brick between the bays, and the wheelie bins parked under it — while the
   sashes inside stayed white. restoreSurroundings could not undo it: it keeps
   a changed patch whole when the patch touches a window box, and detection
   returns a bay as ONE box 36% of the frame wide. */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { PNG } = require('pngjs');

const { restoreOutsideMask, MASK_ON } = require('../hold');
const { fetchWindowMask, maskPrompt, MODEL_VERSION, MASK_INDEX } = require('../windowmask');

/* ── helpers ── */

const png = (w, h, paint) => {
  const p = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = paint(x, y);
    p.data[i] = r; p.data[i + 1] = g; p.data[i + 2] = b; p.data[i + 3] = 255;
  }
  return PNG.sync.write(p);
};
const read = (buf) => PNG.sync.read(buf);
const at = (p, x, y) => {
  const i = (y * p.width + x) * 4;
  return [p.data[i], p.data[i + 1], p.data[i + 2]];
};

/* A 40x40 frame. A "window" occupies x 10..19; everything else is wall.
   The photograph is blue, the render is red — so any red left outside the
   window is the render escaping, which is the whole defect. */
const W = 40, H = 40;
const inWindow = (x) => x >= 10 && x <= 19;
const ORIGINAL = png(W, H, () => [0, 0, 255]);
const RENDER = png(W, H, () => [255, 0, 0]);
const MASK = png(W, H, (x) => (inWindow(x) ? [255, 255, 255] : [0, 0, 0]));

/* ── the composite ── */

test('the render is kept inside the mask and the photograph everywhere else', () => {
  const r = restoreOutsideMask({
    render: RENDER, renderMime: 'image/png',
    original: ORIGINAL, originalMime: 'image/png',
    mask: MASK, maskMime: 'image/png',
  });
  assert.strictEqual(r.restored, true, r.reason || '');
  const out = read(r.buffer);
  assert.deepStrictEqual(at(out, 15, 20), [255, 0, 0], 'the window should still be the render');
  assert.deepStrictEqual(at(out, 2, 20), [0, 0, 255], 'the wall should be the photograph again');
  assert.deepStrictEqual(at(out, 38, 38), [0, 0, 255], 'the bins under the bay should be the photograph again');
  assert.ok(Math.abs(r.insideShare - 0.25) < 0.02, `expected a quarter of the frame inside, got ${r.insideShare}`);
});

test('a mask that does not describe this photograph is refused, not stretched', () => {
  /* Holding the wrong half of a house to the photograph is worse than not
     holding it at all, and a shape mismatch is the one sign of it available
     without understanding the picture. */
  const wrong = png(10, 40, () => [255, 255, 255]);
  const r = restoreOutsideMask({
    render: RENDER, renderMime: 'image/png',
    original: ORIGINAL, originalMime: 'image/png',
    mask: wrong, maskMime: 'image/png',
  });
  assert.strictEqual(r.restored, false);
  assert.match(r.reason, /mask is 10x40/);
});

test('an empty mask and a total mask are both segmentation failing, not houses', () => {
  const none = png(W, H, () => [0, 0, 0]);
  const all = png(W, H, () => [255, 255, 255]);
  const run = (mask) => restoreOutsideMask({
    render: RENDER, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    mask, maskMime: 'image/png',
  });
  /* An empty mask would hand back the photograph and call it a render. */
  assert.strictEqual(run(none).restored, false, 'an empty mask must not be used');
  /* A full one holds nothing, so the bay stays lime and we have paid twice. */
  assert.strictEqual(run(all).restored, false, 'a mask over the whole frame must not be used');
});

test('the mask is thresholded high, because it arrives as a JPEG', () => {
  /* The model names its outputs .png and returns JPEG. Ringing beside a hard
     edge overshoots both ways, and letting stray light pixels through outside
     a window puts specks of render back on the brickwork. */
  assert.ok(MASK_ON > 128, 'a mid-grey threshold would admit JPEG ringing as window');
  const greyish = png(W, H, (x) => (inWindow(x) ? [255, 255, 255] : [MASK_ON - 20, MASK_ON - 20, MASK_ON - 20]));
  const r = restoreOutsideMask({
    render: RENDER, renderMime: 'image/png', original: ORIGINAL, originalMime: 'image/png',
    mask: greyish, maskMime: 'image/png',
  });
  assert.strictEqual(r.restored, true, r.reason || '');
  assert.deepStrictEqual(at(read(r.buffer), 2, 20), [0, 0, 255], 'near-threshold grey was treated as window');
});

test('a render that is not a PNG is left exactly as it came', () => {
  const r = restoreOutsideMask({
    render: RENDER, renderMime: 'image/jpeg',
    original: ORIGINAL, originalMime: 'image/png', mask: MASK, maskMime: 'image/png',
  });
  assert.strictEqual(r.restored, false);
  assert.strictEqual(r.buffer, RENDER, 'the render buffer must come back untouched');
});

/* ── asking for the mask ── */

const okPredict = (output) => async (url, opts) => {
  if (String(url).endsWith('/v1/predictions')) {
    return { ok: true, json: async () => ({ id: 'p1', status: 'succeeded', output }) };
  }
  return { ok: true, arrayBuffer: async () => MASK.buffer.slice(MASK.byteOffset, MASK.byteOffset + MASK.length) };
};

test('the door joins the mask only when the door is being replaced', () => {
  /* A door left out of the mask falls outside it and comes back from the
     photograph, which is what keeping a door means. A door being replaced that
     fell outside would be un-replaced by the hold that is meant to protect
     it. */
  assert.strictEqual(maskPrompt({ changingDoor: false }), 'window');
  assert.match(maskPrompt({ changingDoor: true }), /front door/);
});

test('no negative prompt is ever sent', () => {
  /* Both negatives tried on number 14 took the usable mask from 25.4% of the
     frame to 0.2%: a negative region swallows the positive it overlaps, and
     every window on a house sits on a wall. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'windowmask.js'), 'utf8');
  assert.match(src, /negative_mask_prompt: ''/, 'a negative prompt has been reintroduced');
});

test('a mask is asked for with the pinned version and read by index', async () => {
  let sent = null;
  const fetchImpl = async (url, opts) => {
    if (String(url).endsWith('/v1/predictions')) {
      sent = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'p1', status: 'succeeded', output: ['a', 'b', 'c', 'd'] }) };
    }
    assert.strictEqual(url, 'c', `the mask is output index ${MASK_INDEX}`);
    return { ok: true, arrayBuffer: async () => Uint8Array.from([0xff, 0xd8, 0xff, 0x01]).buffer };
  };
  const got = await fetchWindowMask({
    image: Buffer.from('photo'), mime: 'image/jpeg', replicateKey: 'k',
    deadlineAt: Date.now() + 90000, fetchImpl,
  });
  assert.ok(got, 'a mask should have come back');
  assert.strictEqual(got.mime, 'image/jpeg', 'the model returns JPEG whatever it names the file');
  assert.strictEqual(sent.version, MODEL_VERSION, 'the model version must stay pinned');
  assert.strictEqual(sent.input.mask_prompt, 'window');
  assert.ok(sent.input.adjustment_factor > 0, 'the mask must be dilated to take in the frame');
});

test('every way this can fail answers null, and none of them throws', async () => {
  const base = { image: Buffer.from('photo'), mime: 'image/jpeg', replicateKey: 'k', deadlineAt: Date.now() + 90000 };
  const cases = {
    'no token': { ...base, replicateKey: '' },
    'no photograph': { ...base, image: null },
    'no time left': { ...base, deadlineAt: Date.now() + 500 },
    'refused': { ...base, fetchImpl: async () => ({ ok: false, status: 422, json: async () => ({ detail: 'nope' }) }) },
    'threw': { ...base, fetchImpl: async () => { throw new Error('socket'); } },
    'failed': { ...base, fetchImpl: async () => ({ ok: true, json: async () => ({ id: 'p', status: 'failed', error: 'oom' }) }) },
    'too few outputs': { ...base, fetchImpl: okPredict(['only-one']) },
    'empty mask body': {
      ...base,
      fetchImpl: async (url) => String(url).endsWith('/v1/predictions')
        ? { ok: true, json: async () => ({ id: 'p', status: 'succeeded', output: ['a', 'b', 'c'] }) }
        : { ok: true, arrayBuffer: async () => new ArrayBuffer(0) },
    },
  };
  for (const [what, args] of Object.entries(cases)) {
    const notes = [];
    const got = await fetchWindowMask({ ...args, onNote: (n) => notes.push(n) });
    assert.strictEqual(got, null, `${what} should answer null`);
    assert.ok(notes.length, `${what} should say why`);
  }
});

/* ── how the render uses it ── */

test('the mask is asked for beside the render, not after it', () => {
  /* Segmentation needs only the photograph. Started after FLUX it would add
     its whole latency to the homeowner's wait; started beside it, it finishes
     inside the render's own. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const startedAt = src.indexOf('const maskPromise');
  const fluxAt = src.indexOf('const first = await runFlux');
  const awaitedAt = src.indexOf('const mask = await maskWithinGrace(maskPromise)');
  assert.ok(startedAt > 0 && fluxAt > 0 && awaitedAt > 0, 'the concurrent mask fetch has gone');
  assert.ok(startedAt < fluxAt, 'the mask must be started before the render is awaited');
  assert.ok(awaitedAt > fluxAt, 'the mask must be awaited after the render, not before');
});

test('the mask is only asked for when windows are the only thing changing', () => {
  /* A mask of the windows holds everything else to the photograph, which would
     throw away a new roof or new walls along with the bins. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /const maskWanted = !!\(doorRestore && doorRestore\.surroundings\)/,
    'the mask is no longer gated on a windows-only job');
});

test('the patch hold remains, as the fallback and only as the fallback', () => {
  /* Both answer "what here is not a window" — the mask at the pixel, the
     patches by inference from boxes. Running the second over the first would
     put the weaker judgement back on top. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at2 = src.indexOf('if (restore.surroundings) {');
  const block = src.slice(at2, at2 + 2200);
  assert.match(block, /if \(masked\.restored\) \{/, 'the mask is no longer tried first');
  assert.match(block, /\} else \{[\s\S]*restoreSurroundings\(/, 'the patch hold is no longer the fallback');
  const maskedAt = block.indexOf('restoreOutsideMask(');
  const patchAt = block.indexOf('restoreSurroundings(');
  assert.ok(maskedAt > 0 && patchAt > maskedAt, 'the patch hold must come after the mask, inside the else');
});

test('a finished render waits a few seconds for the mask, never a cold start', async () => {
  /* Measured: 82.8s cold, 2.0s and 5.7s warm. The two run side by side so the
     warm case is free, but a render that came back at 30s must not then sit
     waiting fifty more for segmentation — the picture already exists. */
  const { maskWithinGrace, GRACE_MS } = require('../windowmask');
  assert.ok(GRACE_MS >= 4000 && GRACE_MS <= 10000, `grace of ${GRACE_MS}ms is outside anything defensible`);

  const ready = Promise.resolve({ buffer: Buffer.from('m'), mime: 'image/jpeg' });
  assert.ok(await maskWithinGrace(ready, 50), 'a mask already in hand must be used');

  const cold = new Promise((r) => setTimeout(() => r({ buffer: Buffer.from('m'), mime: 'image/jpeg' }), 400));
  const t0 = Date.now();
  assert.strictEqual(await maskWithinGrace(cold, 40), null, 'a slow mask must be given up on');
  assert.ok(Date.now() - t0 < 300, 'giving up should not wait for the mask anyway');

  /* And the pending request must not take the render down with it. */
  assert.strictEqual(await maskWithinGrace(null, 10), null);
});

test('the mask is started when the photograph arrives, not when the render does', () => {
  /* The measurement that forced this: 2.0s warm, 82.8s cold, and three of four
     calls cold during a day's testing. A render waits GRACE_MS and no longer,
     so a mask started at render time would almost never be used. Started at
     upload it has the whole of the person's choosing time as a head start. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  /* Since 28 September the warm-up lives in prepareWindowMask, so the cache
     paths can share it (see the test below); the fresh reading calls it
     straight after saving its record. */
  const warmAt = src.indexOf('record.maskPromise = fetchWindowMask(');
  assert.ok(warmAt > 0, 'the mask is no longer prepared at upload');
  assert.match(src.slice(warmAt - 400, warmAt), /elev !== 'front'/,
    'the back of a house has no render path that uses this');
  const detectAt = src.indexOf('const detectionId = saveDetectionRecord(detections, size, elevation);');
  const callAt = src.indexOf('prepareWindowMask(detectionRecords.get(detectionId), elevation);');
  assert.ok(detectAt > 0 && callAt > detectAt && callAt - detectAt < 1600,
    'the warm-up should sit with the detection record it hangs off');
});

test('a second colour on the same photograph does not pay for a second mask', () => {
  /* The mask describes the photograph, not the choice. Someone trying four
     colours should buy one. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const at2 = src.indexOf('const maskPromise = !maskWanted');
  const block = src.slice(at2, at2 + 1200);
  assert.match(block, /maskRecord\?\.windowMask \? Promise\.resolve\(maskRecord\.windowMask\)/,
    'a finished mask on the record is no longer reused');
  assert.match(block, /maskRecord\?\.maskPromise \? maskRecord\.maskPromise/,
    'a mask already in flight from the upload is no longer picked up');
  assert.match(src, /if \(maskRecord && mask && !maskRecord\.windowMask\) maskRecord\.windowMask = mask;/,
    'a mask fetched at render time is not kept for the next one');
});

test('the segmentation budget is measured from the start, not from the POST', () => {
  /* Prefer: wait holds the request up to sixty seconds. Setting the polling
     deadline afterwards let a cold start spend 60s in the POST and a further
     75s polling — measured at 88.9s on a run that should have given up. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'windowmask.js'), 'utf8');
  const budgetAt = src.indexOf('const giveUpAt = Date.now() + waitMs;');
  const postAt = src.indexOf("await fetchImpl('https://api.replicate.com/v1/predictions'");
  assert.ok(budgetAt > 0, 'the deadline is no longer taken before the request');
  assert.ok(budgetAt < postAt, 'the deadline must be set before the POST, not after it');
  assert.ok(!/const until = Date\.now\(\) \+ waitMs/.test(src), 'the post-POST deadline is back');
});

test('a photo answered from either cache still gets its mask started', () => {
  /* 28 September: number 14, answered from the detection cache, rendered
     with no mask (the render's own start lost GRACE_MS to a cold start) and
     both bays came back green. The cache paths must start it too. */
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(src, /if \(seen\) \{ prepareWindowMask\(seen, seen\.elevation \|\| elevation\); return answer\(seen, seenId\); \}/,
    'the in-process cache answers without starting the mask');
  assert.match(src, /prepareWindowMask\(detectionRecords\.get\(id\), elevation\);\s*return answer\(detectionRecords\.get\(id\), id\);/,
    'the stored cache answers without starting the mask');
  assert.match(src, /prepareWindowMask\(detectionRecords\.get\(detectionId\), elevation\);/,
    'a fresh reading no longer starts the mask');
  // Idempotent, so the cache paths can call it on every upload.
  assert.match(src, /if \(record\.windowMask \|\| record\.maskPromise\) return;/);
});
