/* ─────────────────────────────────────────────────────────────────────────
   Per-unit window and door pricing from a single front-elevation photo.

   Pure functions only — no I/O, no network — so the geometry and the money
   can be tested directly. server.js owns the endpoint and the stored
   detection records, exactly as it does for measure.js.

   WHY THIS EXISTS
   ---------------
   /api/detect already returns a box for every window and for the front door.
   measure.js already turns the door box into a metres-per-pixel scale, and
   already computes the area of every opening — and then throws that number
   away, because openings only existed there as something to SUBTRACT from
   the wall.

   Windows and doors are the core product. The measurement needed to price
   them per unit is therefore already being computed and discarded on every
   upload. This module keeps it.

   WHAT IT PRODUCES
   ----------------
   A PLANNING ESTIMATE and nothing more, on the same terms as measure.js:
   returned as a range, never to be presented as a survey figure, and always
   subject to the homeowner correcting the window count by hand. A glazing
   quote depends on frame sizes measured on site, glazing spec, sill and
   cavity condition, and whether the opening is being altered — none of which
   a photograph can settle.

   Two methods, in order of preference, mirroring measure.js:

   1. Door reference (primary). A UK front door is ~1.98 m. The detected
      door's height in the image gives the scale, which turns each window
      box into real width and height in metres, which puts it in a size
      band. Independent of how far away the homeowner stood.

   2. House-type prior (fallback, when no door was detected, or when the
      detected windows are implausible). A typical window count and a
      typical mix of bands for that kind of house. Much weaker, and the
      returned range says so.

   In both cases `countSource` is reported so the UI can say plainly which
   one produced the figure — the same contract measure.js has with
   footprintSource, and the reason the estimate panel can be honest about
   what it knows.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

/* Shared with measure.js. These lived in both files as identical copies, and
   the fanlight bug had to be found in each of them separately. */
const { clamp, isFiniteNumber, box, doorReference, subjectBox } = require('./geometry');

const { DOOR_HEIGHT_M } = require('./measure');

/* ── TUNING ──
   Everything here is geometry or detection hygiene. Money lives in
   catalogue.json and is passed in, so rates can be re-sourced without
   touching this file — the same split the cladding pricing uses. */

// Below this, a detection is noise. Reflections in glass and dark porch
// recesses are the two things Claude vision most often calls a window.
const MIN_CONFIDENCE = 0.45;

// Two boxes overlapping by more than this are one window counted twice,
// which happens on bays and on mullioned units. Keep the larger.
const DUPLICATE_IOU = 0.55;

// A window smaller than this in either dimension is not a window at scale —
// it is a vent, a pane within a frame, or a bad box.
const MIN_WINDOW_W_M = 0.35;
const MIN_WINDOW_H_M = 0.35;

// Nor is anything bigger than this a domestic window unit.
const MAX_WINDOW_W_M = 5.0;
const MAX_WINDOW_H_M = 3.2;

/* A bay's box is not its window's box.

   Detection draws a bay as one box round the whole structure: the cornice,
   the painted columns and the sill under it, as well as the glass. On an
   Edwardian terrace photographed on 28 September (number 14, two bays) that
   made each bay 3.6–3.9 m tall, over MAX_WINDOW_H_M, and both were thrown
   away as implausible. The house was priced on four windows: the two flat
   sashes, the dormer, and the neighbour's roof window. Its two most
   expensive units were missing.

   So a unit known to be a bay is never rejected for its height. Its width is
   the bay's own, measured; its height is the box's height minus the
   stonework, which the photograph cannot separate from the glass, so it is
   taken as a typical bay light and said to be typical (heightAssumed). */
const MAX_BAY_H_M = 5.0;
const BAY_GLAZED_H_M = 2.0;
const BAY_LABEL = /\bbay\b/i;

// What a house can plausibly have. Outside this the detection is wrong, and
// the honest answer is the prior rather than a confident wrong number — the
// same reasoning as the manual-area bounds in computePrice.
const { MIN_WINDOWS, MAX_WINDOWS } = require('./limits');

/* A window whose box sits entirely above the top of the front door is on an
   upper storey. Crude, and deliberately so: it needs no assumption about
   storey height, only that the door is at ground level. The tolerance
   absorbs a box drawn slightly loose. */
const UPPER_STOREY_TOLERANCE_PCT = 1.5;

/* How wide a range to show, by method. Wider than measure.js's equivalents
   because window count is discrete: one missed window on a five-window
   terrace is a 20% error, and no amount of geometric precision recovers it. */
/* How unsure we are about the size of the job, by how we arrived at it.

   `count` sits between the other two on purpose: the number of windows is
   observed rather than assumed, which is most of the answer, but their sizes
   are typical rather than measured, which is the rest of it. */
const UNCERTAINTY = { door: 0.18, count: 0.24, prior: 0.30 };

/* ── WHAT THE SAME JOB GETS QUOTED AT ELSEWHERE ──

   UNCERTAINTY above is our own measurement error: how unsure we are about the
   size of the job. It is not the biggest number on this page and never was.
   The biggest number is that two installers price identical work miles apart,
   and one installer prices it differently depending on how the evening goes.

   From notes/glazing-rates-from-the-trade.md, against the settled prices now
   in the catalogue:

     Composite door   ours £2,000   market £1,800 – £4,000   0.90× – 2.00×
     Bifold, 3 panels ours £4,000   market £3,500 – £8,000   0.88× – 2.00×

   Two products, two installers, and the same shape both times: the floor sits
   just under our figure and the ceiling sits at double it. So the multiple is
   taken as 0.88× to 2.0× rather than averaged into something tidier — the
   agreement between the two rows is the finding.

   This is deliberately NOT folded into `range`. Blurring the two would take a
   number we can defend to ±18% and present it as ±100%, which reads as not
   knowing rather than as knowing something worth knowing. They are different
   claims and the page makes them separately: here is the job, and here is what
   the market would charge you for it.

   Honest limits, because someone will ask. Two products, both doors, both from
   one person's experience of two national installers. Windows are assumed to
   behave the same way and that assumption is untested — notes/ records it as
   an open question. Replace this the moment the window bands arrive with the
   ranges attached, and widen or narrow it per band if the gap moves with
   size. */
/* Two different things, kept apart because they are two different questions.

   INSTALLER_SPREAD is which company quoted: x0.88 at the keener of the two
   national installers, x1.6 at the other, with the discount properly applied
   at both. That is the range a homeowner faces before they have done anything
   at all, and it is what the estimate spans.

   NO_HAGGLE is the same installer and a customer who did not push. Anglian's
   settled range on 3 August ran to x2.0 of our base, against x1.62 for the
   same door with the full 40% taken off. The difference is not the product,
   the company or the specification. It is one conversation on a weeknight.

   Putting them in one band said "somewhere between £7,570 and £17,204", which
   is true and useless. Apart, the first number is the price and the second is
   what the negotiation is worth — about £3,400 on a semi, which is the whole
   argument of this company expressed as a figure a homeowner can act on. */
const INSTALLER_SPREAD = { low: 0.88, high: 1.6 };
const NO_HAGGLE = 2.0;

/* Kept under the old name because the whole codebase and its tests refer to
   it, and it still means "the range across the market". Its high end now
   describes the dearer installer rather than the dearer installer plus a
   customer who did not negotiate. */
const MARKET_SPREAD = INSTALLER_SPREAD;

/* Are the window bands in this catalogue real, or still the invented ones?
   Mirrors the check server.js makes on the same field, and reads the
   catalogue it was handed rather than the one on disk, so a test can pass
   sourced rates and see the comparison appear. */
/* An explicit field, not a reading of the prose.

   This searched `source` for "not sourced" or "placeholder". The note now
   ends "Not a supplier rate card", which contains neither phrase, so the
   guard passed — correctly, as it happens, because the rates ARE real. But it
   passed by accident: any rewording could flip whether every window estimate
   is labelled a guide, and the person rewording it would have no idea. A
   sentence is documentation; a boolean is a decision.

   Absent means NOT sourced. A catalogue that has not said so yet should get
   the cautious label rather than the confident one. */
const windowRatesSourced = (rates) => rates?.sourced === true;

/* The comparison, or nothing. Doors-only jobs keep it because every figure in
   them came from a completed job; anything containing a window loses it until
   the bands are sourced. */
function marketRangeFor(rates, price) {
  const hasUnsourcedWindows = !windowRatesSourced(rates) && (price.supplyFit || 0) > 0;
  if (hasUnsourcedWindows) return null;
  return {
    low: round(price.total * MARKET_SPREAD.low),
    high: round(price.total * MARKET_SPREAD.high),
  };
}

/* Typical glazing by house type, for the fallback. Counts are front, side
   and rear — a whole-house replacement, which is what people price.

   These are round numbers from the English Housing Survey dwelling sizes and
   ordinary UK plan forms, NOT measured against surveyed properties. They are
   the glazing equivalent of measure.js's HOUSE_TYPE_PRIORS and deserve the
   same treatment: replace them with your own completed jobs as soon as you
   have thirty of them. Until then the range around them is wide on purpose. */
const HOUSE_TYPE_GLAZING_PRIORS = {
  terrace:    { windows: 6,  mix: { small: 1, standard: 4, large: 1, xlarge: 0 } },
  endTerrace: { windows: 8,  mix: { small: 1, standard: 5, large: 2, xlarge: 0 } },
  semi:       { windows: 8,  mix: { small: 1, standard: 5, large: 2, xlarge: 0 } },
  detached:   { windows: 11, mix: { small: 2, standard: 6, large: 3, xlarge: 0 } },
  bungalow:   { windows: 7,  mix: { small: 1, standard: 4, large: 2, xlarge: 0 } },
};

const DEFAULT_HOUSE_TYPE = 'semi';

/* Only the front elevation is visible in the photo. A quote is for the whole
   house. This is the same problem measure.js solves for wall area, and the
   same kind of answer — but glazing does not distribute like wall area does:
   rear elevations usually carry MORE glass than fronts (patio doors, kitchen
   windows), sides usually carry much less.

   Derived from plan form rather than fitted to data, and flagged accordingly.
   Set glazing.frontToTotal in catalogue.json to override per type. */
const FRONT_TO_TOTAL_WINDOWS = {
  terrace:    2.2,   // front and rear only; rear usually the busier elevation
  endTerrace: 2.6,
  semi:       2.6,
  detached:   3.0,
  bungalow:   2.4,
};

const round = (n) => Math.round(n);

function iou(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = w * h;
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}



const normaliseType = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');
const TYPE_LOOKUP = new Map(Object.keys(HOUSE_TYPE_GLAZING_PRIORS).map(k => [normaliseType(k), k]));
for (const [alias, canonical] of [
  ['semidetached', 'semi'],
  ['endofterrace', 'endTerrace'],
  ['endterraced', 'endTerrace'],
  ['midterrace', 'terrace'],
  ['midterraced', 'terrace'],
  ['terraced', 'terrace'],
  ['detatched', 'detached'],
]) TYPE_LOOKUP.set(alias, canonical);

function houseTypeKey(input) {
  return TYPE_LOOKUP.get(normaliseType(input)) || DEFAULT_HOUSE_TYPE;
}

/* The same lookup, refusing to guess.

   houseTypeKey answers "which prior do I price against", and defaulting to a
   semi is right there: something has to be priced. This answers a different
   question — "did anybody actually say what kind of house this is" — and for
   that a default is the bug. House type picks the plausibility band the wall
   measurement is checked against, so a detached house silently treated as a
   semi has a perfectly good 181 m² reading refused for sitting outside
   55–130, and the estimate quietly becomes a typical figure.

   Null means nobody said. The caller decides what to do about that, and the
   one thing it must not do is pretend somebody did. */
function resolveHouseType(input) {
  return TYPE_LOOKUP.get(normaliseType(input)) || null;
}

/* The house type from what the photograph shows at each side, not from the
   model's verdict.

   The detection prompt has always said "if the photograph does not show
   enough of the sides to tell, omit the field". It did not: on 24 September
   all four of the site's own photographs came back "detached", including
   hero-before.jpg — a close portrait crop of a bay-fronted semi where neither
   side is in shot. So the model now reports each side separately — "gap",
   "shared" or "cut-off" — and the type is decided here, where the rule can be
   read and tested:

     gap + gap        detached
     shared + gap     semi-detached (end-terrace if the model says so)
     shared + shared  mid-terrace
     any cut-off      unknown — the homeowner is asked

   A bungalow is a storey count, not a matter of sides, so the model's word is
   taken for it. With no side evidence at all (an older cached record) this
   falls back to the model's verdict, as before. */
const SIDE_VALUES = new Set(['gap', 'shared', 'cut-off']);
function houseTypeFromEvidence(analysis) {
  const claimed = resolveHouseType(analysis?.houseType);
  if (claimed === 'bungalow') return 'bungalow';
  const left = String(analysis?.sides?.left || '').toLowerCase();
  const right = String(analysis?.sides?.right || '').toLowerCase();
  if (!SIDE_VALUES.has(left) || !SIDE_VALUES.has(right)) return claimed;
  if (left === 'cut-off' || right === 'cut-off') return null;
  const shared = (left === 'shared') + (right === 'shared');
  if (shared === 0) return 'detached';
  if (shared === 2) return 'terrace';
  return claimed === 'endTerrace' ? 'endTerrace' : 'semi';
}

/* ── SIZING ──
   With W/H the image dimensions in pixels and aspect = W/H:

     m per px (vertical) = 1.98 / ((doorH% / 100) · H)

   A window's height in metres is (winH% / 100) · H × that, and H cancels:

     height m = 1.98 · winH% / doorH%
     width  m = 1.98 · aspect · winW% / doorH%

   So nothing beyond the boxes and the aspect ratio is needed — and the
   server reads the aspect ratio from the image bytes, never from the client,
   which is what stops a tampered request inflating every window at once. */
function sizeWindow(b, doorHeightPct, aspectRatio) {
  const heightM = DOOR_HEIGHT_M * b.h / doorHeightPct;
  const widthM = DOOR_HEIGHT_M * aspectRatio * b.w / doorHeightPct;
  return { widthM, heightM, areaM2: widthM * heightM };
}

function bandFor(areaM2, bands) {
  for (const band of bands) {
    if (band.maxAreaM2 == null || areaM2 <= band.maxAreaM2) return band;
  }
  return bands[bands.length - 1];
}

/* ── METHOD 1: measure the windows in the photo ── */
/* Which boxes are windows at all — the hygiene both paths need.

   This used to live inside measureWindows, and when the counting path was
   added it grew its own one-line filter instead: type, and positive width and
   height. That let through everything this drops.

   Three overlapping boxes for one bay window counted as three, and a detection
   at 0.05 confidence — which this rejects outright — counted the same as one
   at 0.95. Both were then multiplied by the front-to-total ratio, so one
   window became nine and six pieces of noise became eighteen. The counting
   path exists because the prior overstated by half; unfiltered it overstated
   by more, and said "counted from your photo" while doing it, which is a
   stronger claim than the one it replaced.

   Only the sizing step needs a door. Everything here is scale-free, so both
   paths get it. */
/* Glazed panels either side of a front door. The detection prompt asks for
   "any window", so the model boxes them and types them window; they are part
   of the door set and are quoted with it. On a real photograph two of these
   turned five windows into seven, and the front-to-total ratio made that
   roughly six phantom windows in the price. */
const SIDELIGHT_LABEL = /\bside[\s-]?(lights?|panels?)\b/i;

/* One pane of a window the model has split up: "Lower Bay Window - Left Pane".
   The part before the last " - " names the window; the rest names the pane.
   Two bays came back as eight windows this way — IoU dedupe cannot catch it,
   because panes sit side by side rather than on top of each other. */
const PANE_LABEL = /^(.+?)\s+-\s+[^-]*\bpanes?\b[^-]*$/i;

function unionBox(a, b) {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

/* Panes of one window, told apart from separate windows by where they are.

   PANE_LABEL above catches "Lower Bay Window - Left Pane", which is what the
   model produced on 19 September. On 20 September the same photograph came
   back as "Upper Bay Window Left Angled", "Upper Bay Window 2", "Upper Bay
   Window Center" — no "pane", no " - ", and the bay was counted as five
   windows again. Labels are model prose and they vary run to run; a rule that
   reads them is a rule that works on the run it was written for.

   Geometry does not vary. Measured off both of this site's own photographs:

     bay panes        horizontal gap 0.0      (they share an edge exactly)
     separate windows horizontal gap 7, 16, 31

   Nothing observed sits between. The threshold is 2% of frame width, which
   leaves three and a half times the margin below the nearest real gap — a
   pier of brick between two windows is simply not that thin.

   Vertical overlap is required as well, so the upper bay never merges with
   the lower one beneath it, and a run is merged transitively: five touching
   panes collapse to one unit rather than to two.

   Merging is the conservative direction. A "double window" or a bay is one
   unit to whoever quotes it, so joining two boxes that genuinely touch is
   what the trade would do anyway; splitting one is what put six phantom
   windows in a price. */
const PANE_GAP_MAX_PCT = 2;

/* Panes in one merged unit before it is a bay rather than a wide window. */
const BAY_MIN_PANES = 3;        // of frame width
const PANE_ROW_OVERLAP_MIN = 0.6;  // of the shorter box's height

function touchesHorizontally(a, b) {
  const gap = Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w);
  if (gap > PANE_GAP_MAX_PCT) return false;
  const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  return overlapY >= PANE_ROW_OVERLAP_MIN * Math.min(a.h, b.h);
}

function mergeAdjacent(list) {
  /* Each output unit remembers how many panes went into it.

     Merging was only ever counted in aggregate, as panesMerged, which answers
     "how many boxes did we collapse" and not "is this one a bay". Those are
     different questions and only the second can name a unit or price it. */
  const out = list.map(c => ({ panes: 1, ...c }));
  let merged = 0;
  let again = true;
  while (again) {
    again = false;
    outer:
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        if (!touchesHorizontally(out[i].b, out[j].b)) continue;
        out[i].b = unionBox(out[i].b, out[j].b);
        out[i].confidence = Math.max(out[i].confidence, out[j].confidence);
        out[i].panes = (out[i].panes || 1) + (out[j].panes || 1);
        out.splice(j, 1);
        merged++;
        again = true;
        break outer;
      }
    }
  }
  return { list: out, merged };
}

/* Is this detection a glazed panel of the door set rather than a window?

   Exported so the page can say so too. It listed "Porch Sidelight Left —
   WINDOW" under a heading reading "We found 5 windows", having excluded it
   from the five: the same box described two ways on one screen. */
function isSidelight(d) {
  return d?.type === 'window' && SIDELIGHT_LABEL.test(String(d?.label || ''));
}

/* Is this box on the customer's house, or the one next door?

   A run-through on 22 September returned thirteen elements, one of them
   labelled by the model itself as "Neighboring Structure Window" — and it was
   counted. On a front count of three, with a detached house's x3.0 multiplier,
   a third of that homeowner's glazing estimate was their neighbour's window.

   windowCandidates filtered on type and confidence, dropped sidelights, merged
   panes and deduped overlaps, and never once asked whose house the box was on.

   geometry.subjectBox already answers that. It is computed on every detection
   and already returned by /api/detect; it simply was not consulted here.
   Tested on the box centre rather than on overlap, because a bay on the party
   wall of a semi legitimately touches the edge of the subject box and would
   fail an containment test while plainly belonging to this house.

   THE NULL IS THE DANGEROUS PART. subjectBox returns null on four guards — no
   door or cladding to anchor on, a box too small, one covering too much of the
   frame, or no clear margin either side. Null must mean "count everything, as
   today". If it fell through as an empty box every window would sit outside
   it, the count would go to zero, and photographs that work today would price
   at nothing — a far worse fault than the one being fixed, and one that would
   only appear on the photographs where the guards trip. Hence the explicit
   early return rather than a clever default. */
function insideSubject(b, subject) {
  if (!subject) return true;              // no opinion — count it, as today
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  return cx >= subject.x && cx <= subject.x + subject.w
      && cy >= subject.y && cy <= subject.y + subject.h;
}

/* And the case geometry cannot reach, where the model simply says so.

   On a terrace the detector returns the whole row's roof, fascia, soffit and
   guttering as single full-frame boxes, so there is nothing to bound a subject
   box with and subjectBox correctly returns null. On exactly such a photograph
   it also returned a window labelled "Adjacent House Window" — and counted it.

   This is deliberately not the mistake the bay-pane rule made. That one parsed
   a label FORMAT — a " - " and the word "Pane" — to infer a grouping, and broke
   the next day when the model phrased it differently. This reads an explicit
   statement of ownership that the model volunteered, for an exclusion. If the
   wording changes we are no worse than today.

   The single regex that used to live here claimed "adjacent", "neighbour" and
   "next door" all describe whose building it is and nothing else does. Half of
   that was wrong, and see disowned() below for what it cost: "adjacent"
   describes where a thing is, and a window adjacent to the customer's own
   front door is the customer's own. The two kinds of word are now two
   constants with two different burdens of proof. */

/* Whose building — by whichever test can actually answer.

   Geometry first, always. The label only speaks where there is no subject box
   to ask, which is the terrace case this rule was written for: the row's roof,
   fascia and guttering come back as single full-frame boxes, nothing bounds a
   subject, and subjectBox correctly returns null.

   Running the label test everywhere was wrong in a way that matters. A window
   on the customer's own house called "Window Adjacent To Front Door" would be
   dropped even where the subject box exists and says plainly that it is
   theirs — and the justification for that, that no window on somebody's own
   house is ever labelled so, is an assumption about model phrasing. The
   bay-pane rule is the standing evidence that model phrasing drifts.

   The two mistakes are not equal. Counting a neighbour's window overcharges
   somebody; dropping one of their own undercharges, silently, on a house we
   could see perfectly well. Confining the label to where geometry is silent
   costs nothing on the photograph that found the bug and removes the only way
   this rule can delete a real window. */
function isNeighbours(b, label, subject) {
  /* Geometry only, now that disowned() reads the labels properly.
 *
 * This used to fall back to NEIGHBOUR_LABEL whenever there was no subject box
 * — and there usually is not; subjectBox returns null on most real
 * photographs, by design, because it refuses anything it cannot bound
 * confidently. So the fallback was not a fallback, it was the main path, and
 * it deleted any window the model happened to label "adjacent" anywhere on the
 * frontage. "Window Adjacent To Front Door" is the example its own comment
 * gave as the thing that must never happen, and it was happening on every
 * photograph without a subject box.
 *
 * disowned() now makes the distinction that rule wanted and could not express:
 * an ownership word anywhere, a positional word only at the frame's edge. It
 * runs unconditionally in windowCandidates, so there is nothing left for this
 * to fall back to. No subject box means no geometric opinion. */
  if (!subject) return false;
  return !insideSubject(b, subject);
}

/* Whose house the model says it is — split from where it says it sits.
 *
 * NEIGHBOUR_LABEL lumps two different kinds of word together, and the
 * difference is the whole rule. "Neighbour", "neighbouring" and "next door"
 * state OWNERSHIP: the model volunteering that this thing belongs to another
 * property. "Adjacent" states POSITION, and a window adjacent to the front
 * door is the customer's own. isNeighbours' comment has always said the first
 * is what it wants to read; it just had no way to ask for it separately.
 *
 * Number 14 is why it matters. The live reading returned "Neighbour (No.12)
 * first floor window" — above number 12's own front door, plainly theirs, and
 * the model said so in as many words. It sits well inside the subject box and
 * nowhere near the frame edge, so geometry could not catch it and neither
 * could an edge test. Counted, it put a fifth window on a house with four and
 * charged a terrace multiplier on top.
 *
 * So: an ownership word is trusted wherever it appears. A positional word
 * still needs corroboration, and the frame's edge is the corroboration
 * available — a window can only be sliced by the edge if the photograph stops
 * there. "Window Adjacent To Front Door", the case the original comment was
 * most afraid of, is in the middle of the frontage and survives both tests.
 *
 * Runs whether or not there is a subject box, unlike everything else here. */
/* "Adjacent" alone is where; "adjacent house" is whose. What the word
   qualifies is the whole distinction — "Adjacent House Window" and "Window
   Adjacent To Front Door" share a word and mean opposite things. */
const NEIGHBOUR_OWNED = /\b(neighbou?r(ing|s|'s)?|next[\s-]door)\b|\badjacent\s+(house|home|propert|building|dwelling|structure)/i;
const NEIGHBOUR_NEARBY = /\badjacent\b/i;

/* A photograph with two front doors is a photograph of two houses.
 *
 * The rule below reads the model's own words, and on number 14 that works
 * whenever the model volunteers "Neighbour (No.12)". The evening run-through
 * of 28 September caught the other half: when it does not volunteer it, the
 * sash above number 12's door is priced AND repainted, because the same answer
 * feeds the count and the render mask. One root cause, two defects — five
 * windows on a house with four, and next door's frames turned anthracite.
 *
 * Geometry can settle it without the label, because the photograph contains
 * the evidence: two front doors. A window sitting directly above a doorway,
 * within that doorway's width, belongs to the house that doorway belongs to.
 * That is how a terrace is laid out and it is why the fanlight rule below can
 * use the same relationship.
 *
 * Only ever fires when there is more than one front door in shot, so a normal
 * photograph of one house is untouched by it. `ours` is the doorway the survey
 * is already scaled against — the same door whose 1.98 m sets every
 * measurement — so the count and the ruler cannot disagree about which house
 * this is. Without an aspect ratio there is no way to know which door that is,
 * and the rule stands down rather than guess: doorReference falls back to the
 * TALLEST door there, and on this photograph the tallest is number 12's.
 *
 * The failure to fear is dropping somebody's real window, so both conditions
 * are required and the overlap is a clear majority of the window's width. A
 * window beside a neighbour's door, or above our own, is untouched. */
const OTHER_DOOR_OVERLAP = 0.6;

function aboveAnotherFrontDoor(b, ours, doors) {
  if (!ours || doors.length < 2) return false;
  for (const d of doors) {
    if (Math.abs(d.x - ours.x) < 0.01 && Math.abs(d.y - ours.y) < 0.01) continue;   // our own doorway
    if (b.y + b.h > d.y) continue;                                                  // must be ABOVE it, not beside it
    const overlap = Math.min(b.x + b.w, d.x + d.w) - Math.max(b.x, d.x);
    if (overlap >= b.w * OTHER_DOOR_OVERLAP) return true;
  }
  return false;
}

function disowned(b, label) {
  if (NEIGHBOUR_OWNED.test(label)) return true;
  if (NEIGHBOUR_NEARBY.test(label)) return b.x <= 1 || b.x + b.w >= 99;
  return false;
}

/* The glazed panel above a front door is part of the door set, like the
   sidelights beside it.
 *
 * "Fanlight above Front Door" came back typed `window` on number 14 and was
 * priced as a small window — the same mistake sidelights made, in the one
 * direction sidelights could not: above rather than beside. Nobody quotes a
 * fanlight as a window; it is replaced with the door or not at all.
 *
 * By words first, because the model usually says so, and by geometry when it
 * does not: sitting just above the door and no wider than it. The geometry is
 * deliberately tight. A first-floor window directly over a front door is
 * completely ordinary, and it is metres up, not centimetres.
 *
 * NOUNS ONLY, and this cost a real window to learn. The first version of this
 * rule also matched "above the front door", which the handoff proposing it
 * suggested — and number 14's own first-floor sash came back from the model
 * labelled "First floor window above front door". It was deleted, and the
 * count went from five to four on a house we had just fixed. "Above the front
 * door" states where a thing is; half the windows on a terrace are above the
 * front door. Only a word that names the part — fanlight, transom, overlight —
 * says what it is. The geometry below is what covers a fanlight the model
 * described only by position, and it can measure the difference that the
 * phrase cannot. */
const FANLIGHT_LABEL = /\b(fan[\s-]?light|transom|over[\s-]?light)\b/i;
const FANLIGHT_GAP_PCT = 3;
const FANLIGHT_MAX_HEIGHT_SHARE = 0.5;

function isFanlight(b, label, door) {
  if (FANLIGHT_LABEL.test(label)) return true;
  if (!door) return false;
  const gap = door.y - (b.y + b.h);          // how far its foot sits above the door's head
  if (!(gap >= -1 && gap <= FANLIGHT_GAP_PCT)) return false;
  /* Over the door rather than merely near it, and not wider than the doorway
     plus its frame. */
  const overlap = Math.min(b.x + b.w, door.x + door.w) - Math.max(b.x, door.x);
  if (!(overlap >= b.w * 0.6 && b.w <= door.w * 1.5)) return false;
  /* And SHALLOW, which is the test that makes the rest safe.

     Position alone said a ground-floor window sitting directly on top of a
     doorway was a fanlight, and on a house where the door and the window below
     the stairs line up that is an ordinary window being deleted — caught by a
     fixture in glazing.test.js doing exactly that. A fanlight is a light over
     a door, a band; number 14's real one is 29% of its door's height. Half is
     generous and still nowhere near a window. */
  return b.h <= door.h * FANLIGHT_MAX_HEIGHT_SHARE;
}

/* Where the row's roofline is, when detection gives one: the top of the
   widest fascia, gutter or soffit box. Null when there is none to read. */
function roofLineY(detections) {
  const lines = (detections || [])
    .filter(d => ['fascia', 'guttering', 'soffit'].includes(d?.type))
    .map(d => box(d))
    .filter(b => b && b.w >= 50);
  return lines.length ? Math.min(...lines.map(b => b.y)) : null;
}

/* A window in the roof, cut off by the edge of the photograph, on a terrace.

   On number 14 (28 September) the neighbour's dormer, sliced by the left
   edge at 0–8% across and wholly above the gutter line, came back as "Small
   Roof Window" and was counted as the customer's. A terrace gives no subject
   box (the roof and walls are full-width), so the only geometric fact left
   is this one: our own photograph is centred on our own house, and a roof
   window the frame cuts through at the side belongs to the house next door.

   Narrow on purpose, because dropping one of their own windows is the worse
   mistake (see isNeighbours): it must touch the left or right edge, sit
   entirely above the roofline, and only when there is no subject box. */
function neighboursRoofWindow(b, roofLine) {
  if (roofLine === null) return false;
  const atEdge = b.x <= 1 || b.x + b.w >= 99;
  return atEdge && (b.y + b.h) <= roofLine;
}

function windowCandidates(detections, aspectRatio = null) {
  const subject = subjectBox(detections || []);
  const roofLine = roofLineY(detections);
  /* Every doorway in shot, and which one is ours. Optional throughout: a
     caller with no aspect ratio gets exactly the behaviour it got before this
     rule existed. */
  const doorBoxes = (detections || [])
    .filter(d => d?.type === 'door-front')
    .map(d => box(d))
    .filter(Boolean);
  const ourDoor = (isFiniteNumber(aspectRatio) && aspectRatio > 0 && doorBoxes.length > 1)
    ? (doorReference(detections || [], aspectRatio) || {}).b || null
    : null;
  /* The doorway, for telling a fanlight from a window. Taken straight off the
     detections rather than through doorReference, because this wants where the
     door is and not whether it is fit to measure against — a door too oddly
     shaped to be a ruler still has a fanlight over it. */
  const doorD = (detections || []).find(d => d?.type === 'door-front' && box(d));
  const doorB = doorD ? box(doorD) : null;

  const confident = (detections || [])
    .filter(d => d?.type === 'window' && (Number(d?.confidence) || 0) >= MIN_CONFIDENCE);

  let sidelights = 0;
  const units = new Map();          // pane group name -> merged candidate
  const singles = [];
  let neighbours = 0;
  const notOurs = [];               // boxes judged to be another property's
  for (const d of confident) {
    const b = box(d);
    if (!b) continue;               // box() coerces and rejects the unusable
    if (isNeighbours(b, String(d?.label || ''), subject)) { neighbours++; notOurs.push(b); continue; }
    if (!subject && neighboursRoofWindow(b, roofLine)) { neighbours++; notOurs.push(b); continue; }
    /* The model's own word on whose house it is, which a subject box cannot
       know and geometry cannot see. */
    if (disowned(b, String(d?.label || ''))) { neighbours++; notOurs.push(b); continue; }
    /* And the same finding from the layout, for the runs where the model does
       not say it in words. */
    if (aboveAnotherFrontDoor(b, ourDoor, doorBoxes)) { neighbours++; notOurs.push(b); continue; }
    if (isSidelight(d)) { sidelights++; continue; }
    if (isFanlight(b, String(d?.label || ''), doorB)) { sidelights++; continue; }
    const label = String(d?.label || '');
    const c = { b, confidence: Number(d?.confidence) || 0, panes: 1, labelBay: BAY_LABEL.test(label) };
    const pane = label.match(PANE_LABEL);
    if (!pane) { singles.push(c); continue; }
    const key = pane[1].trim().toLowerCase();
    const seen = units.get(key);
    if (seen) {
      seen.b = unionBox(seen.b, c.b);
      seen.confidence = Math.max(seen.confidence, c.confidence);
      seen.panes++;
    } else {
      units.set(key, { ...c, panes: 1 });
    }
  }
  const labelMerged = [...units.values()].reduce((n, u) => n + u.panes - 1, 0);

  /* panes travels with the unit. It was dropped here, which is why a
     five-pane bay reached pricing indistinguishable from a single casement. */
  const candidates = [...singles, ...[...units.values()].map(({ b, confidence, panes }) => ({ b, confidence, panes }))]
    .sort((a, b) => (b.b.w * b.b.h) - (a.b.w * a.b.h));    // larger first, so dedupe keeps the larger

  /* Duplicates first, panes second, and the order is load-bearing.

     Two boxes over the same window overlap heavily; two panes of one bay sit
     edge to edge and barely overlap at all. Merging before deduping let the
     geometric join swallow a duplicate — the count came out right and
     `discarded.duplicates` came out zero, so the one number that says "the
     model saw double here" stopped being reported. Dedupe is about the same
     window twice; merging is about one window described in parts. */
  const deduped = [];
  let duplicates = 0;
  for (const c of candidates) {
    if (deduped.some(k => iou(k.b, c.b) > DUPLICATE_IOU)) { duplicates++; continue; }
    deduped.push(c);
  }

  /* The label rule has already run above, because when the model does say
     "Pane" it names the grouping and needs no threshold. This is geometry,
     over everything, for the runs where it does not. */
  const joined = mergeAdjacent(deduped);
  const panesMerged = labelMerged + joined.merged;

  /* A unit built from three or more panes is a bay.

     Two is deliberately not enough: a two-pane merge is as likely a double
     window or a mullioned unit, and both of those are priced as one ordinary
     window. Three is where the shape stops being explicable any other way —
     the case that prompted this was two five-pane bays reported as "2
     windows" and priced as two casements.

     A judgement, not a measurement. If it turns out to be wrong it will be
     wrong in the cheap direction: BAY_MIN_PANES is one number, and the pane
     counts it reads are now on every unit. */
  /* Or the model said so. "Upper Bay Window" as a single box is a bay just as
     surely as three panes edge to edge are; it was priced as a plain window,
     when it was priced at all. */
  for (const u of joined.list) u.isBay = (u.panes || 1) >= BAY_MIN_PANES || u.labelBay === true;
  const bays = joined.list.filter(u => u.isBay).length;

  return { kept: joined.list, duplicates, sidelights, panesMerged, neighbours, bays, notOurs };
}

/* The front-elevation count pricing will use, for the page to show. The
   summary under the photograph counted every box with "window" in its type
   or label, so it said 7 while the estimate was built on something else —
   the same number worked out twice, differently. */
function frontWindowCount(detections, aspectRatio = null) {
  return windowCandidates(detections, aspectRatio).kept.length;
}

/* How many of those units are bays.

   Reported alongside the count because the count on its own reads as wrong on
   the houses this matters for: "We found 2 windows" on a frontage with two
   five-pane bays is arithmetically right and looks like a miscount, which is
   the moment a homeowner stops trusting the figure beside it. */
/* The one figure this site publishes for a priced job.

   The cost pages read `range` and the tool read `marketRange`, so the same
   house was quoted two different ways within one click of a CTA: an
   eight-window semi at £7,054-£10,150 on the page and £7,570-£13,763 in the
   tool. Both were defensible in isolation and the pair is not.

   marketRange is the published one because it is what the product already
   shows, and because it is the spread the whole "two neighbours, thousands
   apart" argument rests on — the point of the site is what different firms
   charge for identical work, and `range` is our own estimate either side of a
   midpoint, which is a narrower claim.

   Falls back to `range` because marketRange is deliberately withheld when the
   job contains windows priced from unsourced bands. In that state the pages
   still have to publish something, and our own estimate is the honest thing to
   publish. The tool already did exactly this, in four hand-written copies of
   the same expression; this is that expression with a name. */
function publishedRange(result) {
  if (!result) return null;
  return result.marketRange || result.range || null;
}

/* The window boxes this photograph contains that are NOT this customer's.
 *
 * The count has always worked this out and thrown it away. The render needs
 * it: a segmentation mask of "window" finds every window in the frame, next
 * door's included, so a windows-only render recolours the neighbour's frames
 * and the mask faithfully protects the result. Measured on number 14, live on
 * 28 September — the sash above number 12's door came back anthracite.
 *
 * Same judgement as the count, deliberately. If a window is not theirs to be
 * charged for it is not theirs to be repainted, and the two answers should
 * never be able to disagree. */
/* The counted windows as boxes, one per unit, for the page to point at.
 *
 * The homeowner is asked "we counted 5 windows at the front — is that right?"
 * and, until now, given nineteen identical rectangles to check it against:
 * the roof, the fascia, the guttering and every pane of a bay all drawn the
 * same way. A question you cannot check is a button people press to get past.
 *
 * These are the merged UNITS, not the raw detections — a five-pane bay is one
 * box here because it is one window in the count and one window on the
 * invoice. That is exactly why the page cannot work them out for itself: the
 * merging, the sidelights, the fanlight and whose house it is all live here,
 * and a second implementation on the client would drift from this one within
 * the week. Same call as frontWindowCount: one answer, read in several
 * places.
 *
 * Rounded, because these are for placing a dot on a photograph. */
function frontWindowBoxes(detections, aspectRatio = null) {
  const r1 = (n) => Math.round(n * 10) / 10;
  return windowCandidates(detections, aspectRatio).kept.map(u => ({
    x: r1(u.b.x), y: r1(u.b.y), w: r1(u.b.w), h: r1(u.b.h),
    isBay: !!u.isBay, panes: u.panes || 1,
  }));
}

function neighbourWindowBoxes(detections, aspectRatio = null) {
  return windowCandidates(detections, aspectRatio).notOurs;
}

function frontBayCount(detections, aspectRatio = null) {
  return windowCandidates(detections, aspectRatio).bays;
}

function measureWindows({ detections, aspectRatio, bands }) {
  if (!isFiniteNumber(aspectRatio) || aspectRatio <= 0) return null;
  const door = doorReference(detections, aspectRatio);
  if (!door) return null;

  const { kept, duplicates, sidelights, neighbours, panesMerged } = windowCandidates(detections, aspectRatio);

  const doorTop = door.b.y;
  const windows = [];
  let implausible = 0;

  for (const c of kept) {
    const size = sizeWindow(c.b, door.b.h, aspectRatio);
    const maxH = c.isBay ? MAX_BAY_H_M : MAX_WINDOW_H_M;
    if (size.widthM < MIN_WINDOW_W_M || size.heightM < MIN_WINDOW_H_M ||
        size.widthM > MAX_WINDOW_W_M || size.heightM > maxH) {
      implausible++;
      continue;
    }
    let heightAssumed = false;
    if (c.isBay && size.heightM > BAY_GLAZED_H_M) {
      size.heightM = BAY_GLAZED_H_M;
      size.areaM2 = size.widthM * BAY_GLAZED_H_M;
      heightAssumed = true;
    }
    const band = bandFor(size.areaM2, bands);
    windows.push({
      widthM: Number(size.widthM.toFixed(2)),
      heightM: Number(size.heightM.toFixed(2)),
      areaM2: Number(size.areaM2.toFixed(2)),
      bandId: band.id,
      bandLabel: band.label,
      // Entirely above the door's top edge: upper storey, needs access.
      upperStorey: (c.b.y + c.b.h) <= (doorTop + UPPER_STOREY_TOLERANCE_PCT),
      confidence: c.confidence,
      /* Priced as a bay because it is one, not because a style was picked. */
      isBay: !!c.isBay,
      panes: c.panes || 1,
      heightAssumed,
    });
  }

  if (windows.length < MIN_WINDOWS || windows.length > MAX_WINDOWS) return null;

  return {
    method: 'door',
    windows,
    frontCount: windows.length,
    /* Every way a window can leave this function, not just the two that
       happened to be wired up.

       windowCandidates has counted sidelights and neighbours since the day
       each rule was written, and both were dropped on the floor here. So the
       two rules that delete a window outright — a label matching "sidelight",
       and a label matching "adjacent" on a photograph where subjectBox
       returned null, which is most of them — were the only two whose effect
       nothing could see. Diagnosing a missing window on 28 September meant
       instrumenting this file by hand to rule them out, which is the tell.

       panesMerged is here for the same reason: a merge is not a discard, but
       it is the other way the number on screen ends up below the number of
       boxes the model returned, and anyone asking "why is this 5 when I can
       see 6" needs both halves of the answer. */
    discarded: { duplicates, implausible, sidelights, neighbours, panesMerged },
    doorHeightPct: door.b.h,
    doorConfidence: door.confidence,
  };
}

/* ── METHOD 2: house-type prior ──
   No door to scale against, or the detections were rejected. Build a notional
   front elevation from the prior's mix so the rest of the pipeline is
   identical — one code path for pricing, whatever produced the counts. */
/* Windows we counted but could not size.

   The count is real — these are windows detected on the photograph. The sizes
   are not: with no door there is no scale, so each one is given the typical
   band for the house type rather than a measured area. That is a genuinely
   better answer than the prior, which invents the count as well, and a
   genuinely weaker one than a measurement, which is why it reports its own
   method rather than borrowing either name.

   Upper storey is taken from the geometry, which needs no scale: a window in
   the top half of the frame is upstairs. That decides the access charge, and
   it is the one thing a scaleless photograph still tells us plainly. */
function countWindows({ detections, houseType, bands }) {
  const key = houseTypeKey(houseType);

  /* The same hygiene the measured path applies. Its own filter used
     Number.isFinite on the raw fields, which rejects "20" — a string an LLM
     emits often enough — so the whole counting path silently failed to fire
     and fell through to the prior. It also read y_pct without checking it, so
     a detection missing it gave undefined + h/2 = NaN, NaN < 50 is false,
     every window was ground floor, and the scaffolding charge quietly vanished
     on a two-storey house. box() coerces and rejects; nothing here reads a raw
     field any more. */
  const { kept } = windowCandidates(detections);
  if (!kept.length) return null;

  /* The commonest band for this house type — what a typical window here is,
     since we cannot tell what these ones are. */
  const prior = HOUSE_TYPE_GLAZING_PRIORS[key];
  const commonestId = Object.entries(prior.mix).sort((a, b) => b[1] - a[1])[0][0];
  const band = bands.find(b => b.id === commonestId) || bands[0];

  /* No door means no ground-level datum, so "upstairs" is the top half of the
     frame rather than "above the door". Cruder, and the only thing a scaleless
     photograph still says plainly — which is what keeps the access charge
     alive without a scale reference. */
  const windows = kept.map(c => ({
    widthM: null, heightM: null, areaM2: null,
    bandId: band.id, bandLabel: band.label,
    upperStorey: (c.b.y + c.b.h / 2) < 50,
    confidence: c.confidence,
    isBay: !!c.isBay,
    panes: c.panes || 1,
  }));

  return { method: 'count', frontCount: windows.length, windows };
}

function priorWindows({ houseType, bands }) {
  const key = houseTypeKey(houseType);
  const prior = HOUSE_TYPE_GLAZING_PRIORS[key];
  const windows = [];
  for (const [bandId, count] of Object.entries(prior.mix)) {
    const band = bands.find(b => b.id === bandId) || bands[0];
    for (let i = 0; i < count; i++) {
      windows.push({
        widthM: null, heightM: null, areaM2: null,
        bandId: band.id, bandLabel: band.label,
        upperStorey: false,          // decided below, across the whole house
        confidence: null,
      });
    }
  }
  /* Half of a typical house's glazing is upstairs. This used to alternate
     within each band, which meant a mix of {1, 5, 2} produced three out of
     eight rather than four — the comment said half and the code said 37%. It
     doesn't move the price, since access is a threshold rather than a count,
     but upperStoreyCount is shown to the homeowner. A bungalow keeps none. */
  const singleStorey = key === 'bungalow';
  const upstairs = singleStorey ? 0 : Math.round(windows.length / 2);
  for (let i = 0; i < upstairs; i++) windows[windows.length - 1 - i].upperStorey = true;

  return { method: 'prior', windows, frontCount: windows.length, discarded: null };
}

/* ── PRICING ──
   Rates come from catalogue.glazing. Nothing here invents a number, and a
   missing rate throws rather than silently defaulting to zero — a glazing
   quote that quietly omits a line is worse than no quote. */
/* How many opening lights, and what they cost.

   A window with none and the same window with two are a x2.37 difference —
   £570 against £1,348 once the discount is applied — so one band price is
   wrong in both directions at once. Ours was 49% dear against a fixed pane
   and 37% cheap against one with two openers, and the average was right for
   almost nobody.

   A photograph cannot supply this. A fixed light and a top-opener look the
   same from the pavement, and guessing would put a number the homeowner acts
   on behind an inference the picture does not support. So the product asks,
   and when it is not answered the band price stands as the typical case.

   The band prices are treated as the one-opener price because that is the
   common window. Zero subtracts one opener, three adds two. */
function openerAdjustment(rates, windows, openerCount) {
  const cost = Number(rates?.openerCost);
  const typical = Number(rates?.typicalOpeners ?? 1);
  if (!Number.isFinite(cost) || cost <= 0) return 0;
  if (openerCount === undefined || openerCount === null) return 0;
  const n = Number(openerCount);
  /* Nought to six. Above that it is a curtain wall, not a window, and a
     number somebody mistyped should not multiply into the estimate. */
  if (!Number.isFinite(n) || n < 0 || n > 6) return 0;
  const units = windows.reduce((t, w) => t + (w.count || 1), 0);
  return (n - typical) * cost * units;
}

function priceGlazing({ windows, totalCount, selections, rates, houseType , openerCount }) {
  // Unreachable through estimateGlazing, which enforces a minimum — but this
  // is exported, and dividing by zero here turns every money field into NaN
  // quietly rather than loudly.
  if (!windows.length) throw new Error('priceGlazing needs at least one window.');

  /* Somebody who wants a front door and nothing else.

     Choosing a door used to price every window in the house as well, because a
     missing window style fell through to a multiplier of 1 rather than meaning
     anything. A composite door — £1,667 of work — came back as £7,451–£13,837,
     most of it eight windows nobody had mentioned. `'none'` is how a caller
     says the windows are staying. */
  const windowsIncluded = selections.windowStyleId !== 'none';

  const styleMult = rates.styleMultipliers?.[selections.windowStyleId] ?? 1;
  const isBay = selections.windowStyleId === 'bay';
  const colourMult = selections.windowDoorColourId && selections.windowDoorColourId !== 'white'
    ? (rates.nonWhiteUplift ?? 1)
    : 1;
  /* Georgian bars: windows only. A front door with a grid is a different
     product, priced as a door; this multiplies the window units and nothing
     else. The figure is ours, not a supplier's — see georgianBarNote. */
  const barsMult = selections.windowBarsId === 'georgian' ? (rates.georgianBarUplift ?? 1) : 1;
  /* Frame material, windows only (29 September). uPVC is the base every band
     price is in; aluminium is Mike's figure of 25% more for the same window.
     Where a material's colour is part of its price (powder-coated aluminium),
     the non-white uplift is not charged again on top of it. Unknown or absent
     means uPVC, so every existing estimate is unchanged. */
  const material = (rates.materials || []).find(m => m.id === selections.windowMaterialId) || null;
  const materialMult = material?.multiplier ?? 1;
  const windowColourMult = material?.colourIncluded ? 1 : colourMult;

  /* The windows we have describe the front elevation. The ones we have not
     seen are priced at the house type's typical mix, not as copies of the
     front.

     This used to scale every front window by totalCount / front. That copied
     the front's most distinctive window onto walls nobody photographed: a
     detached house with one bay and two upstairs windows was priced as three
     bays and six large windows, £15,243 – £27,715, when bays are almost
     always a front-elevation feature. The unseen windows are, by definition,
     the ones we know least about, so they get the typical figure the prior
     already holds for this house type — the same mix the cost pages price.

     The COUNT is unchanged: frontToTotal still decides how many there are
     (notes/window-count-and-scaling.md — do not retune it). Only what the
     unseen ones are assumed to be has moved.

     If the homeowner says there are fewer windows than we saw, the front is
     scaled down as before; there are no unseen windows to add. */
  const frontScale = totalCount < windows.length ? totalCount / windows.length : 1;
  const unseen = Math.max(0, totalCount - windows.length);
  const priorMix = (HOUSE_TYPE_GLAZING_PRIORS[houseTypeKey(houseType)] || HOUSE_TYPE_GLAZING_PRIORS[DEFAULT_HOUSE_TYPE]).mix;
  const priorTotal = Object.values(priorMix).reduce((a, n) => a + n, 0);
  const unseenWindows = unseen > 0
    ? Object.entries(priorMix).filter(([, n]) => n > 0).map(([bandId, n]) => ({
        bandId,
        weight: unseen * n / priorTotal,
        isBay: false,
        // Half upstairs, as priorWindows assumes; none on a bungalow.
        upperShare: houseTypeKey(houseType) === 'bungalow' ? 0 : 0.5,
      }))
    : [];

  let supplyFit = 0;
  let upperStoreyCount = 0;
  const byBand = {};

  if (windowsIncluded) {
    const priced = [
      ...windows.map(w => ({ ...w, weight: frontScale, upperShare: w.upperStorey ? 1 : 0 })),
      ...unseenWindows,
    ];
    for (const w of priced) {
      const scale = w.weight;
      const band = rates.windowBands.find(b => b.id === w.bandId);
      if (!band) throw new Error(`No rate for window band "${w.bandId}" in catalogue.glazing.`);
      /* The uplift follows the window, not only the dropdown.

         isBay was true for every window whenever the visitor picked the Bay
         style, and false for a real bay whenever they picked anything else.
         Both directions were wrong: choosing Bay uplifted eight ordinary
         windows, and a house with two five-pane bays priced them as two plain
         casements unless the visitor happened to select Bay.

         Either reason is enough — a unit detected as a bay, or a bay
         explicitly asked for. */
      const bayHere = w.isBay || isBay;
      const unit = band.supplyFit * styleMult * windowColourMult * barsMult * materialMult * (bayHere ? (rates.bayUplift ?? 1) : 1);
      supplyFit += unit * scale;
      upperStoreyCount += scale * w.upperShare;
      byBand[w.bandId] = (byBand[w.bandId] || 0) + scale;
    }
  }

  /* Largest remainder, because rounding each band on its own does not add up.
     Three front windows scaled to eight is 2.67 a band, which rounds to three
     three times: a panel headed "8 windows" above a breakdown summing to 9
     reads as a bug even when the money is right. */
  const bandKeys = Object.keys(byBand);
  const floors = bandKeys.map(k => Math.floor(byBand[k]));
  let remaining = totalCount - floors.reduce((a, n) => a + n, 0);
  const byRemainder = bandKeys
    .map((k, i) => ({ k, i, rem: byBand[k] - floors[i] }))
    .sort((a, b) => b.rem - a.rem);
  for (const { i } of byRemainder) {
    if (remaining <= 0) break;
    floors[i]++; remaining--;
  }
  bandKeys.forEach((k, i) => { byBand[k] = floors[i]; });

  // Doors are priced per leaf from the catalogue, not per m² — the reason
  // they were never in the cladding engine in the first place.
  let doors = 0;
  /* `'none'` on the door side means the same as it does everywhere else: not
     this trade. Without the filter it reached the catalogue lookup and threw
     `No rate for door "none"`, so the moment the UI could offer the option the
     endpoint would have 500'd on it. */
  const doorSelections = [selections.doorStyleId].filter(id => id && id !== 'none');
  for (const id of doorSelections) {
    const d = rates.doors?.find(x => x.id === id);
    if (!d) throw new Error(`No rate for door "${id}" in catalogue.glazing.`);
    doors += d.supplyFit * colourMult;
  }

  /* Access. Any upstairs window means a tower or a scaffold, and it is the
     line homeowners are most often ambushed by — the same reasoning that put
     scaffolding into the cladding estimate from the start. */
  const access = upperStoreyCount >= 1 ? (rates.accessCost ?? 0) : 0;

  /* No waste allowance. Glazing is made to measure: there are no offcuts.
     Disposal of the old frames is a separate, per-unit line — and only for
     frames actually coming out. A door-only job disposes of one door, not of
     one door and every window in the house. */
  const disposalUnits = (windowsIncluded ? Math.round(totalCount) : 0) + doorSelections.length;
  const disposal = (rates.disposalPerUnit ?? 0) * disposalUnits;

  /* Opening lights, if the homeowner told us. Scaled to the whole-house count
     the same way supplyFit is, because the answer describes their windows
     rather than the four visible in the photograph. Nothing to adjust when the
     windows are staying put. */
  const openers = windowsIncluded
    ? openerAdjustment(rates, [{ count: Math.round(totalCount) }], openerCount)
    : 0;

  let net = supplyFit + doors + access + disposal + openers;

  /* Nothing chosen is not a job, and the minimum job charge must not invent
     one. With the windows left alone and no door, every line above is zero —
     and applying a £950 floor to that would quote somebody for declining. */
  const nothingChosen = !windowsIncluded && doorSelections.length === 0;

  // A minimum job charge, because two windows do not cost two-elevenths of
  // eleven windows — the van, the survey and the day are the same.
  const minimum = rates.minJobCharge ?? 0;
  const minimumApplied = !nothingChosen && net < minimum;
  if (minimumApplied) net = minimum;

  /* Replacement windows and doors in an existing dwelling are standard-rated.
     The energy-saving materials relief does not cover them. Shown separately,
     never folded into the headline, exactly as the cladding estimate does. */
  const vat = net * ((rates.vatPct ?? 20) / 100);

  return {
    supplyFit: round(supplyFit),
    openers: round(openers),
    doors: round(doors),
    access: round(access),
    disposal: round(disposal),
    vat: round(vat),
    total: round(net + vat),
    minimumApplied,
    upperStoreyCount: Math.round(upperStoreyCount),
    byBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) => [k, Math.round(v)])),
    /* So callers can say what the figure covers. The total bar reads
       "8 windows · 1 door" off the window count, which would be a lie on a
       door-only job — the count is still known, it is just not being priced. */
    windowsIncluded,
  };
}

/* ── PUBLIC ENTRY POINT ──

   {
     detections,          // as returned by /api/detect
     aspectRatio,         // from the image bytes, server-side, never the client
     houseType,           // 'semi' etc — used for the front→whole-house scale
     selections,          // { windowStyleId, doorStyleId, windowDoorColourId, windowBarsId }
     rates,               // catalogue.glazing
     windowCountOverride, // the homeowner corrected the count by hand
     seenOnly,            // price the front the photo shows, not front × a multiplier
     backCount,           // windows at the back and sides, as the homeowner told us
   }

   Always returns an object. There is no failure mode that produces nothing:
   worst case it falls back to the prior and says so, because a homeowner who
   uploaded a photo of their house should never be told the tool has no
   opinion about it. */
function estimateGlazing({
  openerCount,
  detections = [],
  aspectRatio,
  houseType,
  selections = {},
  rates,
  windowCountOverride = null,
  /* The homeowner correcting the FRONT count, which is not the same thing as
     windowCountOverride.

     windowCountOverride replaces the whole-house total and marks the reading
     manual_entry — which is right for the old whole-house flow and wrong
     here: it discards the front/back split, so the page falls back to a
     single number and the back count they gave us is lost.

     This corrects only what the photograph claimed to see, and leaves
     everything downstream — the back count, the seenOnly labelling, the
     per-elevation wording — intact. */
  frontCountOverride = null,
  seenOnly = false,
  backCount = null,
} = {}) {
  if (!rates || !Array.isArray(rates.windowBands) || !rates.windowBands.length) {
    throw new Error('estimateGlazing needs catalogue.glazing with windowBands.');
  }

  const key = houseTypeKey(houseType);
  const bands = rates.windowBands;

  const measured = measureWindows({ detections, aspectRatio, bands });

  /* Counting and measuring are two different questions, and this used to
     answer neither when it could not answer both.

     The front door is the scale reference — 1.98 m, which is what turns
     percentages of an image into metres. Without one in shot there is no way
     to size a window. But there is still a perfectly good way to *count* them,
     which is to count them, and that does not need a scale at all.

     What happened instead: a photograph with seven clearly detected windows
     and no door fell straight through to the house-type prior and priced
     eleven — the tool discarded seven things it had seen in favour of a
     number it made up, then displayed both on the same screen. A homeowner
     looking at seven labelled windows on a photograph of their own house was
     told the estimate covered eleven typical ones. On a real photograph that
     was the difference between £10,050–£18,272 and £18,438–£33,523.

     So: measure if there is a door, count if there is not, and only fall back
     to the prior when the photograph shows no windows at all. The three cases
     report different countSource values and the page says which one it used —
     "counted" is a weaker claim than "measured" and must never be dressed up
     as it. */
  const counted = (!measured && detections.some(d => d.type === 'window'))
    ? countWindows({ detections, houseType: key, bands })
    : null;

  const baseRead = measured || counted || priorWindows({ houseType: key, bands });

  /* Their correction to the front, applied before anything is scaled or
     added to, so the back count and the labelling behave exactly as they
     would have if the photograph had read this number in the first place.

     Bounded like every other typed figure: there is no honest client that
     sends four hundred front windows, and answering with thirty would dress
     a tampered request up as a real one. Out of band falls back rather than
     clamping, and says so. */
  /* Number(null) is 0, and "not corrected" must not become "no windows at the
     front" — the same trap backCount documents thirty lines down, walked into
     once here already: without this guard every uncorrected estimate priced a
     frontage of zero. */
  const frontGiven = frontCountOverride !== null && frontCountOverride !== undefined && frontCountOverride !== '';
  const frontTyped = frontGiven ? Number(frontCountOverride) : NaN;
  const frontTypedOk = Number.isFinite(frontTyped) && frontTyped >= 0 && frontTyped <= MAX_WINDOWS;
  if (frontGiven && Number.isFinite(frontTyped) && !frontTypedOk) {
    console.warn(`Ignoring an implausible front window count of ${frontTyped} — outside 0-${MAX_WINDOWS}.`);
  }
  const base = (frontTypedOk && (baseRead.method === 'door' || baseRead.method === 'count'))
    ? { ...baseRead, frontCount: frontTyped, frontTold: true }
    : baseRead;

  const frontToTotal = rates.frontToTotal?.[key] ?? FRONT_TO_TOTAL_WINDOWS[key];

  /* Both photo-derived counts describe the front elevation and need scaling to
     the whole house. The prior is already a whole-house figure.

     Unless the page asks for what was seen (seenOnly). Then the photograph
     prices the front it shows, and the back and sides are either the number
     the homeowner gave us or not priced at all, and the response says which.
     The front × 2.6 multiplier was never checked against a survey, and a
     rear window nobody has seen is not something to put a price on. */
  const fromPhoto = base.method === 'door' || base.method === 'count';
  const back = Number(backCount);
  // Number(null) is 0, and "not told" must not become "none at the back".
  const backGiven = backCount !== null && backCount !== undefined && backCount !== '';
  const backKnown = backGiven && Number.isFinite(back) && back >= 0 && back <= MAX_WINDOWS;
  const frontOnly = seenOnly && fromPhoto;
  let totalCount = frontOnly
    ? base.frontCount + (backKnown ? back : 0)
    : fromPhoto
      ? base.frontCount * frontToTotal
      : base.frontCount;

  let countSource = base.method === 'door' ? 'photo_door'
    : base.method === 'count' ? 'photo_count'
    : 'house_type_prior';

  /* A photo that cuts off a side of the house can only undercount the front.

     Walked live on 24 September: a close crop of a bay-fronted semi showed
     the two bays and nothing either side. Two front windows scaled to five
     for the whole house, so the price fell from the "typical semi, 8 windows"
     the customer had just been shown to less than that — for a house that
     plainly has more. Detection already says when a side is out of shot
     ("cut-off", the same evidence houseTypeFromEvidence reads), and then
     the count is a floor, not a total: never price fewer windows than the
     typical house of that type. With both sides in shot the count stands,
     small houses included. A typed number still beats both. */
  const analysis = detections.find(d => d?.type === 'analysis');
  const sideCutOff = ['left', 'right'].some(side => String(analysis?.sides?.[side] || '').toLowerCase() === 'cut-off');
  const typicalCount = (HOUSE_TYPE_GLAZING_PRIORS[key] || HOUSE_TYPE_GLAZING_PRIORS[DEFAULT_HOUSE_TYPE]).windows;
  let raisedToTypical = false;
  if (!frontOnly && sideCutOff && fromPhoto && totalCount < typicalCount) {
    totalCount = typicalCount;
    raisedToTypical = true;
  }

  /* A typed count beats everything, and is bounded for the same reason the
     manual wall area is: there is no honest client that sends 400 windows,
     so answering with 30 would dress a tampered request up as a real one. */
  const manual = Number(windowCountOverride);
  if (Number.isFinite(manual) && manual >= MIN_WINDOWS && manual <= MAX_WINDOWS) {
    totalCount = manual;
    countSource = 'manual_entry';
    raisedToTypical = false;
  } else if (Number.isFinite(manual) && manual > 0) {
    // Out of band: fall back rather than clamp, and say so in the log.
    console.warn(`Ignoring an implausible window count of ${manual} — outside ${MIN_WINDOWS}–${MAX_WINDOWS}.`);
  }

  /* Say when we have capped it.

     A detached house with eleven detected front windows scales to
     thirty-three and was silently becoming thirty — a ten per cent undercount
     on the largest quote the tool produces, presented as a measured figure
     when it is a boundary. That is the same objection this module makes to
     clamping a manual count fifteen lines above, and the same one
     computePrice makes about dressing a tampered request up as a real one.

     Falling back is not available here: it is our own arithmetic that
     overflowed, not a client's claim. So it is capped, and it says so, and it
     asks the one person who can settle it. */
  const wanted = Math.round(totalCount);
  totalCount = Math.round(clamp(totalCount, MIN_WINDOWS, MAX_WINDOWS));
  const countCapped = countSource !== 'manual_entry' && wanted > MAX_WINDOWS;
  if (countCapped) {
    console.warn(`Capped a window count of ${wanted} at ${MAX_WINDOWS} for a ${key}.`);
  }

  const price = priceGlazing({
    windows: base.windows,
    totalCount,
    selections,
    rates,
    houseType: key,
    openerCount,
  });

  const spread = countSource === 'manual_entry'
    ? UNCERTAINTY.door
    : UNCERTAINTY[base.method === 'door' ? 'door' : base.method === 'count' ? 'count' : 'prior'];

  return {
    countSource,
    openerCount: (openerCount === undefined || openerCount === null) ? null : Number(openerCount),
    houseType: key,
    windowCount: totalCount,
    countCapped,
    raisedToTypical,
    countNote: countCapped
      ? `We've capped this at ${MAX_WINDOWS} windows. If your home has more, tell us the number and we'll price it properly.`
      : null,
    frontCount: (base.method === 'door' || base.method === 'count') ? base.frontCount : null,
    /* Whether the front number is the photograph's or theirs. The lead needs
       it for the same reason backCountSource exists. */
    frontTold: base.frontTold === true,
    /* Bays measured across but not up: their boxes include the stonework. */
    bayHeightsAssumed: base.method === 'door' ? (base.windows || []).filter(w => w.heightAssumed).length : 0,
    frontToTotal: (fromPhoto && !frontOnly) ? frontToTotal : null,
    /* Only meaningful when the page asked for seenOnly and the count came from
       the photo: how many at the back and sides we priced (null = none, not
       priced yet), and whether the front was cut off at a side. */
    seenOnly: frontOnly,
    backCount: frontOnly && countSource !== 'manual_entry' ? (backKnown ? back : null) : null,
    frontCutOff: frontOnly ? sideCutOff : false,
    windows: base.windows,
    discarded: base.discarded,
    price,
    range: {
      low: round(price.total * (1 - spread)),
      high: round(price.total * (1 + spread)),
    },
    /* Taken off the middle rather than off the ends of `range`, so this
       answers "what would somebody else charge for this job" and not "what
       would somebody else charge for the largest job this might be". The
       second question compounds two uncertainties and produces a number
       nobody should act on.

       And withheld entirely while the windows in it are priced from invented
       bands, which is the state today.

       The multiple is sound: 0.88x to 2.0x, derived from two door products
       against two national installers, and the doors it came from are real
       settled prices. What is not sound is the number it multiplies.
       notes/glazing-rates-from-the-trade.md puts the window bands at roughly
       40% light even after the 20% uplift — it does the arithmetic itself,
       0.5 x 1.2 = 0.6 — so on a semi with eight casements the panel reads:

         Our estimate       £6,021 – £11,183
         Quoted elsewhere   £7,570 – £17,204

       and the second line, which the page invites the homeowner to read as
       the unfair price, is approximately the correct one. The mechanism
       inverts. Somebody is told they are being overcharged by a quote that is
       accurate, goes to the installer expecting £8,600, is quoted £14,000,
       and concludes we were wrong — and the installer, who paid for that
       lead, opens the conversation arguing about our number instead of
       selling.

       So: shown when the priced job is doors only, where every figure came
       from a completed job, and withheld the moment an unsourced window is in
       it. Restored automatically by the four real band prices landing in the
       catalogue, because that is what clears `source`. */
    marketRange: marketRangeFor(rates, price),
    /* What the same job costs from the same installer if nobody negotiates.
       Null whenever the comparison itself is withheld, so the two can never
       disagree about whether the base is trustworthy. */
    noHaggle: marketRangeFor(rates, price) ? round(price.total * NO_HAGGLE) : null,
    // What the UI should say about where this number came from. Keep the
    // wording here so the page and the lead email can never disagree.
    sourceLabel: {
      photo_door: 'measured from your photo',
      /* Deliberately not "measured". We counted the windows on the
         photograph, which is real, and assumed their sizes, which is not —
         and the difference is the whole reason there are three of these. */
      photo_count: 'counted from your photo, at typical sizes',
      house_type_prior: 'a typical figure for your house type',
      manual_entry: 'the number of windows you entered',
    }[countSource],
  };
}

/* What an installer is quoting against, part by part, in words.

   The lead carries counts and a range. Neither says which windows were
   measured and which are a typical size for the house type, and an installer
   who quotes a typical size as if it were measured finds out on survey, in
   front of the homeowner. Mike's rule: if we saw it, say so; if we did not,
   do not pretend; if it is an assumption, label it.

   Pure, so it can be tested, and derived server-side from the re-priced
   estimate rather than from anything the client says about itself — except
   where the back count came from, which only the page knows, and which
   server.js already reduces to 'photo', 'told' or 'not priced'. */
function windowBasis(summary, { backCountSource = null, backPhotoCount = null, sideCount = null } = {}) {
  if (!summary) return null;
  const w = (n) => `${n} window${n === 1 ? '' : 's'}`;
  const lines = [];
  const fromPhoto = summary.countSource === 'photo_door' || summary.countSource === 'photo_count';
  const front = Number(summary.frontCount);

  if (!fromPhoto || !Number.isFinite(front)) {
    const n = Number(summary.windowCount);
    lines.push(`${Number.isFinite(n) ? w(n) : 'Windows'} in all: typical for the house type. Not counted or measured from a photo.`);
    return { front: { counted: 'estimated', sizes: 'typical' }, back: null, sides: 'not seen', lines };
  }

  const frontSizes = summary.countSource === 'photo_door' ? 'measured' : 'typical';
  const frontCounted = summary.frontTold ? 'told' : 'photo';
  lines.push(`Front: ${w(front)}, ${frontCounted === 'told' ? 'number corrected by the homeowner' : 'counted from the photo'}. ` +
    (frontSizes === 'measured'
      ? (frontCounted === 'told' ? 'Sizes measured from the photo where seen, typical for any others.' : 'Sizes measured from the photo, using the front door for scale.') +
        (summary.bayHeightsAssumed > 0 ? ` Bay width${summary.bayHeightsAssumed === 1 ? '' : 's'} measured; height${summary.bayHeightsAssumed === 1 ? '' : 's'} typical (the photo can't separate a bay's glass from its stonework).` : '')
      : 'Sizes typical, not measured (no front door in shot to measure from).'));

  if (!summary.seenOnly) {
    const rest = Number(summary.windowCount) - front;
    if (rest > 0) lines.push(`Back and sides: ${w(rest)} assumed for the house type. Not seen.`);
    return { front: { counted: frontCounted, sizes: frontSizes }, back: { counted: 'estimated', sizes: 'typical' }, sides: 'not seen', lines };
  }

  const back = Number(summary.backCount);
  if (backCountSource === 'not priced' || summary.backCount === null || summary.backCount === undefined) {
    lines.push('Back and sides: not priced. The homeowner did not say how many.');
    return { front: { counted: frontCounted, sizes: frontSizes }, back: null, sides: 'not priced', lines };
  }
  if (backCountSource === 'photo') {
    /* Side windows the homeowner told us about are inside backCount; the back
       on its own is what is left. null means they were not asked or did not
       answer, which is not the same as none. */
    const sides = sideCount !== null && sideCount !== undefined && Number.isFinite(Number(sideCount))
      ? Math.min(Number(sideCount), back) : null;
    const backAlone = back - (sides || 0);
    const seen = Number.isFinite(Number(backPhotoCount)) && backPhotoCount !== null ? Number(backPhotoCount) : backAlone;
    const extra = backAlone - seen;
    lines.push(`Back: ${w(backAlone)}, ` +
      (extra > 0 ? `${seen} counted from a photo of the back plus ${extra} added by the homeowner`
        : extra < 0 ? `${seen} counted from a photo of the back, less ${-extra} the homeowner took off`
        : 'counted from a photo of the back') +
      (backAlone > 0 ? '. Sizes typical, not measured.' : '.'));
    lines.push(sides > 0
      ? `Sides: ${w(sides)}, number given by the homeowner (not in either photo). Sizes typical, not measured.`
      : sides === 0
        ? 'Sides: none, as the homeowner told us (not in either photo).'
        : extra > 0
          ? 'Sides: not in either photo. Any side windows are among the ones the homeowner added.'
          : 'Sides: not in either photo, and not priced.');
    return {
      front: { counted: frontCounted, sizes: frontSizes },
      back: { counted: 'photo', sizes: 'typical', photoCount: seen },
      sides: sides > 0 ? 'told' : sides === 0 ? 'none' : extra > 0 ? 'added by homeowner' : 'not priced',
      sideCount: sides,
      lines,
    };
  }
  lines.push(back === 0
    ? 'Back and sides: none, as the homeowner told us.'
    : `Back and sides: ${w(back)}, number given by the homeowner. Sizes typical, not measured.`);
  return { front: { counted: frontCounted, sizes: frontSizes }, back: { counted: 'told', sizes: 'typical' }, sides: 'in homeowner count', lines };
}

module.exports = {
  estimateGlazing,
  windowBasis,
  frontWindowCount,
  frontBayCount,
  neighbourWindowBoxes,
  frontWindowBoxes,
  publishedRange,
  resolveHouseType,
  houseTypeFromEvidence,
  isSidelight,
  // Exposed for tests and for scripts/validate-*, not for server.js.
  _internals: {
    sizeWindow, bandFor, measureWindows, priorWindows, priceGlazing,
    doorReference, iou, houseTypeKey, windowCandidates,
  },
  HOUSE_TYPE_GLAZING_PRIORS,
  FRONT_TO_TOTAL_WINDOWS,
  MARKET_SPREAD,
  INSTALLER_SPREAD,
  NO_HAGGLE,
  MIN_WINDOWS,
  MAX_WINDOWS,
};
