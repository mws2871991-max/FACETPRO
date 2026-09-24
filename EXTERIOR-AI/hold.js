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
  return (detections || [])
    .filter(d => d && d.type === 'window' && Number(d.w_pct) > 0 && Number(d.h_pct) > 0)
    .map(d => ({ x: Number(d.x_pct), y: Number(d.y_pct), w: Number(d.w_pct), h: Number(d.h_pct) }));
}

function doorBox(detections) {
  const doors = (detections || [])
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
function restoreDoor({ render, renderMime, original, originalMime, detections }) {
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

function restoreSurroundings({ render, renderMime, original, originalMime, detections, keepDoor = false }) {
  const untouched = (reason) => ({ buffer: render, restored: false, reason, patches: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const keepTypes = keepDoor ? new Set(['window', 'door-front']) : new Set(['window']);
    const keepBoxes = (detections || [])
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
const FRAME_COLOUR_D2 = 45 * 45;  // squared RGB distance from the frame's colour that still counts as frame
const FRAME_LINE_SHARE = 0.6;     // a column/row this much frame-coloured is a mullion/transom
const MAX_MULLION = 0.12;         // of the window's width; wider "frame" is a dark pane
const EDGE_PANE_SHARE = 0.25;     // a run touching the window's edge this wide is glass, not a sliver of brick

function drawGeorgianBars({ render, renderMime, original, originalMime, detections }) {
  const untouched = (reason) => ({ buffer: render, drawn: false, reason, panes: 0 });
  try {
    if (!/png/i.test(renderMime || '')) return untouched('render is not a PNG');
    const src = decode(original, originalMime || '');
    if (!src) return untouched('photograph type not handled');
    const keepBoxes = (detections || [])
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

module.exports = { restoreDoor, restoreSurroundings, drawGeorgianBars, doorBox };
