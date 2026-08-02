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
const MIN_WINDOWS = 1;
const MAX_WINDOWS = 30;

/* A window whose box sits entirely above the top of the front door is on an
   upper storey. Crude, and deliberately so: it needs no assumption about
   storey height, only that the door is at ground level. The tolerance
   absorbs a box drawn slightly loose. */
const UPPER_STOREY_TOLERANCE_PCT = 1.5;

/* How wide a range to show, by method. Wider than measure.js's equivalents
   because window count is discrete: one missed window on a five-window
   terrace is a 20% error, and no amount of geometric precision recovers it. */
const UNCERTAINTY = { door: 0.18, prior: 0.30 };

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

function doorReference(detections) {
  const doors = detections
    .filter(d => d?.type === 'door-front')
    .map(d => ({ b: box(d), confidence: Number(d?.confidence) || 0 }))
    .filter(d => d.b && d.b.h >= 2);   // implausibly small box — reject rather than divide by it
  if (!doors.length) return null;
  return doors.sort((a, b) => b.b.h - a.b.h)[0];
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
function measureWindows({ detections, aspectRatio, bands }) {
  if (!isFiniteNumber(aspectRatio) || aspectRatio <= 0) return null;
  const door = doorReference(detections);
  if (!door) return null;

  const candidates = detections
    .filter(d => d?.type === 'window' && (Number(d?.confidence) || 0) >= MIN_CONFIDENCE)
    .map(d => ({ b: box(d), confidence: Number(d?.confidence) || 0 }))
    .filter(d => d.b)
    .sort((a, b) => (b.b.w * b.b.h) - (a.b.w * a.b.h));   // larger first, so dedupe keeps the larger

  const kept = [];
  let duplicates = 0;
  for (const c of candidates) {
    if (kept.some(k => iou(k.b, c.b) > DUPLICATE_IOU)) { duplicates++; continue; }
    kept.push(c);
  }

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
function priceGlazing({ windows, totalCount, selections, rates, houseType }) {
  // Unreachable through estimateGlazing, which enforces a minimum — but this
  // is exported, and dividing by zero here turns every money field into NaN
  // quietly rather than loudly.
  if (!windows.length) throw new Error('priceGlazing needs at least one window.');
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

  for (const w of windows) {
    const band = rates.windowBands.find(b => b.id === w.bandId);
    if (!band) throw new Error(`No rate for window band "${w.bandId}" in catalogue.glazing.`);
    const unit = band.supplyFit * styleMult * colourMult * (isBay ? (rates.bayUplift ?? 1) : 1);
    supplyFit += unit * scale;
    if (w.upperStorey) upperStoreyCount += scale;
    byBand[w.bandId] = (byBand[w.bandId] || 0) + scale;
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
  const doorSelections = [selections.doorStyleId].filter(Boolean);
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
     Disposal of the old frames is a separate, per-unit line. */
  const disposal = (rates.disposalPerUnit ?? 0) * (Math.round(totalCount) + doorSelections.length);

  let net = supplyFit + doors + access + disposal;

  // A minimum job charge, because two windows do not cost two-elevenths of
  // eleven windows — the van, the survey and the day are the same.
  const minimum = rates.minJobCharge ?? 0;
  const minimumApplied = net < minimum;
  if (minimumApplied) net = minimum;

  /* Replacement windows and doors in an existing dwelling are standard-rated.
     The energy-saving materials relief does not cover them. Shown separately,
     never folded into the headline, exactly as the cladding estimate does. */
  const vat = net * ((rates.vatPct ?? 20) / 100);

  return {
    supplyFit: round(supplyFit),
    doors: round(doors),
    access: round(access),
    disposal: round(disposal),
    vat: round(vat),
    total: round(net + vat),
    minimumApplied,
    upperStoreyCount: Math.round(upperStoreyCount),
    byBand: Object.fromEntries(Object.entries(byBand).map(([k, v]) => [k, Math.round(v)])),
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
  const base = measured || priorWindows({ houseType: key, bands });

  const frontToTotal = rates.frontToTotal?.[key] ?? FRONT_TO_TOTAL_WINDOWS[key];

  // The prior is already a whole-house count; only a measured front elevation
  // needs scaling up.
  let totalCount = base.method === 'door'
    ? base.frontCount * frontToTotal
    : base.frontCount;

  let countSource = base.method === 'door' ? 'photo_door' : 'house_type_prior';

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
  });

  const spread = countSource === 'manual_entry'
    ? UNCERTAINTY.door
    : UNCERTAINTY[base.method === 'door' ? 'door' : 'prior'];

  return {
    countSource,
    houseType: key,
    windowCount: totalCount,
    countCapped,
    countNote: countCapped
      ? `We've capped this at ${MAX_WINDOWS} windows. If your home has more, tell us the number and we'll price it properly.`
      : null,
    frontCount: base.method === 'door' ? base.frontCount : null,
    frontToTotal: base.method === 'door' ? frontToTotal : null,
    windows: base.windows,
    discarded: base.discarded,
    price,
    range: {
      low: round(price.total * (1 - spread)),
      high: round(price.total * (1 + spread)),
    },
    // What the UI should say about where this number came from. Keep the
    // wording here so the page and the lead email can never disagree.
    sourceLabel: {
      photo_door: 'measured from your photo',
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
  MIN_WINDOWS,
  MAX_WINDOWS,
};
