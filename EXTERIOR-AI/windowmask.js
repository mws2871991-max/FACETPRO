/* Where the windows actually are, as pixels rather than as boxes.
 *
 * Detection gives boxes, and a box is a rectangle around a thing that is not
 * rectangular. For most of this application that is fine — counting windows,
 * sizing them, deciding whether a photograph can be measured. For holding the
 * render it is not, and number 14 is why.
 *
 * Number 14 is an Edwardian mid-terrace with two painted bays. Asked for
 * Chartwell Green sliding sashes on 28 September it came back with both bays
 * bright lime — pilasters, capitals, cornice, the corbels under the sill, the
 * sill, the brick spandrel between the two bays — and the sash frames inside
 * them still white. Exactly inverted.
 *
 * hold.js cannot undo that. restoreSurroundings keeps a changed patch whole
 * when the patch touches a window box, deliberately, because boxes are loose
 * and a frame cut in half looks worse than a frame left alone. Detection
 * returns a bay as ONE box 36% of the frame wide by 35% tall, so the pillars,
 * the cornice, the sill and — measured on the real render — the wheelie bins
 * parked under the bay all sit inside something labelled "window" and are
 * kept. Run on that exact pair it reports 3,572 patches restored and changes
 * almost nothing.
 *
 * So: ask what is window at the pixel, from the photograph, before the render
 * exists. Grounding DINO locates "window" by language, SAM turns each hit into
 * a mask. Everything outside the mask is then the photograph by construction,
 * and no amount of the model's enthusiasm can repaint a bin.
 *
 * ── What this does not fix ──
 *
 * The mask covers the bay's FACE, pillars included, because to SAM the bay is
 * one window-shaped object. Measured on number 14 it restores the cornice, the
 * corbels, the sill, the spandrel brickwork, the bins, the door and the
 * neighbours, and leaves the pilasters between the sashes inside the mask
 * where the model can still reach them. That half is the prompt's job
 * (renderprompt.js names the parts of a bay) and it is a smaller wrong than
 * the one this removes.
 *
 * ── No negative prompt ──
 *
 * The model takes one and it is a trap. Tested twice on number 14:
 *
 *   "brick wall, stone pillar, …"        final mask 0.2% of frame — unusable
 *   "stone column, pilaster, capital"    final mask 0.2% of frame — unusable
 *   none                                 final mask 25.4% — every window, no
 *                                        cornice, no sill, no bins
 *
 * The subtraction is not a nudge; a negative region swallows the positive it
 * overlaps, and on a house every window sits on a wall. Positive only.
 */

'use strict';

/* Grounding DINO + Segment Anything, pinned. A version id rather than a
   floating tag because the output shape below is read positionally, and a
   model that silently starts returning three images instead of four would
   composite the wrong one over somebody's house. */
const MODEL_VERSION = 'ee871c19efb1941f55f66a3d7d960428c8a5afcb77449547fe8e5a3ab9ebc21c';

/* The fourth output is the binary mask; the first two are annotated previews
   for a human and the last is its inverse. Read by index because the model
   returns a bare array of URLs with no names. */
const MASK_INDEX = 2;

/* Grow the mask outward a few pixels.
 *
 * A frame is thin and a mask edge lands on it rather than outside it, so an
 * undilated mask holds the outer half of every frame back to the photograph
 * and the render's new colour stops short of its own edge. Positive is
 * dilation in this model's schema; negative erodes. */
const DILATE = 3;

/* Cold starts are the risk, not the run. Measured on number 14: 82.8s on a
   cold container, 2.0s and 5.7s warm. The render this hangs off already has a
   deadline, so this takes a slice of what is left and gives up rather than
   spending it — a render with an unheld bay is worth more than no render. */
const MIN_BUDGET_MS = 12000;
/* Above the cold start, not below it.
 *
 * This was 75s, and the two cold starts measured are 82.8s and 88.9s — so the
 * ceiling sat underneath the thing it was meant to survive. Caught live on 29
 * September: "window mask not prepared — segmentation still running at the
 * deadline", and the render that followed had no mask, so it kept neither the
 * bay nor the bins nor the colour. The one moment the warm-up exists for is a
 * cold container, and it was the one moment it could not last.
 *
 * Costs nothing to raise. Nobody waits on this: the warm-up is fired and
 * forgotten at upload, and what the finished render will wait for is GRACE_MS
 * below, which is six seconds either way. The render path's own call is
 * bounded by the render deadline it is passed, not by this. */
const MAX_WAIT_MS = 110000;

/* How long the finished render will wait for a mask that has not arrived.
 *
 * The two run side by side, so most of the segmentation is free: it overlaps
 * whatever FLUX is doing. What is not free is the tail — if the render comes
 * back at 30s and segmentation is still cold-starting at 80s, waiting for it
 * would add fifty seconds to somebody staring at a spinner for a picture that
 * already exists.
 *
 * So the render waits this long and no longer, then goes without. Six seconds
 * buys the warm case comfortably (2.0s and 5.7s measured) and the common slow
 * case, and refuses to buy the cold one. A render held by boxes beats a better
 * render nobody waited for. */
const GRACE_MS = 6000;

const isFn = (f) => typeof f === 'function';

/* What to ask for. The door joins the windows only when the door is being
   replaced: otherwise it must fall outside the mask so the photograph's own
   door survives, which is the job restoreDoor was written to do by hand. */
function maskPrompt({ changingDoor = false } = {}) {
  return changingDoor ? 'window, front door' : 'window';
}

/* Returns { buffer, mime } for the mask image, or null.
 *
 * Null is a supported answer everywhere it is called: the caller falls back to
 * restoreSurroundings, which is what shipped before this file existed. Every
 * failure here — no token, no budget, a refusal, a timeout, an output that is
 * not shaped the way this expects — returns null and records why. None of them
 * throws into a render that has already been paid for.
 */
async function fetchWindowMask({
  image, mime, replicateKey, deadlineAt, changingDoor = false, fetchImpl = fetch, onNote,
  /* Another thing to segment instead of windows — the bay's pillars
     (fetchPillarMask) — and how far to grow or shrink it. */
  prompt = null, dilate = DILATE,
} = {}) {
  const note = isFn(onNote) ? onNote : () => {};
  if (!replicateKey) { note('no Replicate token'); return null; }
  if (!image || !image.length) { note('no photograph to segment'); return null; }

  const budget = Number.isFinite(deadlineAt) ? deadlineAt - Date.now() : MAX_WAIT_MS;
  if (budget < MIN_BUDGET_MS) { note(`only ${Math.max(0, Math.round(budget))}ms left`); return null; }
  const waitMs = Math.min(MAX_WAIT_MS, budget - 2000);
  /* From here, not from wherever the POST happens to return.

     Prefer: wait holds the request for up to sixty seconds, and the polling
     deadline below used to be set after that — so a cold start could spend
     sixty seconds in the POST and then a further waitMs polling, 135s against
     a budget of 75. Measured at 88.9s on a run that should have given up. */
  const giveUpAt = Date.now() + waitMs;

  /* Replicate's Prefer: wait is capped at 60 and refuses the whole request
     with a 422 above it — the same trap runFlux documents at length. */
  const waitSeconds = Math.max(1, Math.min(60, Math.floor(waitMs / 1000)));
  const dataUri = `data:${mime || 'image/jpeg'};base64,${image.toString('base64')}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), waitMs);
  let started;
  try {
    const res = await fetchImpl('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${replicateKey}`,
        'Content-Type': 'application/json',
        'Prefer': `wait=${waitSeconds}`,
      },
      body: JSON.stringify({
        version: MODEL_VERSION,
        input: {
          image: dataUri,
          mask_prompt: prompt || maskPrompt({ changingDoor }),
          /* Deliberately empty. See the header: both negatives tried took the
             usable mask from 25.4% of the frame to 0.2%. */
          negative_mask_prompt: '',
          adjustment_factor: dilate,
        },
      }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()).slice(0, 200); } catch (_) {}
      note(`segmentation refused (${res.status}) ${detail}`);
      return null;
    }
    started = await res.json();
  } catch (err) {
    note(`segmentation call failed: ${err?.name === 'AbortError' ? 'timed out' : err?.message}`);
    return null;
  } finally {
    clearTimeout(timer);
  }

  /* Prefer: wait usually returns it finished. When it does not, poll to the
     same budget rather than to a fixed count, so a slow segmentation cannot
     outlive the render it belongs to. */
  let pred = started;
  while (pred && (pred.status === 'starting' || pred.status === 'processing')) {
    if (Date.now() > giveUpAt) { note('segmentation still running at the deadline'); return null; }
    await new Promise(r => setTimeout(r, 1500));
    try {
      const r = await fetchImpl(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { 'Authorization': `Bearer ${replicateKey}` },
      });
      if (!r.ok) { note(`segmentation poll failed (${r.status})`); return null; }
      pred = await r.json();
    } catch (err) {
      note(`segmentation poll failed: ${err?.message}`);
      return null;
    }
  }

  if (!pred || pred.status !== 'succeeded') {
    note(`segmentation ${pred?.status || 'gone'}${pred?.error ? `: ${String(pred.error).slice(0, 120)}` : ''}`);
    return null;
  }

  const out = Array.isArray(pred.output) ? pred.output : (pred.output ? [pred.output] : []);
  if (out.length <= MASK_INDEX) { note(`segmentation returned ${out.length} images, expected at least ${MASK_INDEX + 1}`); return null; }

  try {
    const r = await fetchImpl(out[MASK_INDEX]);
    if (!r.ok) { note(`could not fetch the mask (${r.status})`); return null; }
    const buffer = Buffer.from(await r.arrayBuffer());
    if (!buffer.length) { note('the mask came back empty'); return null; }
    /* The model names its outputs .png and returns JPEG. Sniffed rather than
       trusted, because hold.js picks its decoder off this. */
    const isPng = buffer.length > 8 && buffer[0] === 0x89 && buffer[1] === 0x50;
    return { buffer, mime: isPng ? 'image/png' : 'image/jpeg' };
  } catch (err) {
    note(`could not fetch the mask: ${err?.message}`);
    return null;
  }
}

/* The bay's pillars, as pixels (2 October, IMG_2068).

   A painted bay's pillars, capitals and cornice are the same white as its
   frames, and the render sometimes paints them with the frames: black and
   soft green both did on a bay-fronted terrace, while dark grey did not.
   The window mask cannot keep them back, because to segmentation the bay is
   one window and the pillars are inside it. So ask for the pillars by name,
   positively (a negative prompt swallows the window, see the header), and
   put them back to the photograph after the render.

   Shrunk rather than grown: a pillar mask that bleeds a few pixels onto the
   frame beside it would put a white stripe down every painted frame. */
const PILLAR_PROMPT = 'column, pillar, pilaster';
const PILLAR_DILATE = -2;
function fetchPillarMask(opts = {}) {
  return fetchWindowMask({ ...opts, prompt: PILLAR_PROMPT, dilate: PILLAR_DILATE });
}

/* The mask if it is ready or nearly ready, null if it is not.
 *
 * Kept here rather than in the route so the number and the reasoning live with
 * everything else about this model's timing. The pending request is left to
 * finish on its own — it is a fetch with a catch on it, and Replicate bills
 * the run whether or not we read the answer. */
async function maskWithinGrace(maskPromise, graceMs = GRACE_MS) {
  if (!maskPromise) return null;
  let timer;
  const grace = new Promise((resolve) => { timer = setTimeout(() => resolve(null), graceMs); });
  try {
    return await Promise.race([maskPromise, grace]);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { fetchWindowMask, fetchPillarMask, PILLAR_PROMPT, PILLAR_DILATE, maskWithinGrace, maskPrompt, MODEL_VERSION, MASK_INDEX, DILATE, MIN_BUDGET_MS, MAX_WAIT_MS, GRACE_MS };
