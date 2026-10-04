/* Putting back what the homeowner told us to keep.

   renderprompt.js asks the model to leave the front door alone whenever the
   windows are changing and the door is not — HOLDS.doorOnly, added on
   23 September after a windows-only render came back with an anthracite door.
   It did not hold. The same photograph, the same day, on the build carrying
   that fix: frames anthracite as asked, and the door anthracite too, under a
   panel reading "Keep my front door — don't price them". Wording has lost this
   argument the way it lost the roof one (see framing in server.js).

   So the door is restored from the photograph after the render, rather than
   requested more firmly before it. The model's output is the same shape as
   its input (aspect_ratio: match_input_image), so a box in percentages of the
   photograph is the same box in the render.

   Deliberately narrow:
     - the front door only, from the detection record, and only when it was
       found with confidence;
     - only when the walls are not changing — a door pasted from the original
       carries a sliver of the original wall round its frame, which is
       invisible against the same brick and a halo against new render;
     - PNG render in, PNG out; JPEG or PNG photograph. Anything else, or any
       failure at all, returns the render untouched. A render with a changed
       door is a disappointment; a render that fails to save is a lost render. */

'use strict';

const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');
const { detectionList } = require('./geometry');

const MIN_DOOR_CONFIDENCE = 0.6;
/* Out past the detected box, as a fraction of its size, so the seam lands
   on wall that was never changing.

   Wider across than up and down, because that is how the boxes miss. On the
   first live run (23 September) detection put the door at 66–75% across while
   the door itself ran 62–74%; an 8% margin restored the right-hand two thirds
   and left an anthracite strip down the hinge side — a two-tone door, worse
   than no restore. Render and photograph line up to within a pixel or two
   (measured: unchanged brick matches best at zero offset and clearly worse
   at 4px), and this only runs when the walls are not changing, so extra
   margin pastes brick over identical brick. */
const MARGIN_X = 0.45;
const MARGIN_Y = 0.08;
// Soft edge, as a fraction of the box's shorter side.
const FEATHER = 0.12;

// Windows are changing, so the restore must never reach into one.
function windowBoxes(detections) {
  return detectionList(detections)
    .filter(d => d && d.type === 'window' && Number(d.w_pct) > 0 && Number(d.h_pct) > 0)
    .map(d => ({ x: Number(d.x_pct), y: Number(d.y_pct), w: Number(d.w_pct), h: Number(d.h_pct) }));
}

function doorBox(detections) {
  const doors = detectionList(detections)
    .filter(d => d && d.type === 'door-front' && Number(d.confidence) >= MIN_DOOR_CONFIDENCE
      && Number(d.w_pct) > 0 && Number(d.h_pct) > 0)
    .sort((a, b) => Number(b.confidence) - Number(a.confidence));
  if (!doors.length) return null;
  const d = doors[0];
  return { x: Number(d.x_pct), y: Number(d.y_pct), w: Number(d.w_pct), h: Number(d.h_pct) };
}

function decode(buffer, mime) {
  if (/png/i.test(mime)) {
    const p = PNG.sync.read(buffer);
    return { width: p.width, height: p.height, data: p.data };
  }
  if (/jpe?g/i.test(mime)) {
    // maxMemoryUsageInMB: the photograph is at most a few megapixels by the
    // time the client has downscaled it, and a hostile one should fail here.
    const j = jpeg.decode(buffer, { useTArray: true, maxMemoryUsageInMB: 256 });
    return { width: j.width, height: j.height, data: j.data };
  }
  return null;
}

/* The photograph cut to a box given in percent, as a PNG, with the box that
   was actually cut (clamped to the frame). For the pillar mask: on a whole
   elevation the columns are a few per cent of the picture and segmentation
   takes the bay as one object; given the bay alone they are its dominant
   vertical structures. */
function cropToBox(buffer, mime, box, marginPct = 0) {
  try {
    const src = decode(buffer, mime || '');
    if (!src || !box || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(box[k])))) return null;
    const x0 = Math.max(0, Math.floor((Number(box.x) - marginPct) * src.width / 100));
    const y0 = Math.max(0, Math.floor((Number(box.y) - marginPct) * src.height / 100));
    const x1 = Math.min(src.width, Math.ceil((Number(box.x) + Number(box.w) + marginPct) * src.width / 100));
    const y1 = Math.min(src.height, Math.ceil((Number(box.y) + Number(box.h) + marginPct) * src.height / 100));
    const w = x1 - x0, h = y1 - y0;
    if (w < 16 || h < 16) return null;
    const out = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) {
      const from = ((y0 + y) * src.width + x0) * 4;
      src.data.copy ? src.data.copy(out.data, y * w * 4, from, from + w * 4)
        : out.data.set(src.data.subarray(from, from + w * 4), y * w * 4);
    }
    return { buffer: PNG.sync.write(out), mime: 'image/png',
      box: { x: x0 * 100 / src.width, y: y0 * 100 / src.height, w: w * 100 / src.width, h: h * 100 / src.height } };
  } catch (_) { return null; }
}

/* The pillars among every object segmentation found in the bay crop
   (fetchObjectMasks). Kept: tall (at least half the crop's height), narrow
   but wider than a frame stile, solid, and smooth in the photograph — stone
   or render, not glass or net curtains. Measured on IMG_2068's bay: the
   pillars' brightness varies by 14–26 (standard deviation), the curtains
   and glass 31–40. Returns one crop-sized PNG mask, or null. */
/* minH 0.35 → 0.25 (3 October), from the IMG_1830 run on 0055. Every object
   in both bays was rejected `short` — 10 of 10 and 12 of 12, on all six
   renders — so no other rule was ever reached. The two best candidates are
   plainly the pillars and clear everything else comfortably:

     w3h30  f0.94 a9.8 s11    the shaft: 3% wide, 30% tall, 94% solid
     w12h31 f0.72 a2.1 s19    the shaft with its capital

   Both die on height alone. Nothing about these pillars differs from
   IMG_2068's; the CROP does. IMG_2068 has one bay and its crop is close to
   the bay itself, so a shaft spans most of it. IMG_1830's two bays are
   stacked, so each crop takes in roof edge, sill and brickwork, and the same
   column fills a third of it. minH is measured against the crop, so it reads
   the framing as much as the pillar — which is why a figure tuned on one
   house fell flat on the next.

   0.25 and not lower: it admits both candidates above, while bay 2's tallest
   (h16) would need 0.15 — and at 0.15 height contributes almost nothing, so
   aspect and smoothness would carry the whole decision. Those are the rules
   keeping sills and transoms out. One step, then measure.

   The sturdier fix is to measure height against the bay box rather than the
   crop, so the threshold stops moving with the framing.

   minW 0.035 → 0.025 (4 October), measured bay-relative. With 0068 in, the
   IMG_1830 candidates read against the bay instead of the crop:

     w14h39 f0.72 a2.1 s19   the shaft with its capital   → squat (2.1 < 2.5)
     w3h38  f0.94 a9.8 s11   the bare shaft               → thin  (3% < 3.5%)

   The second is a column and nothing else: 38% of the bay tall, 94% solid,
   nearly ten times taller than wide, and the smoothest object in the crop at
   11 against the glass and net curtains' 31–40. It fails one rule, by half a
   percentage point, and the rule is simply set above the width of a real
   pillar — a mullion between bay panes is about 3% of the bay across.

   Only this one moves. minAspect stays at 2.5: it is what keeps sills,
   transoms and the odd wide capital out, and the capital above this shaft
   should be picked up by PILLAR_ATTACH, which exists for exactly that. If a
   later house needs the aspect rule relaxed too, that wants its own evidence
   rather than being swept in here. */
const PILLAR_PICK = { minH: 0.25, minW: 0.025, maxW: 0.2, minFill: 0.55, minAspect: 2.5, maxStd: 34, maxArea: 0.25 };
/* Pass two: the carved capital and the base are their own objects, squat and
   textured, so the shape test above throws them away (0049 on IMG_2068: 16
   objects, 1 kept, capitals green). Any object sitting on a kept shaft —
   centred over it, touching it top or bottom, not much wider, not tall — is
   kept with it. */
const PILLAR_ATTACH = { maxWidthX: 2.5, maxH: 0.35, gap: 0.04, maxStd: 60 };
/* Measured against the BAY, not the crop (4 October).
 *
 * minH, minW and maxArea were all fractions of the crop, and the crop is not
 * a stable thing to measure against: cropToBox takes the bay box plus three
 * percentage points of the FRAME on each side, so how much of the crop the
 * bay fills depends on how big the bay is in the photograph.
 *
 *   IMG_2068   one bay, 47% of the frame wide — the bay is ~89% of its crop
 *   IMG_1830   two stacked bays, 20% tall each — the bay is ~77% of its crop
 *
 * So the same column measures ~15% smaller on the second house for no reason
 * but framing, and that is the whole story of this feature: 0.35 was tuned on
 * IMG_2068, every object on IMG_1830 came back `short`, 0.25 admitted two of
 * them, and the next two rules then rejected those two by fractions of a
 * percent. Three of the seven rules were reading the crop.
 *
 * Given the bay's size inside the crop, they read the bay instead and one set
 * of numbers can mean the same thing on every house. Without it (no bay
 * passed) the crop is used exactly as before. Aspect, fill and smoothness are
 * ratios and were never affected. */
function pillarsFromObjects({ masks, crop, cropMime = 'image/png', bayBox = null, cropBox = null } = {}) {
  try {
    const src = decode(crop, cropMime);
    if (!src || !Array.isArray(masks) || !masks.length) return null;
    const W = src.width, H = src.height;
    /* The bay's own size in pixels of this crop, when the caller knows it. */
    const frac = (a, b) => (Number.isFinite(Number(a)) && Number(b) > 0 ? Math.min(1, Number(a) / Number(b)) : 1);
    const refW = W * (bayBox && cropBox ? frac(bayBox.w, cropBox.w) : 1);
    const refH = H * (bayBox && cropBox ? frac(bayBox.h, cropBox.h) : 1);
    const objs = [];
    for (const mk of masks) {
      const m = mk && decode(mk.buffer, mk.mime || '');
      if (!m) continue;
      let minX = W, maxX = -1, minY = H, maxY = -1, n = 0, sum = 0, sum2 = 0;
      const on = [];
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const mx = Math.min(m.width - 1, Math.round((x + 0.5) * m.width / W - 0.5));
        const my = Math.min(m.height - 1, Math.round((y + 0.5) * m.height / H - 0.5));
        if (m.data[(my * m.width + mx) * 4] < 128) continue;
        const i = (y * W + x) * 4, l = (src.data[i] + src.data[i + 1] + src.data[i + 2]) / 3;
        n++; sum += l; sum2 += l * l; on.push(y * W + x);
        if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
      if (!n) continue;
      const bw = maxX - minX + 1, bh = maxY - minY + 1;
      objs.push({ on, n, minX, maxX, minY, maxY, bw, bh, std: Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2)) });
    }
    /* Why each object was or was not a shaft, for the log: the next live test
       should say which rule failed rather than leave it to be guessed. */
    const why = (o) => {
      if (o.bh < PILLAR_PICK.minH * refH) return 'short';
      if (o.bw < PILLAR_PICK.minW * refW) return 'thin';
      if (o.bw > PILLAR_PICK.maxW * refW) return 'wide';
      if (o.n / (o.bw * o.bh) < PILLAR_PICK.minFill) return 'hollow';
      if (o.bh / o.bw < PILLAR_PICK.minAspect) return 'squat';
      if (o.n > PILLAR_PICK.maxArea * refW * refH) return 'big';
      if (o.std > PILLAR_PICK.maxStd) return 'textured';
      return null;
    };
    const rejected = {};
    const shafts = [];
    for (const o of objs) { const r = why(o); if (r) rejected[r] = (rejected[r] || 0) + 1; else shafts.push(o); }
    /* For the log (0055), flat strings because observability keeps no nested
       objects: the reasons, and the measurements of the tallest few objects —
       width and height as % of the crop, solidity, aspect, smoothness, and
       the rule that dropped it — so a "kept 0" says which threshold to move. */
    const reasons = Object.entries(rejected).map(([k, v]) => `${k}:${v}`).join(' ');
    const candidates = objs.slice().sort((a, b) => b.bh - a.bh).slice(0, 6).map(o =>
      `w${Math.round(o.bw * 100 / refW)}h${Math.round(o.bh * 100 / refH)}f${(o.n / (o.bw * o.bh)).toFixed(2)}a${(o.bh / o.bw).toFixed(1)}s${Math.round(o.std)}${why(o) ? '-' + why(o) : '+'}`).join(' ');
    if (!shafts.length) return { buffer: null, kept: 0, attached: 0, rejected, reasons, candidates };
    const kept = new Set(shafts);
    let attached = 0;
    for (const o of objs) {
      if (kept.has(o)) continue;
      const cx = (o.minX + o.maxX) / 2;
      const on = shafts.find(sh => cx >= sh.minX && cx <= sh.maxX
        && o.bw <= PILLAR_ATTACH.maxWidthX * sh.bw && o.bh <= PILLAR_ATTACH.maxH * refH && o.std <= PILLAR_ATTACH.maxStd
        && (Math.abs(o.maxY - sh.minY) <= PILLAR_ATTACH.gap * refH || Math.abs(o.minY - sh.maxY) <= PILLAR_ATTACH.gap * refH
            || (o.minY < sh.minY && o.maxY > sh.minY) || (o.minY < sh.maxY && o.maxY > sh.maxY)));
      if (on) { kept.add(o); attached++; }
    }
    const union = new Uint8Array(W * H);
    for (const o of kept) for (const k of o.on) union[k] = 1;
    const out = new PNG({ width: W, height: H });
    for (let k = 0; k < W * H; k++) { const v = union[k] ? 255 : 0; out.data[k * 4] = out.data[k * 4 + 1] = out.data[k * 4 + 2] = v; out.data[k * 4 + 3] = 255; }
    return { buffer: PNG.sync.write(out), mime: 'image/png', kept: shafts.length, attached, rejected, reasons, candidates };
  } catch (_) { return null; }
}

/* Bilinear sample of the photograph at render coordinates, so a 600px photo
   laid into a 1184px render does not come back blocky. */
function sample(src, fx, fy, out) {
  const x = Math.min(src.width - 1, Math.max(0, fx));
  const y = Math.min(src.height - 1, Math.max(0, fy));
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1);
  const ax = x - x0, ay = y - y0;
  for (let c = 0; c < 3; c++) {
    const p = (xx, yy) => src.data[(yy * src.width + xx) * 4 + c];
    out[c] = (p(x0, y0) * (1 - ax) + p(x1, y0) * ax) * (1 - ay)
           + (p(x0, y1) * (1 - ax) + p(x1, y1) * ax) * ay;
  }
}

/* Returns { buffer, restored } — restored false means the render is exactly
   what came in, and why is in `reason` for the log. */
function restoreDoor(opts) {
  /* Destructured inside, not in the signature: a default only
     catches undefined, and these must refuse null too. Everything
     else here is written so a bad input is a refusal rather than a
     throw — this is the one path that was not. */
  const { render, renderMime, original, originalMime, detections } = opts || {};
  const untouched = (reason) => ({ buffer: render, restored: false, reason });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    const box = doorBox(detections);
    if (!box) return untouched('no confident front door');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');

    const out = PNG.sync.read(render);
    const W = out.width, H = out.height;

    const mx = box.w * MARGIN_X, my = box.h * MARGIN_Y;
    let left = Math.max(0, (box.x - mx) / 100 * W);
    let top = Math.max(0, (box.y - my) / 100 * H);
    let right = Math.min(W, (box.x + box.w + mx) / 100 * W);
    let bottom = Math.min(H, (box.y + box.h + my) / 100 * H);
    /* Pull each edge back off any window it reached, towards the door. The
       door itself is never inside a window, so whichever side the window is
       on is the side to give up. */
    const doorCx = (box.x + box.w / 2) / 100 * W, doorCy = (box.y + box.h / 2) / 100 * H;
    for (const w of windowBoxes(detections)) {
      const wl = w.x / 100 * W, wr = (w.x + w.w) / 100 * W, wt = w.y / 100 * H, wb = (w.y + w.h) / 100 * H;
      if (wr <= left || wl >= right || wb <= top || wt >= bottom) continue;
      if (wr <= doorCx) left = Math.max(left, wr);
      else if (wl >= doorCx) right = Math.min(right, wl);
      else if (wb <= doorCy) top = Math.max(top, wb);
      else bottom = Math.min(bottom, wt);
    }
    if (right - left < 4 || bottom - top < 4) return untouched('door too small to restore');
    const feather = Math.max(1, Math.min(right - left, bottom - top) * FEATHER);

    const sx = src.width / W, sy = src.height / H;
    const px = [0, 0, 0];
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      for (let x = Math.floor(left); x < Math.ceil(right); x++) {
        // 1 inside, easing to 0 across the feather at every edge.
        const edge = Math.min(x - left, right - 1 - x, y - top, bottom - 1 - y);
        if (edge < 0) continue;
        const a = Math.min(1, edge / feather);
        sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, px);
        const i = (y * W + x) * 4;
        for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(out.data[i + c] * (1 - a) + px[c] * a);
      }
    }
    return { buffer: PNG.sync.write(out), restored: true, reason: null };
  } catch (err) {
    return untouched(`restore failed: ${err.message}`);
  }
}

/* The pixels the model changed, and which groups of them are the windows we
   asked for. Shared by restoreSurroundings (everything else goes back) and
   drawGeorgianBars (the bars go inside these). See restoreSurroundings for why
   each rule is there. */
function erode(A, W, H) {
  const B = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    B[k] = (A[k] && A[k - 1] && A[k + 1] && A[k - W] && A[k + W]) ? 1 : 0;
  }
  return B;
}
function dilate(A, W, H) {
  const B = new Uint8Array(W * H);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const k = y * W + x;
    B[k] = (A[k] || A[k - 1] || A[k + 1] || A[k - W] || A[k + W]) ? 1 : 0;
  }
  return B;
}
function findWindowChanges({ out, orig, W, H, keepBoxes }) {
  const N = W * H;
  const changed = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    let d = 0;
    for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(out.data[k * 4 + c] - orig[k * 3 + c]));
    changed[k] = d > CHANGE_T ? 1 : 0;
  }

  const keepZones = keepBoxes.map(d => {
    const l = Number(d.x_pct) / 100 * W, t = Number(d.y_pct) / 100 * H;
    const w = Number(d.w_pct) / 100 * W, h = Number(d.h_pct) / 100 * H;
    return { l: l - w * KEEP_GROW, t: t - h * KEEP_GROW, r: l + w * (1 + KEEP_GROW), b: t + h * (1 + KEEP_GROW) };
  });

  /* Which changes are the windows.

     First version grouped the raw changes and kept any group touching a
     window. Live on 24 September that left half the fascia anthracite: the
     fascia is a line a few pixels tall whose lower edge sits level with the
     upstairs frames, so the two joined into one group and the whole thing
     was kept. Frames are thick and a fascia is thin, so the changes are
     first shrunk by ERODE px — which wipes out thin lines and leaves frames —
     the window groups are found in what is left, and then grown back by
     REGROW px so the whole frame is kept. Every other change is put back. */
  let cores = changed;
  for (let i = 0; i < ERODE; i++) cores = erode(cores, W, H);

  const label = new Int32Array(N);
  const stack = new Int32Array(N);
  const windows = [];
  let next = 0;
  for (let s0 = 0; s0 < N; s0++) {
    if (!cores[s0] || label[s0]) continue;
    next++;
    let sp = 0, count = 0, l = W, t = H, r = 0, b = 0;
    const members = [];
    stack[sp++] = s0; label[s0] = next;
    while (sp) {
      const k = stack[--sp];
      members.push(k); count++;
      const x = k % W, y = (k - x) / W;
      if (x < l) l = x; if (x > r) r = x; if (y < t) t = y; if (y > b) b = y;
      if (x > 0 && cores[k - 1] && !label[k - 1]) { label[k - 1] = next; stack[sp++] = k - 1; }
      if (x < W - 1 && cores[k + 1] && !label[k + 1]) { label[k + 1] = next; stack[sp++] = k + 1; }
      if (y > 0 && cores[k - W] && !label[k - W]) { label[k - W] = next; stack[sp++] = k - W; }
      if (y < H - 1 && cores[k + W] && !label[k + W]) { label[k + W] = next; stack[sp++] = k + W; }
    }
    if (count < MIN_CORE_PX) continue;
    /* Shape as well as place. The boxes are loose enough to overlap the
       roofline — on newbuild-before.jpg the upstairs window's box started at
       12% down, inside the fascia at 10–13% — so "touches a window box" kept
       the fascia strip and the gable's bargeboards as window. A window's
       change is a compact block: under STRIP_ASPECT times as wide as it is
       tall, and at least MIN_FILL of its bounding box. A fascia is a long
       strip (13:1 there); bargeboards are a sparse inverted V (6% fill). */
    const bw = r - l + 1, bh = b - t + 1;
    const compact = bw / bh <= STRIP_ASPECT && count / (bw * bh) >= MIN_FILL;
    if (compact && keepZones.some(z => l < z.r && r > z.l && t < z.b && b > z.t)) {
      windows.push({ l, t, r, b, members });
    }
  }
  return { changed, windows };
}

/* Everything the homeowner kept, on a windows-only job.

   When the walls, the roof and the roofline are all staying, nothing in the
   picture should change except the windows (and the door, when it is being
   replaced). The model disagrees: on 23 September a windows-only render turned
   white fascias and the roof's corner returns anthracite to match the frames,
   and a sentence in the prompt saying not to (renderprompt.js) held on one
   render and not the next.

   The detection boxes cannot be used to cut the roofline out — they are loose
   (the upstairs windows' real tops sat 9% above their boxes), and restoring
   the fascia strip by its box bled the old white frames onto the new window.
   So the render itself says what changed: every pixel that differs from the
   photograph by more than CHANGE_T, grouped into connected patches. A patch
   that reaches any window we are replacing is the change that was asked for
   and is kept whole — frame, reveal and all, wherever its box really sits.
   Every other patch is a change nobody asked for, and is put back from the
   photograph with a soft edge.

   Deliberately narrow, like restoreDoor: only when the surroundings are held,
   and any failure returns the render untouched. */
const CHANGE_T = 60;          // max channel difference, 0–255
const MIN_PATCH_PX = 500;     // fewer changed px outside the windows is noise
const MIN_CORE_PX = 200;      // a window group, after erosion, is at least this
const KEEP_GROW = 0.15;       // how far past a window's box its group may start
const ERODE = 2;              // px shrunk before grouping: thin lines vanish, frames survive
const REGROW = 4;             // px grown back so the whole frame is kept
const STRIP_ASPECT = 6;       // wider than this per unit height is a strip (fascia), not a window
const MIN_FILL = 0.12;        // sparser than this is an outline (bargeboards), not a window
const MAX_RESTORE_SHARE = 0.35;
const SOFT_R = 2;             // px of feathering at a restored edge

function restoreSurroundings(opts) {
  /* Destructured inside, not in the signature: a default only
     catches undefined, and these must refuse null too. Everything
     else here is written so a bad input is a refusal rather than a
     throw — this is the one path that was not. */
  const { render, renderMime, original, originalMime, detections, keepDoor = false } = opts || {};
  const untouched = (reason) => ({ buffer: render, restored: false, reason, patches: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const keepTypes = keepDoor ? new Set(['window', 'door-front']) : new Set(['window']);
    const keepBoxes = detectionList(detections)
      .filter(d => d && keepTypes.has(d.type) && Number(d.w_pct) > 0 && Number(d.h_pct) > 0);
    if (!keepBoxes.length) return untouched('no windows to keep');

    const out = PNG.sync.read(render);
    const W = out.width, H = out.height, N = W * H;
    const sx = src.width / W, sy = src.height / H;

    // The photograph, resampled to the render's grid.
    const orig = new Uint8ClampedArray(N * 3);
    const px = [0, 0, 0];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, px);
        const i = (y * W + x) * 3;
        orig[i] = px[0]; orig[i + 1] = px[1]; orig[i + 2] = px[2];
      }
    }

    const { changed, windows } = findWindowChanges({ out, orig, W, H, keepBoxes });
    /* No new window found means the premise failed — most often a colour
       chosen to match the frames already there (white on white). Restoring
       "everything else" then put back scattered bits of the frames themselves
       and left them speckled. Leave the render alone. */
    if (!windows.length) return untouched('no changed windows found');
    let windowMask = new Uint8Array(N);
    for (const g of windows) for (const k of g.members) windowMask[k] = 1;
    for (let i = 0; i < REGROW; i++) windowMask = dilate(windowMask, W, H);

    const restoreMask = new Uint8Array(N);
    let restoredPx = 0;
    for (let k = 0; k < N; k++) {
      if (changed[k] && !windowMask[k]) { restoreMask[k] = 1; restoredPx++; }
    }
    if (restoredPx < MIN_PATCH_PX) return untouched('nothing outside the windows changed');
    /* A guard, not a tuning knob: if most of the picture would be put back,
       the windows were not found where we think they are, and restoring
       would undo the change that was asked for. */
    if (restoredPx > N * MAX_RESTORE_SHARE) return untouched('too much of the picture would be restored');
    const patches = restoredPx;

    // Soft edge: the mask's local average, so a patch fades in over SOFT_R px.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        let sum = 0, n = 0;
        for (let dy = -SOFT_R; dy <= SOFT_R; dy++) {
          const yy = y + dy; if (yy < 0 || yy >= H) continue;
          for (let dx = -SOFT_R; dx <= SOFT_R; dx++) {
            const xx = x + dx; if (xx < 0 || xx >= W) continue;
            sum += restoreMask[yy * W + xx]; n++;
          }
        }
        /* Restored pixels are the photograph exactly; the softening is only
           in the ring just outside them. Averaging inside as well left a thin
           fascia at ~80% — a grey smear where a white board should be. */
        const a = restoreMask[y * W + x] ? 1 : sum / n;
        if (!a) continue;
        const i = y * W + x;
        for (let c = 0; c < 3; c++) out.data[i * 4 + c] = Math.round(out.data[i * 4 + c] * (1 - a) + orig[i * 3 + c] * a);
      }
    }
    return { buffer: PNG.sync.write(out), restored: true, reason: null, patches };
  } catch (err) {
    return untouched(`restore failed: ${err.message}`);
  }
}

/* Georgian bars, drawn rather than requested.

   The model would not draw them. Live on 24 September, at 600 px and at
   1200 px, "add Georgian glazing bars … at least two across and three down"
   came back as plain casements every time, while the frame colour always
   changed. So the render is left to do the frames, and the bars are drawn
   here: inside each window found by findWindowChanges, every pane of glass —
   an unchanged region enclosed by the new frame — gets a grid of slim bars in
   the colour the frames actually rendered at (sampled, not the swatch hex, so
   they sit in the same light). Two across by three down, or three by two on a
   wide pane, like a Georgian casement.

   Only when the walls are not changing: the windows are found by comparing
   with the photograph, which needs the walls to match it. The render route
   stops asking the model for bars in exactly that case, so there is never a
   grid drawn over a grid. */
const BAR_MIN_PANE_PX = 150;   // smaller is a vent or a reflection, not a pane
const BAR_MIN_PANE_SIDE = 12;  // px
const BAR_THICKNESS = 0.035;   // of the pane's shorter side, at least 2 px
const PANE_FRAMED_SHARE = 0.5;   // of each side of a pane that must have frame just beyond it
const INWARD_SHARE = 0.05;     // of a pane's shorter side: how far inside its edge its own frame may sit
const FRAME_COLOUR_D2 = 45 * 45;  // squared RGB distance from the frame's colour that still counts as frame
const FRAME_LINE_SHARE = 0.6;     // a column/row this much frame-coloured is a mullion/transom
const MAX_MULLION = 0.12;         // of the window's width; wider "frame" is a dark pane
const EDGE_PANE_SHARE = 0.25;     // a run touching the window's edge this wide is glass, not a sliver of brick

function drawGeorgianBars(opts) {
  /* Destructured inside, not in the signature: a default only
     catches undefined, and these must refuse null too. Everything
     else here is written so a bad input is a refusal rather than a
     throw — this is the one path that was not. */
  const { render, renderMime, original, originalMime, detections } = opts || {};
  const untouched = (reason) => ({ buffer: render, drawn: false, reason, panes: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const keepBoxes = detectionList(detections)
      .filter(d => d && d.type === 'window' && Number(d.w_pct) > 0 && Number(d.h_pct) > 0);
    if (!keepBoxes.length) return untouched('no windows detected');

    const out = PNG.sync.read(render);
    const W = out.width, H = out.height, N = W * H;
    const sx = src.width / W, sy = src.height / H;
    const orig = new Uint8ClampedArray(N * 3);
    const px = [0, 0, 0];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, px);
      const i = (y * W + x) * 3;
      orig[i] = px[0]; orig[i + 1] = px[1]; orig[i + 2] = px[2];
    }
    const { changed, windows } = findWindowChanges({ out, orig, W, H, keepBoxes });
    if (!windows.length) return untouched('no new windows found in the render');

    let panes = 0;
    for (const w of windows) {
      /* The frame's own colour, as rendered: the median of the window's changed
         pixels along its outer edge. All of its changed pixels was the first
         try, and on a window whose glass the model had also redrawn dark, the
         median slid towards the glass — which then read as frame. */
      const rs = [], gs = [], bs = [];
      const EDGE = 6;
      for (const k of w.members) {
        const kx = k % W, ky = (k - kx) / W;
        if (kx - w.l > EDGE && w.r - kx > EDGE && ky - w.t > EDGE && w.b - ky > EDGE) continue;
        rs.push(out.data[k * 4]); gs.push(out.data[k * 4 + 1]); bs.push(out.data[k * 4 + 2]);
      }
      if (!rs.length) continue;
      const med = (a) => a.sort((m, n) => m - n)[a.length >> 1];
      const colour = [med(rs), med(gs), med(bs)];

      /* Frame is frame-coloured; everything else inside the window is glass.
         "Unchanged" was the first test for glass, and it missed every pane
         whose reflections the model had also redrawn — a window came back with
         bars in one pane and not the next. */
      /* And frame is what the render changed. Colour alone cannot tell an
         anthracite mullion from the dark glass beside it — on the semi the
         bay's facets and the upstairs-right window's two panes merged into
         one — but glass the render left alone was never frame. */
      const isFrame = (q) => {
        if (!changed[q]) return false;
        const dr = out.data[q * 4] - colour[0], dg = out.data[q * 4 + 1] - colour[1], db = out.data[q * 4 + 2] - colour[2];
        return dr * dr + dg * dg + db * db < FRAME_COLOUR_D2;
      };
      /* The panes, from the frame's structure rather than a flood fill.

         Flood-filling the glass split a pane wherever a dark reflection came
         close to the frame colour, and the bars came out in fragments. Frames
         run the full height (mullions) or full width (transoms) of what they
         divide, so: the columns of the window that are mostly frame are the
         mullions, the gaps between them are pane columns, and within each the
         rows that are mostly frame are transoms. What is left are the panes. */
      const runs = (len, isBar) => {
        const out2 = []; let start = -1;
        for (let i = 0; i <= len; i++) {
          const bar = i === len || isBar(i);
          if (!bar && start < 0) start = i;
          if (bar && start >= 0) { out2.push([start, i - 1]); start = -1; }
        }
        return out2;
      };
      const colFrac = (x, y0, y1) => { let f = 0; for (let y = y0; y <= y1; y++) f += isFrame(y * W + x); return f / (y1 - y0 + 1); };
      const rowFrac = (y, x0, x1) => { let f = 0; for (let x = x0; x <= x1; x++) f += isFrame(y * W + x); return f / (x1 - x0 + 1); };
      /* A mullion is narrow. A "frame" run wider than MAX_MULLION of the window
         is a pane whose dark reflection matched the frame colour — the middle
         pane of the newbuild's upstairs-left window — and is a pane. */
      const winW = w.r - w.l + 1, winH = w.b - w.t + 1;
      // Frame lines along one axis, with any run too wide to be a frame put back as glass.
      const frameLines = (len, frac, maxRun) => {
        const raw = Array.from({ length: len }, (_, i) => frac(i) > FRAME_LINE_SHARE);
        for (let i = 0; i < len;) {
          if (!raw[i]) { i++; continue; }
          let j = i; while (j < len && raw[j]) j++;
          if (j - i > maxRun) for (let k = i; k < j; k++) raw[k] = false;
          i = j;
        }
        return raw;
      };
      const colLines = frameLines(winW, (i) => colFrac(w.l + i, w.t, w.b), winW * MAX_MULLION);
      /* A pane is enclosed by frame. A run reaching the edge of the window's
         area has no frame on that side: it is the brick between a loose box
         and the real frame (a stray bar was drawn on the semi's brickwork) —
         unless it is wide: a single-pane window's glass fills its whole area
         (the newbuild's small window lost its bars without this). */
      const enclosed = (len) => ([a0, a1]) => (a0 > 0 && a1 < len - 1) || (a1 - a0 + 1) >= len * EDGE_PANE_SHARE;
      const cols = runs(winW, (i) => colLines[i]).filter(enclosed(winW)).map(([a0, a1]) => [w.l + a0, w.l + a1]);
      for (const [x0, x1] of cols) {
        const rowLines = frameLines(winH, (i) => rowFrac(w.t + i, x0, x1), winH * MAX_MULLION);
        const rows = runs(winH, (i) => rowLines[i]).filter(enclosed(winH)).map(([a0, a1]) => [w.t + a0, w.t + a1]);
        for (const [y0, y1] of rows) {
          const pw = x1 - x0 + 1, ph = y1 - y0 + 1;
          if (pw < BAR_MIN_PANE_SIDE || ph < BAR_MIN_PANE_SIDE || pw * ph < BAR_MIN_PANE_PX) continue;
          /* A pane has frame on all four sides. Walked live on 24 September:
             on the tile-hung house's lower bay the mullions were not found, the
             whole bay area — brick and hedge below it included — passed as one
             wide "pane", and a single 3×2 grid was drawn across four casements
             and out into the garden. Glass is always framed; anything that is
             not, on any side, is not a pane. */
          const reach = Math.max(4, Math.round(Math.min(pw, ph) * 0.15));
          const INWARD = Math.max(2, Math.round(Math.min(pw, ph) * INWARD_SHARE));
          const framedAlong = (n0, n1, at) => {
            let hit = 0, total = 0;
            for (let t = n0; t <= n1; t += 2) {
              total++;
              /* Either side of the edge: a single-pane window's "pane" can take
                 in its own frame, and then the frame is just inside. */
              for (let d = -INWARD; d <= reach; d++) {
                const [qx, qy] = at(t, d);
                if (qx < 0 || qy < 0 || qx >= W || qy >= H) continue;
                if (isFrame(qy * W + qx)) { hit++; break; }
              }
            }
            return total ? hit / total : 0;
          };
          const enclosedByFrame =
            framedAlong(x0, x1, (t, d) => [t, y0 - d]) >= PANE_FRAMED_SHARE &&
            framedAlong(x0, x1, (t, d) => [t, y1 + d]) >= PANE_FRAMED_SHARE &&
            framedAlong(y0, y1, (t, d) => [x0 - d, t]) >= PANE_FRAMED_SHARE &&
            framedAlong(y0, y1, (t, d) => [x1 + d, t]) >= PANE_FRAMED_SHARE;
          if (!enclosedByFrame) continue;
          panes++;
          const nc = pw > ph * 1.2 ? 3 : 2;
          const nr = ph > pw * 1.2 ? 3 : 2;
          const thick = Math.max(2, Math.round(Math.min(pw, ph) * BAR_THICKNESS));
          const lo = -Math.floor(thick / 2), hi = Math.ceil(thick / 2);
          const put = (qx, qy) => {
            if (qx < x0 || qx > x1 || qy < y0 || qy > y1) return;
            const q = qy * W + qx;
            for (let c = 0; c < 3; c++) out.data[q * 4 + c] = colour[c];
          };
          for (let i = 1; i < nc; i++) {
            const cx = Math.round(x0 + pw * i / nc);
            for (let yy = y0; yy <= y1; yy++) for (let d = lo; d < hi; d++) put(cx + d, yy);
          }
          for (let j = 1; j < nr; j++) {
            const cy = Math.round(y0 + ph * j / nr);
            for (let xx = x0; xx <= x1; xx++) for (let d = lo; d < hi; d++) put(xx, cy + d);
          }
        }
      }
    }
    if (!panes) return untouched('no panes of glass found inside the new frames');
    return { buffer: PNG.sync.write(out), drawn: true, reason: null, panes };
  } catch (err) {
    return untouched(`bars failed: ${err.message}`);
  }
}

/* ── changedShare: did the render change what it was asked to? ──

   FLUX Kontext misses a roof now and then with the same prompt that gets it
   right on the next run (tested live, 24 September: one brick house, one
   prompt, a miss then a hit). So the route asks this after each render, and
   tries once more on a miss rather than showing a picture that silently
   leaves out something the customer chose and is being priced for.

   The share of pixels in the middle of the detected boxes that differ from
   the photograph by more than CHANGE_PIXEL_D. Measured on real renders:
   a roof that changed read 0.42–0.66, one that was missed 0.13–0.25, and
   walls nobody touched 0.04–0.16 — resampling and the model's re-encoding
   move every pixel a little. The middle 70% of each box, because detection
   boxes are loose and their edges are sky, fascia or the next surface.
   Null when it cannot judge: no boxes, or an image it cannot read. */
const CHANGE_PIXEL_D = 40;
const CHANGE_INSET = 0.15;
function changedShare({ render, renderMime, original, originalMime, boxes }) {
  try {
    if (!boxes || !boxes.length) return null;
    const out = decode(render, renderMime || '');
    const src = decode(original, originalMime || '');
    if (!out || !src) return null;
    const W = out.width, H = out.height;
    const sx = src.width / W, sy = src.height / H;
    const px = [0, 0, 0];
    let changed = 0, total = 0;
    for (const b of boxes) {
      const x0 = Math.max(0, Math.floor((b.x_pct + b.w_pct * CHANGE_INSET) / 100 * W));
      const x1 = Math.min(W - 1, Math.ceil((b.x_pct + b.w_pct * (1 - CHANGE_INSET)) / 100 * W));
      const y0 = Math.max(0, Math.floor((b.y_pct + b.h_pct * CHANGE_INSET) / 100 * H));
      const y1 = Math.min(H - 1, Math.ceil((b.y_pct + b.h_pct * (1 - CHANGE_INSET)) / 100 * H));
      for (let y = y0; y <= y1; y += 2) for (let x = x0; x <= x1; x += 2) {
        sample(src, (x + 0.5) * sx - 0.5, (y + 0.5) * sy - 0.5, px);
        const i = (y * W + x) * 4;
        const d = Math.max(Math.abs(out.data[i] - px[0]), Math.abs(out.data[i + 1] - px[1]), Math.abs(out.data[i + 2] - px[2]));
        total++;
        if (d > CHANGE_PIXEL_D) changed++;
      }
    }
    return total ? changed / total : null;
  } catch (_) {
    return null;
  }
}

/* Hold everything the mask does not call a window.
 *
 * The blunt version of restoreSurroundings, and blunt is the point. That one
 * reasons about patches because it only has boxes to work with; this one is
 * handed the answer at the pixel and can simply take it. Inside the mask the
 * render; outside it the photograph, resampled to the render's grid the same
 * way every other hold in this file does it.
 *
 * Only safe when the windows are the ONLY thing being changed — a mask of the
 * windows would otherwise throw away a new roof or new walls along with the
 * bins. server.js gates it on the same flag restoreSurroundings uses, which is
 * already exactly that condition.
 *
 * The mask arrives as a JPEG whatever its file extension says, so its edges
 * are soft and it is thresholded rather than read as bits. MASK_ON sits high:
 * a JPEG ringing artefact beside a hard edge overshoots in both directions,
 * and letting a few stray light pixels through outside a window puts specks of
 * render back on the brickwork.
 */
const MASK_ON = 160;
/* How far outside a neighbour's window box to keep holding, as a percentage of
   the frame. The boxes are loose and a frame repainted halfway along its
   length reads worse than one left alone. */
const NOT_OURS_MARGIN_PCT = 1.5;

/* Below this share of a window's middle covered by the mask, the mask has
   missed that window (see restoreOutsideMask). A window the mask found reads
   far above it: glass and frame are both "window" to segmentation. */
const MASK_MIN_COVER = 0.08;

/* How far outside one of our window boxes the mask is still believed, as a
   percentage of the frame. IMG_2068, 2 October: the stone head above the
   upstairs left window came back green, then dark grey. Segmentation called
   the stone "window" and the mask kept the paint on it; the detection box for
   that window starts at the bottom of the stone. Small, because the box is
   already loose around the frame and the stonework begins right beside it. */
const MASK_BOX_MARGIN_PCT = 0.5;

function restoreOutsideMask(opts) {
  /* Destructured inside, not in the signature: a default only
     catches undefined, and these must refuse null too. Everything
     else here is written so a bad input is a refusal rather than a
     throw — this is the one path that was not. */
  const { render, renderMime, original, originalMime, mask, maskMime, notOurs = [], ours = [] } = opts || {};
  const untouched = (reason) => ({ buffer: render, restored: false, reason, insideShare: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    if (!mask || !mask.length) return untouched('no mask');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const m = decode(mask, maskMime || '');
    if (!m) return untouched('mask type not handled');

    const out = PNG.sync.read(render);
    const W = out.width, H = out.height;

    /* A mask that does not describe this frame is worse than none: it would
       hold the wrong half of the house. Compared as a shape, because the mask
       is produced from the photograph and the two can legitimately differ by a
       pixel or two of rounding. */
    const ar = (w, h) => w / h;
    if (Math.abs(ar(m.width, m.height) - ar(W, H)) > 0.02) {
      return untouched(`mask is ${m.width}x${m.height}, render is ${W}x${H}`);
    }

    /* Windows that are not this customer's are cut out of the mask before it
       is used.

       Segmentation is asked for "window" and answers honestly: every window in
       the frame, next door's included. So a windows-only render recoloured the
       neighbour's frames and the mask then protected that result — measured on
       number 14, where the sash above number 12's door came back anthracite
       under a mask that was otherwise doing its job.

       The boxes come from the same rule that decides the count, so a window we
       refuse to charge for is a window we refuse to repaint. Generous by a
       margin, because the boxes are loose and half a repainted frame on the
       boundary looks worse than a whole one held. */
    const cuts = (Array.isArray(notOurs) ? notOurs : [])
      /* Every field checked. This runs inside a render that has already been
         paid for, and a null or half-built box in this list must cost nothing
         worse than no cut — a test passing [null] took the whole hold down
         with "Cannot read properties of null". */
      .filter(b2 => b2 && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(b2[k]))) && b2.w > 0 && b2.h > 0)
      .map(b2 => ({
        x0: Math.floor((Number(b2.x) - NOT_OURS_MARGIN_PCT) * W / 100),
        x1: Math.ceil((Number(b2.x) + Number(b2.w) + NOT_OURS_MARGIN_PCT) * W / 100),
        y0: Math.floor((Number(b2.y) - NOT_OURS_MARGIN_PCT) * H / 100),
        y1: Math.ceil((Number(b2.y) + Number(b2.h) + NOT_OURS_MARGIN_PCT) * H / 100),
      }));
    const notOurWindow = (x, y) => cuts.some(c => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);

    /* A window of ours the mask missed is held by its box instead.

       IMG_2068, 1 October: a bay-fronted terrace, anthracite casements. The
       two upstairs windows changed; the bay came back exactly the photograph,
       pixel for pixel, the same as the brick beside it. Either the
       segmentation found "window" upstairs and not the bay (a painted bay
       full of net curtains, with pillars, may not read as one to it), or the
       model left the bay alone; this answers the first, judgeRender the
       second.

       Each of our windows is checked against the mask in the middle of its
       box. Under MASK_MIN_COVER means the mask does not know that window, and
       the box stands in for it: the render is kept there, as the patch hold
       would keep it. That keeps the bay's pillars along with its frames if
       the model repaints them, which is the smaller wrong and the one the
       prompt already argues against. Everywhere the mask did find, it still
       decides. */
    const mOn = (x, y) => {
      const mx = Math.min(m.width - 1, Math.max(0, Math.round((x + 0.5) * m.width / W - 0.5)));
      const my = Math.min(m.height - 1, Math.max(0, Math.round((y + 0.5) * m.height / H - 0.5)));
      return m.data[(my * m.width + mx) * 4] >= MASK_ON;
    };
    const fills = [];
    for (const b of (Array.isArray(ours) ? ours : [])) {
      if (!b || !['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(b[k]))) || !(b.w > 0) || !(b.h > 0)) continue;
      const bx0 = Math.max(0, Math.floor(Number(b.x) * W / 100)), bx1 = Math.min(W - 1, Math.ceil((Number(b.x) + Number(b.w)) * W / 100));
      const by0 = Math.max(0, Math.floor(Number(b.y) * H / 100)), by1 = Math.min(H - 1, Math.ceil((Number(b.y) + Number(b.h)) * H / 100));
      const ix = Math.round((bx1 - bx0) * 0.15), iy = Math.round((by1 - by0) * 0.15);
      let on = 0, all = 0;
      for (let y = by0 + iy; y <= by1 - iy; y += 2) for (let x = bx0 + ix; x <= bx1 - ix; x += 2) { all++; if (mOn(x, y)) on++; }
      if (all && on / all < MASK_MIN_COVER) fills.push({ x0: bx0, x1: bx1, y0: by0, y1: by1 });
    }
    const filledWindow = (x, y) => fills.some(c => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);

    /* The mask is only believed inside our windows. Without boxes (no
       detection) it is believed everywhere, as before. */
    const keep = (Array.isArray(ours) ? ours : [])
      .filter(b => b && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(b[k]))) && b.w > 0 && b.h > 0)
      .map(b => ({
        x0: Math.floor((Number(b.x) - MASK_BOX_MARGIN_PCT) * W / 100),
        x1: Math.ceil((Number(b.x) + Number(b.w) + MASK_BOX_MARGIN_PCT) * W / 100),
        y0: Math.floor((Number(b.y) - MASK_BOX_MARGIN_PCT) * H / 100),
        y1: Math.ceil((Number(b.y) + Number(b.h) + MASK_BOX_MARGIN_PCT) * H / 100),
      }));
    const inOurBox = (x, y) => !keep.length || keep.some(c => x >= c.x0 && x <= c.x1 && y >= c.y0 && y <= c.y1);

    /* Nearest neighbour for the mask — it is a binary decision and bilinear
       would only invent grey along every edge to threshold again. The
       photograph keeps the bilinear sample it has always had. */
    const px = [0, 0, 0];
    let inside = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const mx = Math.min(m.width - 1, Math.max(0, Math.round((x + 0.5) * m.width / W - 0.5)));
        const my = Math.min(m.height - 1, Math.max(0, Math.round((y + 0.5) * m.height / H - 0.5)));
        if (((m.data[(my * m.width + mx) * 4] >= MASK_ON && inOurBox(x, y)) || filledWindow(x, y)) && !notOurWindow(x, y)) { inside++; continue; }   // our window: keep the render
        sample(src, (x + 0.5) * (src.width / W) - 0.5, (y + 0.5) * (src.height / H) - 0.5, px);
        const i = (y * W + x) * 4;
        out.data[i] = px[0]; out.data[i + 1] = px[1]; out.data[i + 2] = px[2];
      }
    }

    /* An empty mask would hand back the photograph unchanged and call it a
       render. A mask covering everything would hold nothing and is equally a
       failure of the segmentation rather than a description of a house. Both
       fall back to the patch-based hold, which at least reasons. */
    const share = inside / (W * H);
    if (share < 0.01) return untouched(`mask covers only ${(share * 100).toFixed(1)}% of the frame`);
    if (share > 0.8) return untouched(`mask covers ${(share * 100).toFixed(0)}% of the frame`);

    return { buffer: PNG.sync.write(out), restored: true, reason: null, insideShare: share, windowsFilled: fills.length };
  } catch (err) {
    return untouched(err?.message || 'mask hold failed');
  }
}

/* Put back what a driveway job must not touch (0054): the garden wall,
   fence, railings, bins and car, segmented from the photograph. Inside the
   mask the photograph, everywhere else the render. Only below the top of the
   front door (a boundary wall is lower than that; the house above is not this
   step's business), and never inside one of our windows. Refuses a mask that
   has swallowed most of the ground — that is the driveway itself, and holding
   it would undo the job. */
const KEEP_MIN_SHARE = 0.001;
const KEEP_MAX_OF_GROUND = 0.5;
function restoreInsideMask(opts) {
  const { render, renderMime, original, originalMime, mask, maskMime, ours = [], fromYPct = 40 } = opts || {};
  const untouched = (reason) => ({ buffer: render, restored: false, reason, share: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    if (!mask || !mask.length) return untouched('no keep mask');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const m = decode(mask, maskMime || '');
    if (!m) return untouched('mask type not handled');
    const out = PNG.sync.read(render);
    const W = out.width, H = out.height;
    if (Math.abs(m.width / m.height - W / H) > 0.02) return untouched(`mask is ${m.width}x${m.height}, render is ${W}x${H}`);
    const y0 = Math.max(0, Math.min(H - 1, Math.floor(Number(fromYPct) * H / 100)));
    const boxes = (Array.isArray(ours) ? ours : [])
      .filter(b => b && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(b[k]))))
      .map(b => ({ x0: Number(b.x) * W / 100, x1: (Number(b.x) + Number(b.w)) * W / 100, y0: Number(b.y) * H / 100, y1: (Number(b.y) + Number(b.h)) * H / 100 }));
    const inOurs = (x, y) => boxes.some(b => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
    const on = [];
    for (let y = y0; y < H; y++) for (let x = 0; x < W; x++) {
      const mx = Math.min(m.width - 1, Math.max(0, Math.round((x + 0.5) * m.width / W - 0.5)));
      const my = Math.min(m.height - 1, Math.max(0, Math.round((y + 0.5) * m.height / H - 0.5)));
      if (m.data[(my * m.width + mx) * 4] >= MASK_ON && !inOurs(x, y)) on.push(y * W + x);
    }
    const share = on.length / (W * H);
    const ofGround = on.length / Math.max(1, W * (H - y0));
    if (share < KEEP_MIN_SHARE) return untouched(`keep mask covers only ${(share * 100).toFixed(2)}% of the frame`);
    if (ofGround > KEEP_MAX_OF_GROUND) return untouched(`keep mask covers ${(ofGround * 100).toFixed(0)}% of the ground — that is the driveway, not what stands on it`);
    const px = [0, 0, 0];
    for (const k of on) {
      const x = k % W, y = (k - x) / W;
      sample(src, (x + 0.5) * (src.width / W) - 0.5, (y + 0.5) * (src.height / H) - 0.5, px);
      out.data[k * 4] = px[0]; out.data[k * 4 + 1] = px[1]; out.data[k * 4 + 2] = px[2];
    }
    return { buffer: PNG.sync.write(out), restored: true, reason: null, share, ofGround };
  } catch (err) {
    return untouched(err?.message || 'keep hold failed');
  }
}

/* Put the pillars back (2 October). See fetchPillarMask in windowmask.js.

   Inside the pillar mask the photograph; everywhere else the render as it
   stands. Refuses a mask that cannot be a set of pillars: too small to be
   anything, or so large it has taken the whole bay (and the frames with it)
   — then the render is left exactly as it was. Bounded by the bay's box when
   one is given, so a pillar next door or a porch column elsewhere on the
   street is not this job's business either way. */
const PILLAR_MIN_SHARE = 0.002;
const PILLAR_MAX_OF_BAY = 0.45;
/* A column of the bay is a shaft when the mask covers this much of its height.
   The whole column is then held, top to bottom of the bay: the carved capital
   and the base sit on the shaft, and segmentation asked for "pillar" finds
   the plain shaft and not the carving (IMG_2068, green, 2 October). */
/* 0.3 → 0.15 (2 October, 0050): on IMG_2068 the shaft the object pick kept
   held at ofBay 0.039 and its capital stayed green — a shaft that starts
   below its capital and stops above its base is well under 30% of a bay box
   that includes the roof edge and sill. */
const PILLAR_SHAFT_MIN = 0.15;
function restorePillars(opts) {
  const { render, renderMime, original, originalMime, mask, maskMime, bay = null, maskBox = null } = opts || {};
  const untouched = (reason) => ({ buffer: render, restored: false, reason, share: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    if (!mask || !mask.length) return untouched('no pillar mask');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const m = decode(mask, maskMime || '');
    if (!m) return untouched('mask type not handled');
    const out = PNG.sync.read(render);
    const W = out.width, H = out.height;
    /* The mask covers maskBox (percent of the frame) when it was made from a
       crop of the bay, the whole frame otherwise. */
    const mb = maskBox && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(maskBox[k]))) && maskBox.w > 0 && maskBox.h > 0
      ? { x: Number(maskBox.x), y: Number(maskBox.y), w: Number(maskBox.w), h: Number(maskBox.h) } : { x: 0, y: 0, w: 100, h: 100 };
    const mbW = mb.w * W / 100, mbH = mb.h * H / 100, mbX = mb.x * W / 100, mbY = mb.y * H / 100;
    if (Math.abs(m.width / m.height - mbW / mbH) > 0.03) return untouched(`mask is ${m.width}x${m.height}, its box is ${Math.round(mbW)}x${Math.round(mbH)}`);
    let bx0 = 0, bx1 = W - 1, by0 = 0, by1 = H - 1;
    if (bay && ['x', 'y', 'w', 'h'].every(k => Number.isFinite(Number(bay[k])))) {
      bx0 = Math.max(0, Math.floor((Number(bay.x) - 2) * W / 100)); bx1 = Math.min(W - 1, Math.ceil((Number(bay.x) + Number(bay.w) + 2) * W / 100));
      by0 = Math.max(0, Math.floor((Number(bay.y) - 2) * H / 100)); by1 = Math.min(H - 1, Math.ceil((Number(bay.y) + Number(bay.h) + 2) * H / 100));
    }
    const on = [];
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) {
      const fx = (x + 0.5 - mbX) * m.width / mbW - 0.5, fy = (y + 0.5 - mbY) * m.height / mbH - 0.5;
      if (fx < -0.5 || fy < -0.5 || fx > m.width - 0.5 || fy > m.height - 0.5) continue;   // outside the crop
      const mx = Math.min(m.width - 1, Math.max(0, Math.round(fx)));
      const my = Math.min(m.height - 1, Math.max(0, Math.round(fy)));
      if (m.data[(my * m.width + mx) * 4] >= MASK_ON) on.push(y * W + x);
    }
    const share = on.length / (W * H);
    const bayArea = (bx1 - bx0 + 1) * (by1 - by0 + 1);
    if (share < PILLAR_MIN_SHARE) return untouched(`pillar mask covers only ${(share * 100).toFixed(2)}% of the frame`);
    if (bay && on.length / bayArea > PILLAR_MAX_OF_BAY) return untouched(`pillar mask covers ${(on.length / bayArea * 100).toFixed(0)}% of the bay — that is the window, not its pillars`);
    if (bay) {
      const height = by1 - by0 + 1, perX = new Map();
      for (const k of on) { const x = k % W; perX.set(x, (perX.get(x) || 0) + 1); }
      const have = new Set(on);
      for (const [x, n] of perX) {
        if (n / height < PILLAR_SHAFT_MIN) continue;
        for (let y = by0; y <= by1; y++) { const k = y * W + x; if (!have.has(k)) { have.add(k); on.push(k); } }
      }
    }
    /* Measured on what will actually be held (4 October, dev): the guard above
       read the mask before the shafts were run the full height of the bay, so
       a mask of many short columns could pass at 20% and then hold half the
       bay — frames and all — to the photograph. Checked again after. */
    const ofBay = on.length / bayArea;
    if (bay && ofBay > PILLAR_MAX_OF_BAY) return untouched(`pillars held full height would cover ${(ofBay * 100).toFixed(0)}% of the bay — that is the window, not its pillars`);
    const px = [0, 0, 0];
    for (const k of on) {
      const x = k % W, y = (k - x) / W;
      sample(src, (x + 0.5) * (src.width / W) - 0.5, (y + 0.5) * (src.height / H) - 0.5, px);
      out.data[k * 4] = px[0]; out.data[k * 4 + 1] = px[1]; out.data[k * 4 + 2] = px[2];
    }
    return { buffer: PNG.sync.write(out), restored: true, reason: null, share, ofBay };
  } catch (err) {
    return untouched(err?.message || 'pillar hold failed');
  }
}

/* ── The colour the homeowner actually chose ──
 *
 * The last of the three ways this render goes wrong, and the only one that can
 * be settled arithmetically rather than asked for.
 *
 * Number 14, Chartwell Green, live on 28 September: the frames came back
 * BRIGHT LIME. renderprompt describes chartwell-green as "muted grey-green
 * sage, soft and dusty, never bright or lime green" — the words are already
 * there, and were already written once before in response to the same defect
 * on a door. Saying it a third time is not a plan. The customer picks a colour
 * from a swatch and is shown a different colour beside a price for the one
 * they picked.
 *
 * So take the lightness the model produced and replace the colour with the
 * one they chose. In Lab: keep L (the shading, the reflections, the sense of a
 * real surface in real light) and take a and b from the swatch hex. Lime
 * cannot survive it, because lime is not in the swatch.
 *
 * ── Telling frame from glass ──
 *
 * Correcting every changed pixel would tint the glass too, and a window whose
 * sky reflection has gone sage looks worse than one whose frame is slightly
 * off. The separation uses the defect itself: the model paints ALL the frames
 * one consistent wrong colour, so the frame is the dominant colour among the
 * changed pixels. A coarse histogram finds it; glass reflections vary too much
 * to out-vote it. Same idea drawGeorgianBars uses to find its mullions, which
 * is the one frame/glass test in this file that has survived real photographs.
 *
 * Deliberately does nothing when there is nothing to fix: if what the model
 * produced is already close to the swatch, the render is left exactly alone.
 */
const CORRECT_MIN_SHARE = 0.002;   // fewer changed pixels than this and there is no frame to find
const CORRECT_MAX_SHARE = 0.60;    // more of the mask than this is not a frame, it is the whole picture
/* How far a pixel's COLOUR may sit from the frame's, ignoring how light it is.
 *
 * Measured in Lab's a/b plane, and the first version of this got it wrong in a
 * way worth recording: it matched on full RGB distance to one dominant colour,
 * so the lit parts of a frame matched and the shaded parts did not. Number 14
 * came back mottled — patches of corrected sage between patches of untouched
 * lime, visibly worse than the flat lime it replaced.
 *
 * A frame is one colour under a range of light. The error is in the hue and
 * the error is uniform; the lightness variation is real and is the thing worth
 * keeping. So the test has to be blind to L, which is also what makes it safe
 * for glass: curtains and dark interiors sit near the neutral axis, far from a
 * saturated frame in a/b however bright they are.
 *
 * Swept 18 / 24 / 30 / 36 on number 14 and the result did not move at all: the
 * painted pixels form one tight cluster in a/b and everything else is far
 * outside any of them. 24 is the middle of a plateau rather than a tuned
 * number, which is the most honest thing to say about it. */
const CORRECT_AB_TOLERANCE = 24;
const CORRECT_SKIP_DE = 12;        // already this close to the swatch: leave it alone

const srgbToLinear = (v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
const linearToSrgb = (c) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};
/* D65, the white point sRGB is defined against. */
const WHITE = [0.95047, 1, 1.08883];
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : (7.787 * t) + (16 / 116));
const fInv = (t) => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };

function rgbToLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / WHITE[0];
  const y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / WHITE[1];
  const z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / WHITE[2];
  const fx = f(x), fy = f(y), fz = f(z);
  return [(116 * fy) - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function labToRgb(L, a, bb) {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - bb / 200;
  const x = fInv(fx) * WHITE[0], y = fInv(fy) * WHITE[1], z = fInv(fz) * WHITE[2];
  const R = x * 3.2406 + y * -1.5372 + z * -0.4986;
  const G = x * -0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 + y * -0.2040 + z * 1.0570;
  return [linearToSrgb(R), linearToSrgb(G), linearToSrgb(B)];
}

const hexToRgb = (hex) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

function correctFrameColour(opts) {
  /* Destructured inside, not in the signature: a default only
     catches undefined, and these must refuse null too. Everything
     else here is written so a bad input is a refusal rather than a
     throw — this is the one path that was not. */
  const { render, renderMime, original, originalMime, mask, maskMime, hex } = opts || {};
  const untouched = (reason) => ({ buffer: render, corrected: false, reason, share: 0, from: null });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    const target = hexToRgb(hex);
    if (!target) return untouched('no swatch colour for this choice');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const m = mask ? decode(mask, maskMime || '') : null;
    if (!m) return untouched('no mask — a correction without one would tint the whole house');

    const out = PNG.sync.read(render);
    const W = out.width, H = out.height, N = W * H;
    if (Math.abs((m.width / m.height) - (W / H)) > 0.02) return untouched('mask does not describe this frame');

    /* Changed, and inside the mask: the pixels the model painted on a window. */
    const px = [0, 0, 0];
    const eligible = new Uint8Array(N);
    let n = 0;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const k = y * W + x;
        const mx = Math.min(m.width - 1, Math.max(0, Math.round((x + 0.5) * m.width / W - 0.5)));
        const my = Math.min(m.height - 1, Math.max(0, Math.round((y + 0.5) * m.height / H - 0.5)));
        if (m.data[(my * m.width + mx) * 4] < MASK_ON) continue;
        sample(src, (x + 0.5) * (src.width / W) - 0.5, (y + 0.5) * (src.height / H) - 0.5, px);
        let d = 0;
        for (let c = 0; c < 3; c++) d = Math.max(d, Math.abs(out.data[k * 4 + c] - px[c]));
        if (d > CHANGE_T) { eligible[k] = 1; n++; }
      }
    }
    if (n / N < CORRECT_MIN_SHARE) return untouched(`only ${n} changed pixels inside the mask`);

    /* The colour the model actually used, by vote. A coarse histogram rather
       than a median: frame and glass are two populations, and a per-channel
       median of both returns a blend belonging to neither. */
    const BINS = 16, SH = 4;
    const hist = new Uint32Array(BINS * BINS * BINS);
    for (let k = 0; k < N; k++) {
      if (!eligible[k]) continue;
      const r = out.data[k * 4] >> SH, g = out.data[k * 4 + 1] >> SH, b = out.data[k * 4 + 2] >> SH;
      hist[(r * BINS + g) * BINS + b]++;
    }
    let best = 0, bestBin = 0;
    for (let i = 0; i < hist.length; i++) if (hist[i] > best) { best = hist[i]; bestBin = i; }
    const br = (bestBin / (BINS * BINS)) | 0, bg = ((bestBin / BINS) | 0) % BINS, bb = bestBin % BINS;
    /* The bin's own mean, so the reference is a real colour rather than a
       quantised one. */
    let sr = 0, sg = 0, sb = 0, cnt = 0;
    for (let k = 0; k < N; k++) {
      if (!eligible[k]) continue;
      if ((out.data[k * 4] >> SH) !== br || (out.data[k * 4 + 1] >> SH) !== bg || (out.data[k * 4 + 2] >> SH) !== bb) continue;
      sr += out.data[k * 4]; sg += out.data[k * 4 + 1]; sb += out.data[k * 4 + 2]; cnt++;
    }
    if (!cnt) return untouched('no dominant colour among the changed pixels');
    const dominant = [Math.round(sr / cnt), Math.round(sg / cnt), Math.round(sb / cnt)];

    /* Already right? Then this render does not need saving from itself. */
    const dl = rgbToLab(...dominant), tl = rgbToLab(...target);
    const dE = Math.sqrt((dl[0] - tl[0]) ** 2 + (dl[1] - tl[1]) ** 2 + (dl[2] - tl[2]) ** 2);
    if (dE < CORRECT_SKIP_DE) return untouched(`already within ΔE ${dE.toFixed(1)} of the swatch`);

    /* Which pixels are frame, and how light the model made them on average.
 *
 * Keeping L exactly as rendered — which is how the fix was specified — turns
 * bright lime into bright SAGE, and "too bright" was half of what was wrong
 * with it. Chartwell Green is a dark, dusty colour; lime is a light one, and
 * the difference is mostly lightness, not hue.
 *
 * So the frame's average lightness is moved onto the swatch's, and every
 * pixel keeps its distance from that average. The shading, the reflections and
 * the sense of a real surface in real light all survive — they are differences
 * in L, not absolutes — while the colour as a whole lands where it was
 * chosen. Flattening L to a single value instead would give perfectly accurate
 * paint on a cardboard cut-out. */
    const frame = [];
    let sumL = 0;
    const tol2 = CORRECT_AB_TOLERANCE * CORRECT_AB_TOLERANCE;
    for (let k = 0; k < N; k++) {
      if (!eligible[k]) continue;
      const [L, a2, b2] = rgbToLab(out.data[k * 4], out.data[k * 4 + 1], out.data[k * 4 + 2]);
      const da = a2 - dl[1], db2 = b2 - dl[2];
      if (da * da + db2 * db2 > tol2) continue;   // a different colour: glass, or something the model left alone
      frame.push(k, L);
      sumL += L;
    }
    let changedPx = frame.length / 2;
    if (!changedPx) return untouched('nothing matched the dominant colour');
    const meanL = sumL / changedPx;
    const shift = tl[0] - meanL;
    for (let i = 0; i < frame.length; i += 2) {
      const k = frame[i];
      const L = Math.max(0, Math.min(100, frame[i + 1] + shift));
      const [nr, ng, nb] = labToRgb(L, tl[1], tl[2]);
      out.data[k * 4] = nr; out.data[k * 4 + 1] = ng; out.data[k * 4 + 2] = nb;
    }
    const share = changedPx / N;
    if (share > CORRECT_MAX_SHARE) return untouched(`would repaint ${(share * 100).toFixed(0)}% of the picture`);

    return { buffer: PNG.sync.write(out), corrected: true, reason: null, share,
             from: `rgb(${dominant.join(',')})`, deltaE: Number(dE.toFixed(1)) };
  } catch (err) {
    return untouched(err?.message || 'colour correction failed');
  }
}

module.exports = { restoreInsideMask, KEEP_MAX_OF_GROUND, MASK_BOX_MARGIN_PCT, cropToBox, pillarsFromObjects, PILLAR_PICK, PILLAR_ATTACH, PILLAR_SHAFT_MIN,
  restorePillars, PILLAR_MAX_OF_BAY, restoreDoor, restoreSurroundings, restoreOutsideMask, correctFrameColour,
                   drawGeorgianBars, doorBox, changedShare, MASK_ON, rgbToLab, labToRgb, hexToRgb };
