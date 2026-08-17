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

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);
const round = (n) => Math.round(n);

/* Same contract as measure.js's box(): percentages in, null for anything
   malformed, so NaN never reaches the arithmetic. Duplicated rather than
   imported because measure.js does not export it and this module is not
   worth widening that surface for. */
function box(d) {
  const x = Number(d?.x_pct), y = Number(d?.y_pct), w = Number(d?.w_pct), h = Number(d?.h_pct);
  if (![x, y, w, h].every(isFiniteNumber)) return null;
  if (w <= 0 || h <= 0) return null;
  return {
    x: clamp(x, 0, 100), y: clamp(y, 0, 100),
    w: clamp(w, 0, 100), h: clamp(h, 0, 100),
  };
}

function iou(a, b) {
  const w = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
  const h = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const inter = w * h;
  if (inter <= 0) return 0;
  return inter / (a.w * a.h + b.w * b.h - inter);
}

/* A UK door leaf is 1.98 m by about 0.84 m — call it 2.36 tall for every one
   across. Everything on the house is measured against it. */
const DOOR_LEAF_RATIO = 1.98 / 0.838;

/* The real proportions of a box, from percentages of a frame that is not
   square: heights are percentages of the frame height and widths percentages
   of its width, so the aspect ratio has to come back out before two of them
   can be compared. */
const shapeRatio = (b, aspectRatio) =>
  (b && b.w > 0 && isFiniteNumber(aspectRatio) && aspectRatio > 0)
    ? (b.h / b.w) / aspectRatio
    : null;

/* Which box is the door, when more than one thing claims to be.

   This took the tallest, which is the wrong instinct the moment a fanlight is
   involved: a Victorian doorway offered as door-leaf and as door-plus-fanlight
   would always have been read as the taller of the two. The scale is 1.98 m
   divided by that height, so a box 29% too tall makes every window 22% too
   small and — because wall area goes as the square — the walls 40% too small.
   Measured on a synthetic terrace: 77 m² read as 46 m², and a quote of
   £10,217–£14,703 read as £7,347–£10,573, with nothing to say it had happened.

   So: prefer the most door-shaped box rather than the biggest one. Where only
   one is offered this changes nothing, which is why the detection prompt now
   says to box the leaf alone — this is the second line of defence, not the
   first. */
function doorReference(detections, aspectRatio) {
  const doors = detections
    .filter(d => d?.type === 'door-front')
    .map(d => ({ b: box(d), confidence: Number(d?.confidence) || 0 }))
    .filter(d => d.b && d.b.h >= 2);   // implausibly small box — reject rather than divide by it
  if (!doors.length) return null;

  const scored = doors.map(d => {
    const r = shapeRatio(d.b, aspectRatio);
    return { ...d, ratio: r, off: r === null ? Infinity : Math.abs(r - DOOR_LEAF_RATIO) };
  });
  /* Falls back to the old behaviour when the frame shape is unknown, so a
     caller without an aspect ratio is no worse off than before. */
  if (scored.every(d => d.off === Infinity)) return doors.sort((a, b) => b.b.h - a.b.h)[0];
  return scored.sort((a, b) => a.off - b.off)[0];
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
function windowCandidates(detections) {
  const candidates = (detections || [])
    .filter(d => d?.type === 'window' && (Number(d?.confidence) || 0) >= MIN_CONFIDENCE)
    .map(d => ({ b: box(d), confidence: Number(d?.confidence) || 0 }))
    .filter(d => d.b)                                     // box() coerces and rejects the unusable
    .sort((a, b) => (b.b.w * b.b.h) - (a.b.w * a.b.h));    // larger first, so dedupe keeps the larger

  const kept = [];
  let duplicates = 0;
  for (const c of candidates) {
    if (kept.some(k => iou(k.b, c.b) > DUPLICATE_IOU)) { duplicates++; continue; }
    kept.push(c);
  }
  return { kept, duplicates };
}

function measureWindows({ detections, aspectRatio, bands }) {
  if (!isFiniteNumber(aspectRatio) || aspectRatio <= 0) return null;
  const door = doorReference(detections, aspectRatio);
  if (!door) return null;

  const { kept, duplicates } = windowCandidates(detections);

  const doorTop = door.b.y;
  const windows = [];
  let implausible = 0;

  for (const c of kept) {
    const size = sizeWindow(c.b, door.b.h, aspectRatio);
    if (size.widthM < MIN_WINDOW_W_M || size.heightM < MIN_WINDOW_H_M ||
        size.widthM > MAX_WINDOW_W_M || size.heightM > MAX_WINDOW_H_M) {
      implausible++;
      continue;
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
    });
  }

  if (windows.length < MIN_WINDOWS || windows.length > MAX_WINDOWS) return null;

  return {
    method: 'door',
    windows,
    frontCount: windows.length,
    discarded: { duplicates, implausible },
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

  /* The measured windows describe the front elevation. Scale the COUNT to the
     whole house, keeping the measured mix of bands — a house's rear windows
     are not the same sizes as its front ones, but the mix is a better guess
     than assuming they are all standard. */
  const scale = totalCount / windows.length;

  let supplyFit = 0;
  let upperStoreyCount = 0;
  const byBand = {};

  if (windowsIncluded) {
    for (const w of windows) {
      const band = rates.windowBands.find(b => b.id === w.bandId);
      if (!band) throw new Error(`No rate for window band "${w.bandId}" in catalogue.glazing.`);
      const unit = band.supplyFit * styleMult * colourMult * (isBay ? (rates.bayUplift ?? 1) : 1);
      supplyFit += unit * scale;
      if (w.upperStorey) upperStoreyCount += scale;
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
     selections,          // { windowStyleId, doorStyleId, windowDoorColourId }
     rates,               // catalogue.glazing
     windowCountOverride, // the homeowner corrected the count by hand
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

  const base = measured || counted || priorWindows({ houseType: key, bands });

  const frontToTotal = rates.frontToTotal?.[key] ?? FRONT_TO_TOTAL_WINDOWS[key];

  /* Both photo-derived counts describe the front elevation and need scaling to
     the whole house. The prior is already a whole-house figure. */
  let totalCount = (base.method === 'door' || base.method === 'count')
    ? base.frontCount * frontToTotal
    : base.frontCount;

  let countSource = base.method === 'door' ? 'photo_door'
    : base.method === 'count' ? 'photo_count'
    : 'house_type_prior';

  /* A typed count beats everything, and is bounded for the same reason the
     manual wall area is: there is no honest client that sends 400 windows,
     so answering with 30 would dress a tampered request up as a real one. */
  const manual = Number(windowCountOverride);
  if (Number.isFinite(manual) && manual >= MIN_WINDOWS && manual <= MAX_WINDOWS) {
    totalCount = manual;
    countSource = 'manual_entry';
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
    countNote: countCapped
      ? `We've capped this at ${MAX_WINDOWS} windows. If your home has more, tell us the number and we'll price it properly.`
      : null,
    frontCount: (base.method === 'door' || base.method === 'count') ? base.frontCount : null,
    frontToTotal: (base.method === 'door' || base.method === 'count') ? frontToTotal : null,
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

module.exports = {
  estimateGlazing,
  // Exposed for tests and for scripts/validate-*, not for server.js.
  _internals: {
    sizeWindow, bandFor, measureWindows, priorWindows, priceGlazing,
    doorReference, iou, houseTypeKey,
  },
  HOUSE_TYPE_GLAZING_PRIORS,
  FRONT_TO_TOTAL_WINDOWS,
  MARKET_SPREAD,
  INSTALLER_SPREAD,
  NO_HAGGLE,
  MIN_WINDOWS,
  MAX_WINDOWS,
};
