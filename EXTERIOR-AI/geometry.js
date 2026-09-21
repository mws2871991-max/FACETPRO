/* The geometry both measurement paths share.
 *
 * This existed twice — once in glazing.js and once in measure.js — as
 * byte-identical copies of box(), clamp(), isFiniteNumber() and shapeRatio(),
 * and two nearly-identical copies of doorReference(). That is not a tidiness
 * complaint. The fanlight bug lived in both, and fixing it meant finding it
 * twice; a fix applied to one copy and not the other leaves half the system
 * measuring a house differently from the other half, which is precisely the
 * failure nobody notices because both halves still return a number.
 *
 * The two doorReference implementations had already drifted apart before
 * anybody moved them here. glazing.js dropped implausibly small boxes from the
 * candidate set; measure.js chose first and rejected afterwards, so a
 * photograph offering one tiny door box and one good one would be measured by
 * glazing and abandoned by measure. The version below is glazing's, because
 * excluding a bad candidate is better than being defeated by it.
 */

'use strict';

/* A standard UK external door leaf. Every measurement taken from a photograph
   is scaled against this one number, which is why what goes inside the door
   box matters so much. */
const DOOR_HEIGHT_M = 1.98;

/* Tall for every one across: 1.98 by about 0.838. Used to tell a door leaf
   from the things that get boxed with it — a fanlight above, a canopy over, a
   step below, or a garage door that is wider than it is tall. */
const DOOR_LEAF_RATIO = DOOR_HEIGHT_M / 0.838;

/* Nothing wider than roughly this gets used as the 1.98 m ruler.

   Measured, in the frame the sweep used:

     door leaf, 0.9 x 1.98            2.20   accepted
     door + sidelights, 1.9 x 1.98    1.04   rejected
     garage door, 2.4 x 2.1           0.87   rejected
     wide sidelights, 2.2 x 1.98      0.90   rejected

   This is a deliberate trade, not a clean separation. A door boxed with wide
   sidelights scores 0.90 and a garage door 0.87 — indistinguishable, so no
   threshold tells them apart. Rejecting both costs the sidelight case its
   measurement: before this it read 73 m² as a door measurement, and now falls
   back to a weaker method.

   Kept anyway, because the two failure modes are not equal. A garage used as
   the ruler under-measures by about 19% and is presented with the highest
   confidence the system has. A rejected door falls back to a method that says
   what it is — "typical figure", or measured off wall coverage — and this
   codebase's whole position is that a number should carry how it was arrived
   at. A rougher answer that admits what it is beats a confident wrong one.

   The way out is not a better threshold; shape has been asked and cannot
   answer. It is one surveyed property with sidelights, which would say whether
   the door height inside such a box is reliable enough to use. */
const MIN_DOOR_RATIO = 1.2;

const DOOR_TYPES = new Set(['door-front']);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/* A detection's box as percentages of the frame, or null if it is not usable.
   Clamped to the frame, because a model will occasionally return a box that
   hangs off the edge of the photograph. */
function box(d) {
  const x = Number(d?.x_pct), y = Number(d?.y_pct), w = Number(d?.w_pct), h = Number(d?.h_pct);
  if (![x, y, w, h].every(isFiniteNumber)) return null;
  if (w <= 0 || h <= 0) return null;
  return {
    x: clamp(x, 0, 100), y: clamp(y, 0, 100),
    w: clamp(w, 0, 100), h: clamp(h, 0, 100),
  };
}

const intersectionPct = (a, b) => {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return w * h;
};

/* The real proportions of a box, from percentages of a frame that is not
   square: heights are percentages of the frame height and widths percentages
   of its width, so the aspect ratio has to come back out before two of them
   can be compared. */
const shapeRatio = (b, aspectRatio) =>
  (b && b.w > 0 && isFiniteNumber(aspectRatio) && aspectRatio > 0)
    ? (b.h / b.w) / aspectRatio
    : null;

/* Which box is the front door, when more than one thing claims to be.
 *
 * This took the tallest, which is the wrong instinct the moment a fanlight is
 * involved: a Victorian doorway offered as door-leaf and as door-plus-fanlight
 * would always have been read as the taller of the two. The scale is 1.98 m
 * divided by that height, so a box 29% too tall makes every window 22% too
 * small and — because wall area goes as the square — the walls 40% too small.
 * Measured on a synthetic terrace: 77 m² read as 46 m².
 *
 * Two rules, and only one of them is a threshold:
 *
 *   Anything much wider than it is tall is dropped rather than used as the
 *   ruler — a garage door scores 0.87 against a leaf's 2.36. This one is a
 *   deliberate trade rather than a clean cut: a door boxed with wide sidelights
 *   scores 0.90 and cannot be told apart. See MIN_DOOR_RATIO.
 *
 *   Among what is left, prefer the most door-shaped rather than the biggest.
 *   Excess HEIGHT is not thresholded, because a narrow door legitimately
 *   scores 2.89 and a leaf-plus-fanlight 3.04 — guessing between those would
 *   reject real doors. The detection prompt is the defence there, and real
 *   photographs will say where the line sits.
 *
 * Returning null is a supported answer: the callers measure another way and
 * say which way they used.
 */
function doorReference(detections, aspectRatio) {
  const doors = detections
    .filter(d => DOOR_TYPES.has(d?.type))
    .map(d => ({ b: box(d), confidence: Number(d?.confidence) || 0 }))
    .filter(d => d.b && d.b.h >= 2);   // implausibly small box — reject rather than divide by it
  if (!doors.length) return null;

  const plausible = doors.filter(d => {
    const r = shapeRatio(d.b, aspectRatio);
    return r === null || r >= MIN_DOOR_RATIO;
  });
  if (!plausible.length) return null;

  const scored = plausible.map(d => {
    const r = shapeRatio(d.b, aspectRatio);
    return { ...d, ratio: r, off: r === null ? Infinity : Math.abs(r - DOOR_LEAF_RATIO) };
  });
  /* Falls back to the old behaviour when the frame shape is unknown, so a
     caller without an aspect ratio is no worse off than before. */
  if (scored.every(d => d.off === Infinity)) return plausible.sort((a, b) => b.b.h - a.b.h)[0];
  return scored.sort((a, b) => a.off - b.off)[0];
}

/* Did the photograph contain anything claiming to be a front door, whether or
   not it survived the checks above? The difference between "no door detected"
   and "a door was detected and discarded" is a sentence a homeowner reads. */
const sawDoorBox = (detections) => detections.some(d => DOOR_TYPES.has(d?.type) && box(d));

/* The shape of the most door-like box the photograph offered, INCLUDING the
   ones doorReference refuses.

   Recording only accepted boxes would be sampling the answer: every rejected
   garage door and every wide sidelight box — the shapes MIN_DOOR_RATIO is
   guessing about — would be missing from the evidence used to set
   MIN_DOOR_RATIO. The rejects are the interesting half. */
function observedDoorShape(detections, aspectRatio) {
  const shapes = detections
    .filter(d => DOOR_TYPES.has(d?.type))
    .map(d => box(d))
    .filter(Boolean)
    .map(b => ({ ratio: shapeRatio(b, aspectRatio), heightPct: b.h }))
    .filter(x => x.ratio !== null);
  if (!shapes.length) return { ratio: null, heightPct: null, count: 0 };
  const best = shapes.slice().sort((a, b) =>
    Math.abs(a.ratio - DOOR_LEAF_RATIO) - Math.abs(b.ratio - DOOR_LEAF_RATIO))[0];
  return { ratio: best.ratio, heightPct: best.heightPct, count: shapes.length };
}

/* ── WHERE THE HOUSE IS, SO THE NEIGHBOUR CAN BE LEFT OUT OF THE FRAME ──

   Choosing a roof changed the roof of the house next door. Three prompt
   wordings were measured against it — naming the subject, naming the frame
   edges, stating the scope first — and the right-hand neighbour went
   -2 -> 90, then 84, then 71 in mean red-minus-blue. Monotonic improvement,
   no resolution.

   The asymmetry is the diagnosis. The left neighbour sits fully inside the
   frame with sky above it and was held every time; the right one runs off the
   edge, so its roof plane reads as a continuation of this roofline. Kontext
   edits regions, not objects, and the region does not stop at the property
   line. Words cannot fix that.

   Repairing the output cannot either, not cheaply: the model does not promise
   to return the input's dimensions, so compositing the original back means
   resizing one to match the other, pasting, and re-encoding — quality loss on
   every render, for a repair.

   So: crop the photograph before the model sees it. A neighbour that is not
   in the frame cannot be edited, there is less frame to wander into
   generally, and it costs nothing but some drive and sky.

   Percentages in, percentages out. No pixels on the server — the browser owns
   those, and this owns the arithmetic so it can be tested. */

/* What bounds this house, and what merely proves it is a house.

   Cladding is deliberately NOT in the first set. Asked to find the walls, the
   model returns one region covering every brick surface in the frame — on
   both of this site's own photographs it came back x 0..100, "Yellow Brick
   Wall Cladding" and "Brick Wall Lower", spanning the neighbours' walls as
   well. A box that always covers the whole frame cannot bound anything, and
   unioning it in guarantees this function can never crop.

   The roof, the roofline and the openings are per-building: the model labels
   "Main Roof", and on the bay-fronted photograph it went as far as naming an
   "Adjacent House Window" separately rather than merging it in.

   Cladding still counts as an ANCHOR, because its presence is good evidence
   the detection found a house at all — it just cannot say where the house
   stops. */
const SUBJECT_BOUND_TYPES = new Set([
  'roof', 'door-front', 'window', 'fascia', 'soffit', 'guttering',
]);
const SUBJECT_ANCHOR_TYPES = new Set(['door-front', 'cladding']);

/* Cladding is greedy sideways and honest downwards.

   Leaving it out of the horizontal bounds is necessary — it spans every brick
   in the frame. Leaving it out of the VERTICAL bounds breaks the crop a
   different way: it is the only box that reaches the ground, so without it
   the bottom edge lands at the lowest window and the crop cuts the house off
   at the knees. "Brick Wall Lower, y 55..100" is a true statement about how
   far down this house goes even when it is a false one about how far across.

   So: sideways from the per-building boxes, downwards from everything. */
const SUBJECT_VERTICAL_TYPES = new Set([...SUBJECT_BOUND_TYPES, 'cladding']);

/* The same confidence floor glazing.js uses. A box we would not price from is
   not a box to crop from. */
const SUBJECT_MIN_CONFIDENCE = 0.45;

/* Room around the house, so a tight detection does not shave the eaves. */
const SUBJECT_MARGIN_PCT = 6;

/* When cropping is not safe. Every one of these returns null, and null means
   the photograph goes to the model untouched — which is today's behaviour and
   therefore a known quantity. A wrong crop is worse than the bug it fixes. */
const SUBJECT_MIN_AREA_PCT = 35;   // below: the detections missed most of the house
const SUBJECT_MAX_AREA_PCT = 92;   // above: nothing to gain, and a risk of shaving
const SUBJECT_MIN_SIDE_PCT = 40;   // a degenerate box means bad detections
const SUBJECT_MIN_CLEAR_PCT = 3;   // no clear side means no neighbour to remove

function subjectBox(detections) {
  const list = Array.isArray(detections) ? detections : [];

  let hasAnchor = false;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;

  for (const d of list) {
    const type = String(d?.type || '');
    if ((Number(d?.confidence) || 0) < SUBJECT_MIN_CONFIDENCE) continue;
    const b = box(d);
    if (!b) continue;
    /* A door or a wall is what makes this a house rather than a scattering of
       windows. Without one the detection is too thin to crop on. */
    if (SUBJECT_ANCHOR_TYPES.has(type)) hasAnchor = true;
    if (SUBJECT_VERTICAL_TYPES.has(type)) {
      y0 = Math.min(y0, b.y); y1 = Math.max(y1, b.y + b.h);
    }
    if (!SUBJECT_BOUND_TYPES.has(type)) continue;
    x0 = Math.min(x0, b.x); x1 = Math.max(x1, b.x + b.w);
  }

  if (!hasAnchor || !isFiniteNumber(x0) || x1 <= x0 || y1 <= y0) return null;

  const left = clamp(x0 - SUBJECT_MARGIN_PCT, 0, 100);
  const top = clamp(y0 - SUBJECT_MARGIN_PCT, 0, 100);
  const right = clamp(x1 + SUBJECT_MARGIN_PCT, 0, 100);
  const bottom = clamp(y1 + SUBJECT_MARGIN_PCT, 0, 100);

  const w = right - left, h = bottom - top;
  if (w < SUBJECT_MIN_SIDE_PCT || h < SUBJECT_MIN_SIDE_PCT) return null;

  const areaPct = (w * h) / 100;
  if (areaPct < SUBJECT_MIN_AREA_PCT || areaPct > SUBJECT_MAX_AREA_PCT) return null;

  /* Something to actually remove. If the house already fills the width there
     is no neighbour beside it and cropping only loses context. */
  const clear = Math.max(left, 100 - right);
  if (clear < SUBJECT_MIN_CLEAR_PCT) return null;

  const r1 = (n) => Math.round(n * 10) / 10;
  return { x: r1(left), y: r1(top), w: r1(w), h: r1(h) };
}

module.exports = {
  DOOR_HEIGHT_M, DOOR_LEAF_RATIO, MIN_DOOR_RATIO, DOOR_TYPES,
  clamp, isFiniteNumber, box, intersectionPct, shapeRatio,
  doorReference, sawDoorBox, observedDoorShape,
  subjectBox, SUBJECT_MARGIN_PCT, SUBJECT_BOUND_TYPES, SUBJECT_ANCHOR_TYPES, SUBJECT_VERTICAL_TYPES,
};
