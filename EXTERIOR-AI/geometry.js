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

module.exports = {
  DOOR_HEIGHT_M, DOOR_LEAF_RATIO, MIN_DOOR_RATIO, DOOR_TYPES,
  clamp, isFiniteNumber, box, intersectionPct, shapeRatio,
  doorReference, sawDoorBox,
};
