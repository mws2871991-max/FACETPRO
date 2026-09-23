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

module.exports = { restoreDoor, doorBox };
