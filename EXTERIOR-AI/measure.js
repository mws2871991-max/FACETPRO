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

/* ── PLAN GEOMETRY → front-to-total multiplier ──
   A photo shows one elevation; the quote needs whole-house wall area. The
   multiplier between them is not a fudge factor, it is plan geometry:

     total wall     = exposed perimeter × wall height
     front elevation = frontage width   × wall height

   Wall height cancels. So frontToTotal = exposedPerimeter / frontageWidth,
   and it depends only on the plan shape — no assumption about storey height
   is needed, which removes the biggest thing that could have been wrong.

   This matches how the UK actually measures domestic wall area. BRE's RdSAP
   manual defines wall area as "the room height ... multiplied by the heat
   loss perimeter", where the heat loss perimeter is the exposed wall
   perimeter, and for "a dwelling joined onto another dwelling (semi-detached
   and terraced houses) the measurement is to the midpoint of the party wall"
   — i.e. party walls are excluded, exactly as below. That confirms the
   method, and independently confirms mid-terrace = 2.0. It does NOT confirm
   the frontage and depth figures used here; only surveyed properties can.

   Exposed perimeter by type, with W = frontage, D = depth:
     mid-terrace   both side walls are party walls   → 2W        (exactly 2.0)
     end-terrace   one side wall exposed             → 2W + D
     semi          one side wall exposed             → 2W + D
     detached      all four sides exposed            → 2W + 2D

   D is derived from floor area: footprint = floorArea / storeys, D = footprint / W.

   Inputs are English Housing Survey 2018-19 mean floor areas (detached 149,
   semi 97, terraced 88 m²) and typical UK plot frontages (terrace 5–6 m,
   semi 6–8 m). Sources are in the README.

   These replace the earlier back-derived guesses of 1.7/2.4/3.2, which this
   derivation shows were low by 15–25%.

   They now survive a check against measured data. The prototype's priors come
   from 120 surveys, so dividing each surveyed wall area by its multiplier
   gives the front elevation that multiplier implies, which can be compared
   with the geometry above:

     terrace    50 m² ÷ 2.00 = 25.0 m² implied   vs 23.5 m² geometry    -6%
     semi       85 m² ÷ 3.05 = 27.9 m² implied   vs 29.0 m² geometry    +4%
     detached  130 m² ÷ 3.84 = 33.9 m² implied   vs 38.4 m² geometry   +13%

   Terrace and semi agree closely. Detached does not, and the likeliest cause
   is the 9.0 m frontage assumed here being too wide for the properties in
   that survey — matching it would need a multiplier nearer 3.39. Left as the
   geometry gives it rather than fitted to one number, and flagged in the
   README. Set WALL_FRONT_TO_TOTAL_DETACHED=3.39 to follow the survey instead.

   Still not the same as measuring properties end to end — the door-reference
   path has no external validation at all, since the prototype only ever used
   the coverage method. See `npm run validate`. */
const PLAN_GEOMETRY = {
  detached:   { floorAreaM2: 149, storeys: 2, frontageM: 9.0,  exposed: '2W+2D' },
  semi:       { floorAreaM2: 97,  storeys: 2, frontageM: 6.8,  exposed: '2W+D'  },
  endTerrace: { floorAreaM2: 88,  storeys: 2, frontageM: 5.5,  exposed: '2W+D'  },
  terrace:    { floorAreaM2: 88,  storeys: 2, frontageM: 5.5,  exposed: '2W'    },
  // Single storey, so the whole floor area is the footprint. Bungalows are
  // wide and shallow rather than tall, which is why they need their own entry:
  // every other type derives depth assuming two storeys, and applying that to
  // a bungalow halves its footprint and badly understates the walls.
  // Floor area 77 m² is EHS 2018-19; the 10 m frontage is assumed, as with the
  // other types. Treated as detached, which most bungalows are.
  bungalow:   { floorAreaM2: 77,  storeys: 1, frontageM: 10.0, exposed: '2W+2D' },
};

function frontToTotalFrom(plan) {
  const depthM = (plan.floorAreaM2 / plan.storeys) / plan.frontageM;
  const dw = depthM / plan.frontageM;
  if (plan.exposed === '2W') return 2;
  if (plan.exposed === '2W+D') return 2 + dw;
  if (plan.exposed === '2W+2D') return 2 + 2 * dw;
  throw new Error(`Unknown exposed-perimeter formula: ${plan.exposed}`);
}

/* House-type priors.
   `wallM2` is typical total exterior wall area for the whole property, and
   `band` is the range outside which a computed figure is treated as wrong.

   `wallM2`, `calibrationFactor` and `coverageCentre` come from the prototype's
   calibration table (Renderd-V4-11), which labels itself "avg from 120
   surveys" — so for terrace, semi and detached these are measured figures,
   not assumptions. Its own rows, verbatim:

     terrace   m2:50   coverage:0.18  factor:277   "2-bed, 2-storey"
     semi      m2:85   coverage:0.28  factor:303   "3-bed, 2-storey"
     detached  m2:130  coverage:0.38  factor:342   "4-bed, 2-storey"

   They are mutually consistent — centre × factor lands on the prior for all
   three (0.18×277≈50, 0.28×303≈85, 0.38×342≈130).

   endTerrace is not in that table and remains an extrapolation. bungalow's
   60 m² comes from the later Renderd-v4 table, which lists m² only, so its
   coverage centre is still ours (factor follows from 60 / 0.22).

   `frontToTotal` is computed from PLAN_GEOMETRY above rather than stated, so
   the number is always traceable to the frontage and depth it came from.

   End-of-terrace is a separate type because the geometry differs enormously:
   a mid-terrace has two party walls and a multiplier of exactly 2.0, an
   end-terrace has one and lands near 3.45. Treating one as the other is a
   ~70% error, far larger than any other approximation here.

   !! Its calibrationFactor and coverageCentre are DERIVED, not from the
   survey table, which covers only the three original types. */
const HOUSE_TYPE_PRIORS = {
  detached:   { label: 'Detached',       wallM2: 130, band: [90, 200], calibrationFactor: 342, coverageCentre: 0.38, calibrationSource: 'survey table' },
  semi:       { label: 'Semi-detached',  wallM2: 85,  band: [55, 130], calibrationFactor: 303, coverageCentre: 0.28, calibrationSource: 'survey table' },
  /* Not in the 120-survey table, but it doesn't have to be a guess: an end of
     terrace is the same house as a mid-terrace with one more wall exposed, and
     the geometry gives the relationship exactly —

       mid  exposed perimeter = 2W
       end  exposed perimeter = 2W + D        (D/W = 1.45 for a terrace)
       so   end = mid × (2 + D/W) / 2 = ×1.727

     Applied to the surveyed 50 m² that's 86 m², anchored to measured data
     rather than invented. Coverage centre stays at the terrace's 0.18 — same
     frontage, so the same share of a well-framed photo — and the factor
     follows from 86 / 0.18. */
  endTerrace: { label: 'End of terrace', wallM2: 86,  band: [55, 130], calibrationFactor: 478, coverageCentre: 0.18, calibrationSource: 'derived from surveyed mid-terrace' },
  bungalow:   { label: 'Bungalow',       wallM2: 60,  band: [38, 95],  calibrationFactor: 273, coverageCentre: 0.22, calibrationSource: 'prototype table (m² only)' },
  terrace:    { label: 'Mid-terrace',    wallM2: 50,  band: [32, 80],  calibrationFactor: 277, coverageCentre: 0.18, calibrationSource: 'survey table' },
};

// Attach the geometry-derived multiplier to each type.
for (const [type, prior] of Object.entries(HOUSE_TYPE_PRIORS)) {
  prior.plan = PLAN_GEOMETRY[type];
  prior.frontToTotal = frontToTotalFrom(PLAN_GEOMETRY[type]);
}

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
  const ratio = Number(tuning?.frontToTotal?.[type]);
  const tolerance = Number(tuning?.coverageTolerance);
  const effCentre = Number.isFinite(centre) && centre > 0 ? centre : prior.coverageCentre;
  const effTolerance = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : DEFAULT_COVERAGE_TOLERANCE;
  return {
    calibrationFactor: Number.isFinite(factor) && factor > 0 ? factor : prior.calibrationFactor,
    frontToTotal: Number.isFinite(ratio) && ratio > 0 ? ratio : prior.frontToTotal,
    coverageCentre: effCentre,
    coverageBand: [Math.max(0, effCentre - effTolerance), effCentre + effTolerance],
  };
}

// How wide a range to show, by method. The door method is geometric and
// tighter; the prior is a population average and deserves to look vague.
const UNCERTAINTY = { door: 0.12, coverage: 0.20, prior: 0.25 };

// How far the two methods may differ before we stop calling it agreement.
const CROSS_CHECK_TOLERANCE = 0.20;

const WALL_TYPES = new Set(['cladding']);
const DOOR_TYPES = new Set(['door-front']);
const OPENING_TYPES = new Set(['window', 'door-front']);

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const isFiniteNumber = (n) => typeof n === 'number' && Number.isFinite(n);

/* Resolve whatever the caller said into a canonical type key.

   This lowercased the input and looked it up directly, which meant the
   camelCase key `endTerrace` could never match: every end-of-terrace request
   silently became a semi, understating wall area by around 30%. Comparing
   normalised forms on both sides removes the whole class of problem, and the
   aliases mean a caller can send "End of terrace" or "mid terrace" and be
   understood. */
const normaliseType = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

const TYPE_LOOKUP = new Map(Object.keys(HOUSE_TYPE_PRIORS).map(k => [normaliseType(k), k]));
for (const [alias, canonical] of [
  ['semidetached', 'semi'],
  ['endofterrace', 'endTerrace'],
  ['endterraced', 'endTerrace'],
  ['end', 'endTerrace'],
  ['midterrace', 'terrace'],
  ['midterraced', 'terrace'],
  ['terraced', 'terrace'],
  ['detatched', 'detached'],   // common misspelling
]) {
  TYPE_LOOKUP.set(alias, canonical);
}

function houseTypeKey(input) {
  return TYPE_LOOKUP.get(normaliseType(input)) || DEFAULT_HOUSE_TYPE;
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
    // How many door-heights tall the wall is — a proxy for storeys that comes
    // free with the geometry. Two storeys is around 3, a bungalow around 1.3.
    wallToDoorHeight: wall.h / door.b.h,
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
  let crossCheck = null;

  /* Both methods run whenever both can. They share nothing but the wall box —
     one scales from the door's height, the other from the wall's share of the
     frame against a surveyed coverage figure — so when they agree, that is
     genuine corroboration rather than the same assumption twice. When they
     don't, something is wrong with the photo or the detection, and the honest
     response is a wider range rather than a confident wrong number.

     This is the only validation the door path has. The prototype's 120
     surveys calibrated the coverage method, so agreement with coverage is
     indirect evidence the door path is landing in the right place. */
  const byDoor = measureByDoor({ detections: list, aspectRatio });
  const byCoverage = measureByCoverage({ detections: list, tuned });

  if (byDoor) {
    m2 = byDoor.frontElevationM2 * tuned.frontToTotal;
    method = 'door';
    notes.push(`Scaled from the front door (${byDoor.doorHeightPct.toFixed(1)}% of image height, assumed ${DOOR_HEIGHT_M} m).`);
    notes.push(`Front elevation ≈ ${Math.round(byDoor.frontElevationM2)} m² after subtracting windows and doors; ×${tuned.frontToTotal.toFixed(2)} for the other walls of a ${prior.label.toLowerCase()} property.`);

    /* The wall's height in door-heights tells us roughly how many storeys we
       are looking at, and every type except bungalow assumes two. If the photo
       disagrees with the type they picked, say so — the multiplier is derived
       from that assumption, so a mismatch is a large error, and the homeowner
       is the one who can correct it. */
    const storeysLook = byDoor.wallToDoorHeight;
    if (Number.isFinite(storeysLook)) {
      if (type !== 'bungalow' && storeysLook < 1.9) {
        notes.push('This looks like a single-storey home. If it\'s a bungalow, choose that above — we\'d otherwise assume two storeys and overstate the walls.');
      } else if (type === 'bungalow' && storeysLook > 2.4) {
        notes.push('This looks like it has more than one storey, which doesn\'t match "bungalow" — worth checking the house type above.');
      }
    }
    // Cross-check against the independently calibrated coverage method.
    if (byCoverage && byCoverage.framingOk && m2 > 0) {
      const gap = Math.abs(m2 - byCoverage.totalM2) / m2;
      crossCheck = {
        coverageM2: Math.round(byCoverage.totalM2),
        differencePct: Math.round(gap * 100),
        agrees: gap <= CROSS_CHECK_TOLERANCE,
      };
      // Careful with the wording: the figure can still be replaced by the
      // prior below, so don't promise a widened range here — just report what
      // the second method said and let the range speak for itself.
      notes.push(crossCheck.agrees
        ? `Checked a second way — how much of the photo your walls fill puts it at ≈${crossCheck.coverageM2} m², within ${crossCheck.differencePct}%.`
        : `A second way of measuring puts it at ≈${crossCheck.coverageM2} m², ${crossCheck.differencePct}% away, so we're less sure of this one.`);
    }
  } else {
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

  /* A door reading corroborated by coverage earns the tight range. One the
     second method contradicts does not — widen to at least the size of the
     disagreement, so the range still covers what the other method said. */
  let spread = UNCERTAINTY[method] ?? UNCERTAINTY.prior;
  if (method === 'door' && crossCheck && !crossCheck.agrees) {
    spread = Math.max(spread, Math.min(crossCheck.differencePct / 100, UNCERTAINTY.prior));
  }
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);

  return {
    m2: Math.round(m2),
    low: round5(m2 * (1 - spread)),
    high: round5(m2 * (1 + spread)),
    method,
    houseType: type,
    houseTypeLabel: prior.label,
    // A door reading the second method contradicts isn't "good", whatever
    // method produced it.
    confidence: method === 'door'
      ? (crossCheck && !crossCheck.agrees ? 'rough' : 'good')
      : method === 'coverage' ? 'rough' : 'typical figure',
    crossCheck,
    notes,
  };
}

/* ── Image dimensions, read from the bytes ──
   The aspect ratio feeds straight into the area calculation, so it is parsed
   from the uploaded image rather than accepted from the client — otherwise a
   tampered value would move the m², and with it the quote.
   Supports the formats /api/detect already accepts. */
/* What the bytes actually are, rather than what the request says they are.

   The declared MIME type used to be allowlisted and then forwarded straight to
   Anthropic as media_type, with nothing ever looking at the bytes — so
   arbitrary base64 could be pushed through the API key, and the daily cap
   bounded the volume rather than the content.

   Returns { mime, width, height }, or null if it is not one of the four
   formats we accept. Same header parsing as imageSize, which now delegates
   here so there is one definition of "is this an image". */
const sniffImage = readSize;

function imageSize(buffer) {
  const found = readSize(buffer);
  return found ? { width: found.width, height: found.height } : null;
}

function readSize(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 24) return null;

  // PNG: IHDR is always the first chunk.
  if (buffer.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }

  // GIF87a / GIF89a: little-endian dimensions in the logical screen descriptor.
  if (buffer.slice(0, 3).toString('ascii') === 'GIF') {
    return { mime: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) };
  }

  // WebP (VP8 / VP8L / VP8X).
  if (buffer.slice(0, 4).toString('ascii') === 'RIFF' && buffer.slice(8, 12).toString('ascii') === 'WEBP') {
    const fourCC = buffer.slice(12, 16).toString('ascii');
    if (fourCC === 'VP8X' && buffer.length >= 30) {
      return {
        mime: 'image/webp',
        width: 1 + (buffer[24] | (buffer[25] << 8) | (buffer[26] << 16)),
        height: 1 + (buffer[27] | (buffer[28] << 8) | (buffer[29] << 16)),
      };
    }
    if (fourCC === 'VP8 ' && buffer.length >= 30) {
      return { mime: 'image/webp', width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    }
    if (fourCC === 'VP8L' && buffer.length >= 25) {
      const bits = buffer.readUInt32LE(21);
      return { mime: 'image/webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return null;
  }

  // JPEG: walk the segment markers to a start-of-frame and read its dimensions.
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    let orientation = 1;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset++; continue; }
      const marker = buffer[offset + 1];

      // APP1 may carry the EXIF block, which is where a phone records that the
      // pixels are stored one way round and meant to be seen another.
      if (marker === 0xe1) {
        const length = buffer.readUInt16BE(offset + 2);
        orientation = exifOrientation(buffer.subarray(offset + 4, offset + 2 + length)) || orientation;
        if (length < 2) return null;
        offset += 2 + length;
        continue;
      }

      // SOF0-SOF15, excluding DHT (c4), JPG (c8) and DAC (cc).
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        /* Orientations 5-8 are the quarter turns: the stored pixels are
           landscape and the photograph is portrait, or the reverse. Report the
           dimensions as the photograph is seen, because that is what every
           consumer of this means — aspectRatio is a term in the wall-area
           formula, and the detection boxes come back as percentages of the
           image the model was shown, which is the upright one. */
        const turned = orientation >= 5 && orientation <= 8;
        return {
          mime: 'image/jpeg',
          width: turned ? height : width,
          height: turned ? width : height,
          orientation,
        };
      }
      const length = buffer.readUInt16BE(offset + 2);
      if (length < 2) return null;
      offset += 2 + length;
    }
  }

  return null;
}

/* The EXIF orientation tag, or 0 if there isn't one.

   A phone stores the sensor's pixels and records which way up the picture was
   taken. Reading the SOF dimensions alone gets a portrait photograph the wrong
   way round — and on the measured path that is not cosmetic: area resolves as
   aspect x 1.98^2 x (wallW% x wallH%) / doorH%^2, so a landscape aspect on a
   portrait photograph moves every measurement by the square of the frame's
   proportions. Measured on a real iPhone photograph of a terrace: an average
   window width of 2.70 m instead of 1.52 m, and an estimate 39% high, labelled
   "measured from your photo".

   Deliberately small. It reads the first IFD of the first APP1 block and looks
   for tag 0x0112. Anything unexpected returns 0 and the caller carries on as
   though the tag were absent, which is what a JPEG without one does anyway. */
function exifOrientation(block) {
  try {
    if (block.length < 14) return 0;
    if (block.toString('latin1', 0, 6) !== 'Exif\0\0') return 0;
    const tiff = 6;
    const endian = block.toString('latin1', tiff, tiff + 2);
    if (endian !== 'II' && endian !== 'MM') return 0;
    const little = endian === 'II';
    const u16 = (at) => little ? block.readUInt16LE(at) : block.readUInt16BE(at);
    const u32 = (at) => little ? block.readUInt32LE(at) : block.readUInt32BE(at);

    const ifd = tiff + u32(tiff + 4);
    if (ifd + 2 > block.length) return 0;
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (entry + 12 > block.length) return 0;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 1 && value <= 8 ? value : 0;
      }
    }
    return 0;
  } catch (_) {
    return 0;   // a malformed EXIF block is not a reason to refuse a photograph
  }
}

module.exports = {
  sniffImage,
  estimateWallArea,
  imageSize,
  tuningFor,
  houseTypeKey,
  frontToTotalFrom,
  PLAN_GEOMETRY,
  HOUSE_TYPE_PRIORS,
  HOUSE_TYPE_KEYS: Object.keys(HOUSE_TYPE_PRIORS),
  DEFAULT_HOUSE_TYPE,
  DEFAULT_COVERAGE_TOLERANCE,
  DOOR_HEIGHT_M,
  // exported for tests
  _internals: { measureByDoor, measureByCoverage, wallExtent, doorReference, box },
};
