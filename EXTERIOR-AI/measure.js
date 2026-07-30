/* ─────────────────────────────────────────────────────────────────────────
   Wall-area estimation from a single front-elevation photo.

   Pure functions only — no I/O, no network — so the geometry can be tested
   directly. server.js owns the endpoints and the stored detection records.

   This produces a PLANNING ESTIMATE and nothing more. It is deliberately
   returned as a range, and the caller must never present it as a survey
   figure (see legal/terms.html §4).

   Two methods, in order of preference:

   1. Door reference (primary). A UK front door is ~1.98 m. The detected
      door's height in the image gives metres-per-pixel, which scales the
      wall bounding box into m². This is independent of how far away the
      homeowner stood, which matters because framing varies wildly.

   2. Coverage (fallback, only when no door was detected). The wall's share
      of the frame times a calibration constant. Much weaker: it assumes a
      typical framing distance, so a close-up or a wide street shot skews it.

   Both are then sanity-checked against house-type priors, and fall back to
   the prior when they land outside a plausible band.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const DOOR_HEIGHT_M = 1.98;   // standard UK external door leaf

/* House-type priors.
   `wallM2` is typical total exterior wall area for the whole property, and
   `band` is the range outside which a computed figure is treated as wrong.

   `calibrationFactor` and `coverageCentre` come from the prototype's survey
   table. They are mutually consistent — centre × factor lands on the prior
   for all three types (0.18×277≈50, 0.28×303≈85, 0.38×342≈130), which is a
   good sign the table is internally sound.

   `frontToTotal` converts the front elevation (all a single photo can show)
   into whole-house wall area: a terrace has two exposed elevations, a semi
   three, a detached four, and rear elevations are rarely as wide as the front.

   !! UNVALIDATED: the three frontToTotal multipliers below are reasoned
   guesses back-derived from the priors, NOT survey figures. Unlike the
   calibration factors and coverage centres, nothing has measured them
   against real properties. They scale every door-method result directly, so
   they are the largest remaining source of systematic error here and need
   calibrating against surveyed homes. See the README. */
const HOUSE_TYPE_PRIORS = {
  detached: { label: 'Detached',      wallM2: 130, band: [90, 200], frontToTotal: 3.2, calibrationFactor: 342, coverageCentre: 0.38 },
  semi:     { label: 'Semi-detached', wallM2: 85,  band: [55, 130], frontToTotal: 2.4, calibrationFactor: 303, coverageCentre: 0.28 },
  terrace:  { label: 'Terraced',      wallM2: 50,  band: [32, 80],  frontToTotal: 1.7, calibrationFactor: 277, coverageCentre: 0.18 },
};

const DEFAULT_HOUSE_TYPE = 'semi';

// How far either side of the coverage centre still counts as well framed.
const DEFAULT_COVERAGE_TOLERANCE = 0.04;

/* Per-type tuning, with env overrides applied by the caller. Returns the
   effective numbers for one house type so the rest of the module never has
   to think about where a value came from. */
function tuningFor(type, tuning) {
  const prior = HOUSE_TYPE_PRIORS[type];
  const factor = Number(tuning?.calibration?.[type]);
  const centre = Number(tuning?.coverageCentre?.[type]);
  const tolerance = Number(tuning?.coverageTolerance);
  const effCentre = Number.isFinite(centre) && centre > 0 ? centre : prior.coverageCentre;
  const effTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : DEFAULT_COVERAGE_TOLERANCE;
  return {
    calibrationFactor: Number.isFinite(factor) && factor > 0 ? factor : prior.calibrationFactor,
    coverageCentre: effCentre,
    coverageBand: [Math.max(0, effCentre - effTolerance), effCentre + effTolerance],
  };
}

// How wide a range to show, by method. The door method is geometric and
// tighter; the prior is a population average and deserves to look vague.
const UNCERTAINTY = { door: 0.12, coverage: 0.20, prior: 0.25 };

const WALL_TYPES = new Set(['cladding']);
const DOOR_TYPES = new Set(['door-front']);
const OPENING_TYPES = new Set(['window', 'door-front']);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

function houseTypeKey(input) {
  const key = String(input || '').toLowerCase().trim();
  return Object.prototype.hasOwnProperty.call(HOUSE_TYPE_PRIORS, key) ? key : DEFAULT_HOUSE_TYPE;
}

/* A detection box is in percentages of image width/height. Returns null for
   anything malformed rather than letting NaN leak into the arithmetic. */
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

/* Merged extent of every wall/cladding detection, as one bounding box.
   Walls are often returned as several regions either side of a door. */
function wallExtent(detections) {
  const boxes = detections.filter(d => WALL_TYPES.has(d?.type)).map(box).filter(Boolean);
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map(b => b.x));
  const y0 = Math.min(...boxes.map(b => b.y));
  const x1 = Math.max(...boxes.map(b => b.x + b.w));
  const y1 = Math.max(...boxes.map(b => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Tallest detected front door — the most reliable scale reference in frame.
function doorReference(detections) {
  const doors = detections
    .filter(d => DOOR_TYPES.has(d?.type))
    .map(d => ({ b: box(d), confidence: Number(d?.confidence) || 0 }))
    .filter(d => d.b);
  if (!doors.length) return null;
  return doors.sort((a, b) => b.b.h - a.b.h)[0];
}

/* ── METHOD 1: door reference ──
   Derivation, with W/H the image dimensions in pixels:

     door height in px = (doorH% / 100) · H        = 1.98 m
     wall area in px²  = (wallW% / 100 · W) · (wallH% / 100 · H)
     m per px          = 1.98 / ((doorH% / 100) · H)

   Substituting, H cancels entirely and W only survives as the aspect ratio:

     area m² = aspect · 1.98² · (wallW% · wallH%) / doorH%²

   So the only thing needed beyond the boxes is width/height — which the
   server reads from the image itself rather than trusting the client. */
function measureByDoor({ detections, aspectRatio }) {
  if (!isFiniteNumber(aspectRatio) || aspectRatio <= 0) return null;
  const wall = wallExtent(detections);
  const door = doorReference(detections);
  if (!wall || !door) return null;
  if (door.b.h < 2) return null;   // implausibly small door box — reject rather than divide by it

  const scale = aspectRatio * DOOR_HEIGHT_M * DOOR_HEIGHT_M / (door.b.h * door.b.h);
  const grossM2 = wall.w * wall.h * scale;

  // Subtract windows and doors, clipped to the wall extent so a box that
  // overhangs the wall can't remove more area than the wall has.
  const openingsPct = detections
    .filter(d => OPENING_TYPES.has(d?.type))
    .map(box)
    .filter(Boolean)
    .reduce((sum, b) => sum + intersectionPct(wall, b), 0);
  const openingsM2 = openingsPct * scale;

  // Never let openings eat more than 60% of the elevation — that would mean
  // the detection is wrong, not that the house is mostly glass.
  const netFrontM2 = Math.max(grossM2 * 0.4, grossM2 - openingsM2);

  return {
    method: 'door',
    frontElevationM2: netFrontM2,
    grossFrontM2: grossM2,
    openingsM2,
    doorHeightPct: door.b.h,
    doorConfidence: door.confidence,
  };
}

/* ── METHOD 2: coverage (fallback) ──
   Only used when no door was found. Assumes a typical framing distance, so
   it is checked against the house type's expected coverage band and
   discarded when the photo is clearly framed too close or too far. */
function measureByCoverage({ detections, tuned }) {
  const wall = wallExtent(detections);
  if (!wall) return null;

  const coverage = (wall.w * wall.h) / 10000;   // share of the frame, 0–1
  const [lo, hi] = tuned.coverageBand;
  const framingOk = coverage >= lo && coverage <= hi;

  return {
    method: 'coverage',
    coverage,
    framingOk,
    coverageBand: tuned.coverageBand,
    // Coverage is calibrated straight to whole-house wall area, so unlike the
    // door method it needs no frontToTotal step.
    totalM2: coverage * tuned.calibrationFactor,
  };
}

/**
 * Estimate exterior wall area from one photo's detections.
 *
 * @param {object[]} detections   /api/detect output (server's own copy)
 * @param {number}   aspectRatio  image width / height, read from the image
 * @param {string}   houseType    'detached' | 'semi' | 'terrace'
 * @param {object}   tuning       optional env overrides:
 *                                { calibration: {semi: 303, …},
 *                                  coverageCentre: {semi: 0.28, …},
 *                                  coverageTolerance: 0.04 }
 * @returns {{m2:number, low:number, high:number, method:string,
 *            houseType:string, confidence:string, notes:string[]}}
 */
function estimateWallArea({ detections, aspectRatio, houseType, tuning } = {}) {
  const list = Array.isArray(detections) ? detections : [];
  const type = houseTypeKey(houseType);
  const prior = HOUSE_TYPE_PRIORS[type];
  const tuned = tuningFor(type, tuning);

  const notes = [];
  let m2 = null;
  let method = 'prior';

  const byDoor = measureByDoor({ detections: list, aspectRatio });
  if (byDoor) {
    m2 = byDoor.frontElevationM2 * prior.frontToTotal;
    method = 'door';
    notes.push(`Scaled from the front door (${byDoor.doorHeightPct.toFixed(1)}% of image height, assumed ${DOOR_HEIGHT_M} m).`);
    notes.push(`Front elevation ≈ ${Math.round(byDoor.frontElevationM2)} m² after subtracting windows and doors; ×${prior.frontToTotal} for a ${prior.label.toLowerCase()} property.`);
  } else {
    const byCoverage = measureByCoverage({ detections: list, tuned });
    if (byCoverage && byCoverage.framingOk) {
      m2 = byCoverage.totalM2;
      method = 'coverage';
      notes.push(`No front door detected, so this is based on the walls filling ${(byCoverage.coverage * 100).toFixed(1)}% of the photo.`);
    } else if (byCoverage) {
      notes.push(`The walls fill ${(byCoverage.coverage * 100).toFixed(1)}% of the photo, outside the ${(tuned.coverageBand[0] * 100).toFixed(0)}–${(tuned.coverageBand[1] * 100).toFixed(0)}% expected for a ${prior.label.toLowerCase()} — the photo is probably framed too close or too far.`);
    } else {
      notes.push('No walls were detected in the photo.');
    }
  }

  // Sanity clamp: anything outside the band for this house type is treated as
  // a detection failure, not a genuinely unusual house.
  if (m2 !== null) {
    const [lo, hi] = prior.band;
    if (m2 < lo || m2 > hi) {
      notes.push(`${Math.round(m2)} m² is outside the ${lo}–${hi} m² range expected for a ${prior.label.toLowerCase()}, so we've used the typical figure instead.`);
      m2 = null;
    }
  }

  if (m2 === null) {
    m2 = prior.wallM2;
    method = 'prior';
    notes.push(`Using the typical ${prior.label.toLowerCase()} figure of ${prior.wallM2} m².`);
  }

  const spread = UNCERTAINTY[method] ?? UNCERTAINTY.prior;
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

  return {
    m2: Math.round(m2),
    low: round5(m2 * (1 - spread)),
    high: round5(m2 * (1 + spread)),
    method,
    houseType: type,
    houseTypeLabel: prior.label,
    confidence: method === 'door' ? 'good' : method === 'coverage' ? 'rough' : 'typical figure',
    notes,
  };
}

/* ── Image dimensions, read from the bytes ──
   The aspect ratio feeds straight into the area calculation, so it is parsed
   from the uploaded image rather than accepted from the client — otherwise a
   tampered value would move the m², and with it the quote.
   Supports the formats /api/detect already accepts. */
function imageSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  // PNG: IHDR is always the first chunk.
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF87a / GIF89a: little-endian dimensions in the logical screen descriptor.
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // WebP (VP8 / VP8L / VP8X).
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    const fourCC = buffer.slice(12, 16).toString('ascii');
    if (fourCC === 'VP8X' && buffer.length >= 30) {
      return {
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
      };
    }
    if (fourCC === 'VP8 ' && buffer.length >= 30) {
      return { width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (fourCC === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: walk the segment markers to a start-of-frame and read its dimensions.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];
      // SOF0-SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }

  return null;
}

module.exports = {
  estimateWallArea,
  imageSize,
  tuningFor,
  HOUSE_TYPE_PRIORS,
  HOUSE_TYPE_KEYS: Object.keys(HOUSE_TYPE_PRIORS),
  DEFAULT_HOUSE_TYPE,
  DEFAULT_COVERAGE_TOLERANCE,
  DOOR_HEIGHT_M,
  // exported for tests
  _internals: { measureByDoor, measureByCoverage, wallExtent, doorReference, box },
};
