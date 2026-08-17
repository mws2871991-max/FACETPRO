/* Tests for the wall-area geometry. Run: npm test
   Plain node:test — no dependencies, no build step, consistent with the
   rest of the project. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const test = require('node:test');
const assert = require('node:assert');
const { estimateWallArea, imageSize, HOUSE_TYPE_PRIORS } = require('../measure');

const ASPECT_4_3 = 4 / 3;

/* A physically consistent 4:3 photo of a two-storey semi.

   Frame: 10 m tall, so 13.33 m wide. House front 7 m × 6 m. Door 0.9 × 1.98.
   Four windows at 1.2 × 1.2. Percentages below are derived from those metres,
   which keeps the fixture honest — an arbitrary set of boxes can easily
   describe a house that couldn't exist. */
const FRAME_H_M = 10;
const FRAME_W_M = FRAME_H_M * ASPECT_4_3;
const pctW = (m) => (m / FRAME_W_M) * 100;
const pctH = (m) => (m / FRAME_H_M) * 100;

const semiPhoto = [
  { type: 'cladding',   x_pct: pctW(3.2), y_pct: pctH(3.4), w_pct: pctW(7), h_pct: pctH(6), confidence: 0.9 },
  { type: 'door-front', x_pct: pctW(6.2), y_pct: pctH(7.4), w_pct: pctW(0.9), h_pct: pctH(1.98), confidence: 0.95 },
  { type: 'window',     x_pct: pctW(4.0), y_pct: pctH(7.6), w_pct: pctW(1.2), h_pct: pctH(1.2), confidence: 0.9 },
  { type: 'window',     x_pct: pctW(8.0), y_pct: pctH(7.6), w_pct: pctW(1.2), h_pct: pctH(1.2), confidence: 0.9 },
  { type: 'window',     x_pct: pctW(4.0), y_pct: pctH(4.4), w_pct: pctW(1.2), h_pct: pctH(1.2), confidence: 0.9 },
  { type: 'window',     x_pct: pctW(8.0), y_pct: pctH(4.4), w_pct: pctW(1.2), h_pct: pctH(1.2), confidence: 0.9 },
  { type: 'roof',       x_pct: pctW(3.0), y_pct: pctH(1.0), w_pct: pctW(7.4), h_pct: pctH(2.4), confidence: 0.9 },
  { type: 'analysis',   summary: 'A semi.', era: 'inter-war', wallMaterial: 'red-brick' },
];

test('door method recovers the real-world dimensions it was built from', () => {
  const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(r.method, 'door');

  // Ground truth: 7 × 6 = 42 m² front, minus one door (1.78) and four
  // windows (1.44 each) = 34.46 m², then × 2.4 for a semi.
  const trueFront = 42 - (0.9 * 1.98) - 4 * (1.2 * 1.2);
  const expected = trueFront * HOUSE_TYPE_PRIORS.semi.frontToTotal;
  assert.ok(Math.abs(r.m2 - expected) < 1, `got ${r.m2}, expected ≈ ${expected.toFixed(1)}`);
});

test('door method is independent of how far away the photo was taken', () => {
  // Same house, homeowner stood closer: every box scales up by 1.4 about the
  // frame. The metres-per-pixel scale changes with it, so the answer must not.
  const zoom = (d) => d.type === 'analysis' ? d : {
    ...d,
    x_pct: 50 + (d.x_pct - 50) * 1.4, y_pct: 50 + (d.y_pct - 50) * 1.4,
    w_pct: d.w_pct * 1.4, h_pct: d.h_pct * 1.4,
  };
  const near = estimateWallArea({ detections: semiPhoto.map(zoom), aspectRatio: ASPECT_4_3, houseType: 'semi' });
  const far = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(near.method, 'door');
  // Within a metre or two — clamping of boxes at the frame edge costs a little.
  assert.ok(Math.abs(near.m2 - far.m2) <= 3, `near ${near.m2} vs far ${far.m2}`);
});

test('falls back to the prior when the result is outside the house-type band', () => {
  // A tiny door box inflates metres-per-pixel enormously.
  const badDoor = semiPhoto.map(d => d.type === 'door-front' ? { ...d, h_pct: 4 } : d);
  const r = estimateWallArea({ detections: badDoor, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(r.method, 'prior');
  assert.strictEqual(r.m2, HOUSE_TYPE_PRIORS.semi.wallM2);
  assert.ok(r.notes.some(n => n.includes('outside')), 'should explain why');
});

test('no door: uses coverage when framing is plausible', () => {
  // Walls at 53% × 53% ≈ 28% coverage — mid-band for a semi.
  const noDoor = [{ type: 'cladding', x_pct: 20, y_pct: 25, w_pct: 53, h_pct: 53, confidence: 0.9 }];
  const r = estimateWallArea({ detections: noDoor, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(r.method, 'coverage');
  assert.ok(r.m2 > 55 && r.m2 < 130, `m2 was ${r.m2}`);
});

test('no door: rejects coverage when the photo is framed too close', () => {
  // 45% coverage — the exact case the prototype flags as wrong for a semi.
  const tooClose = [{ type: 'cladding', x_pct: 10, y_pct: 10, w_pct: 75, h_pct: 60, confidence: 0.9 }];
  const r = estimateWallArea({ detections: tooClose, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(r.method, 'prior');
  assert.ok(r.notes.some(n => n.includes('too close')), r.notes.join(' | '));
});

test('no walls detected falls back to the prior', () => {
  const r = estimateWallArea({ detections: [{ type: 'roof', x_pct: 0, y_pct: 0, w_pct: 50, h_pct: 20 }], aspectRatio: ASPECT_4_3, houseType: 'detached' });
  assert.strictEqual(r.method, 'prior');
  assert.strictEqual(r.m2, HOUSE_TYPE_PRIORS.detached.wallM2);
});

test('house type changes the prior and the multiplier', () => {
  const forType = (t) => estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: t }).m2;
  assert.ok(forType('detached') > forType('semi'), 'detached should exceed semi');
  assert.ok(forType('semi') > forType('terrace'), 'semi should exceed terrace');
});

test('unknown or missing house type falls back to semi, never throws', () => {
  const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'castle' });
  assert.strictEqual(r.houseType, 'semi');
  assert.doesNotThrow(() => estimateWallArea({}));
});

test('malformed detections never produce NaN', () => {
  const junk = [
    { type: 'cladding', x_pct: 'abc', y_pct: null, w_pct: undefined, h_pct: NaN },
    { type: 'door-front', x_pct: 10, y_pct: 10, w_pct: 0, h_pct: -5 },
    null, undefined, 'nonsense', 42,
  ];
  const r = estimateWallArea({ detections: junk, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.ok(Number.isFinite(r.m2) && Number.isFinite(r.low) && Number.isFinite(r.high));
  assert.strictEqual(r.method, 'prior');
});

test('missing aspect ratio skips the door method rather than guessing', () => {
  const r = estimateWallArea({ detections: semiPhoto, houseType: 'semi' });
  assert.notStrictEqual(r.method, 'door');
});

test('always returns a low < m2 < high range', () => {
  for (const t of ['detached', 'semi', 'terrace']) {
    const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: t });
    assert.ok(r.low < r.m2 && r.m2 < r.high, `${t}: ${r.low}/${r.m2}/${r.high}`);
  }
});

test('survey-table calibration factors and coverage centres are wired through', () => {
  const { tuningFor, HOUSE_TYPE_PRIORS: P } = require('../measure');
  const expected = {
    terrace:  { factor: 277, centre: 0.18 },
    semi:     { factor: 303, centre: 0.28 },
    detached: { factor: 342, centre: 0.38 },
  };
  for (const [type, want] of Object.entries(expected)) {
    assert.strictEqual(P[type].calibrationFactor, want.factor, `${type} factor`);
    assert.strictEqual(P[type].coverageCentre, want.centre, `${type} coverage centre`);
    const t = tuningFor(type, undefined);
    // Default tolerance is ±0.04 either side of the centre.
    assert.ok(Math.abs(t.coverageBand[0] - (want.centre - 0.04)) < 1e-9, `${type} band low`);
    assert.ok(Math.abs(t.coverageBand[1] - (want.centre + 0.04)) < 1e-9, `${type} band high`);
  }
});

test('the survey table is internally consistent: centre × factor ≈ the prior', () => {
  // A good check that the numbers belong together — each type's mid-band
  // coverage should land on that type's typical wall area.
  for (const [type, p] of Object.entries(HOUSE_TYPE_PRIORS)) {
    const implied = p.coverageCentre * p.calibrationFactor;
    assert.ok(Math.abs(implied - p.wallM2) <= 1,
      `${type}: ${p.coverageCentre} × ${p.calibrationFactor} = ${implied.toFixed(1)}, prior is ${p.wallM2}`);
  }
});

test('coverage uses the factor for the house type, not one shared number', () => {
  // Same photo, same coverage — only the house type differs, so the results
  // must differ by the ratio of the two calibration factors.
  const walls = (pct) => [{ type: 'cladding', x_pct: 10, y_pct: 10, w_pct: pct, h_pct: pct, confidence: 0.9 }];
  const semi = estimateWallArea({ detections: walls(52.9), aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(semi.method, 'coverage');
  assert.ok(Math.abs(semi.m2 - 0.28 * 303) < 3, `semi coverage gave ${semi.m2}`);

  // 0.38 coverage -> detached band; ×342 should land near the 130 prior.
  const detached = estimateWallArea({ detections: walls(61.6), aspectRatio: ASPECT_4_3, houseType: 'detached' });
  assert.strictEqual(detached.method, 'coverage');
  assert.ok(Math.abs(detached.m2 - 0.38 * 342) < 4, `detached coverage gave ${detached.m2}`);
});

test('env tuning overrides the table per house type', () => {
  const walls = [{ type: 'cladding', x_pct: 10, y_pct: 10, w_pct: 52.9, h_pct: 52.9, confidence: 0.9 }];
  const base = estimateWallArea({ detections: walls, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  const tuned = estimateWallArea({
    detections: walls, aspectRatio: ASPECT_4_3, houseType: 'semi',
    tuning: { calibration: { semi: 400 }, coverageCentre: {}, coverageTolerance: 0.04 },
  });
  assert.ok(tuned.m2 > base.m2, `override should raise the figure: ${base.m2} -> ${tuned.m2}`);
  assert.ok(Math.abs(tuned.m2 - 0.28 * 400) < 4, `tuned gave ${tuned.m2}`);
});

test('a wider coverage tolerance accepts framing the default band rejects', () => {
  // 0.34 coverage: outside semi's 0.24–0.32, inside 0.20–0.36.
  const walls = [{ type: 'cladding', x_pct: 5, y_pct: 5, w_pct: 58.3, h_pct: 58.3, confidence: 0.9 }];
  const strict = estimateWallArea({ detections: walls, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(strict.method, 'prior');
  const lenient = estimateWallArea({
    detections: walls, aspectRatio: ASPECT_4_3, houseType: 'semi',
    tuning: { coverageTolerance: 0.08 },
  });
  assert.strictEqual(lenient.method, 'coverage');
});

test('front-to-total is exposed perimeter ÷ frontage, and height cancels', () => {
  const { frontToTotalFrom, PLAN_GEOMETRY, HOUSE_TYPE_PRIORS: P } = require('../measure');

  // Mid-terrace: both side walls are party walls, so front + rear only.
  // This one is exact geometry, independent of every other input.
  assert.strictEqual(P.terrace.frontToTotal, 2);

  // The others follow from depth/frontage.
  for (const [type, plan] of Object.entries(PLAN_GEOMETRY)) {
    const depth = (plan.floorAreaM2 / plan.storeys) / plan.frontageM;
    const dw = depth / plan.frontageM;
    const expected = plan.exposed === '2W' ? 2 : plan.exposed === '2W+D' ? 2 + dw : 2 + 2 * dw;
    assert.ok(Math.abs(P[type].frontToTotal - expected) < 1e-9, `${type}`);
  }

  // Wall height cancels out of the ratio, so doubling it changes nothing.
  const tall = { ...PLAN_GEOMETRY.semi };
  assert.strictEqual(frontToTotalFrom(tall), frontToTotalFrom({ ...tall }));

  // Ordering must hold: mid-terrace < semi < end-terrace < detached.
  assert.ok(P.terrace.frontToTotal < P.semi.frontToTotal);
  assert.ok(P.semi.frontToTotal < P.endTerrace.frontToTotal);
  assert.ok(P.endTerrace.frontToTotal < P.detached.frontToTotal);
});

test('end-of-terrace is treated as its own type, far from mid-terrace', () => {
  const { HOUSE_TYPE_PRIORS: P } = require('../measure');
  const gap = (P.endTerrace.frontToTotal - P.terrace.frontToTotal) / P.terrace.frontToTotal;
  assert.ok(gap > 0.5, `end vs mid terrace differ by only ${(gap * 100).toFixed(0)}%`);

  const mid = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'terrace' });
  const end = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'endTerrace' });
  assert.ok(end.m2 > mid.m2 * 1.3, `mid ${mid.m2} vs end ${end.m2}`);

  // The earlier version of this test asserted only that end > mid, which
  // passed while endTerrace was silently resolving to semi — semi is also
  // bigger than mid-terrace. Assert the identity, not just the magnitude.
  assert.strictEqual(end.houseType, 'endTerrace', 'must not silently become another type');
  assert.strictEqual(end.houseTypeLabel, 'End of terrace');
  const semi = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.notStrictEqual(end.m2, semi.m2, 'end-of-terrace must not equal semi');
});

test('every house type resolves to itself, whatever the casing or spacing', () => {
  const { HOUSE_TYPE_PRIORS: P } = require('../measure');
  // Round-trip each canonical key: the bug above was a key that could never
  // match itself.
  for (const key of Object.keys(P)) {
    const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: key });
    assert.strictEqual(r.houseType, key, `${key} must resolve to itself`);
  }
  const aliases = {
    'endTerrace': ['endTerrace', 'end terrace', 'End of Terrace', 'END-TERRACE', 'end_terrace'],
    'terrace': ['terrace', 'Terraced', 'mid-terrace', 'Mid Terrace'],
    'semi': ['semi', 'Semi-detached', 'SEMI DETACHED'],
    'detached': ['detached', 'Detached', 'detatched'],
  };
  for (const [canonical, forms] of Object.entries(aliases)) {
    for (const form of forms) {
      const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: form });
      assert.strictEqual(r.houseType, canonical, `"${form}" should resolve to ${canonical}`);
    }
  }
  // Genuinely unknown input still falls back rather than throwing.
  assert.strictEqual(estimateWallArea({ houseType: 'houseboat' }).houseType, 'semi');
});

test('geometry-derived multipliers agree with the priors within 15%', () => {
  // Independent cross-check: front elevation net of ~18% openings, times the
  // multiplier, should land near the house type's prior. Agreement between
  // two unrelated derivations is the strongest evidence available without
  // real survey data.
  const { HOUSE_TYPE_PRIORS: P } = require('../measure');
  const WALL_H = 5.2, NET = 0.82;
  for (const type of ['terrace', 'semi', 'detached']) {
    const p = P[type];
    const implied = p.plan.frontageM * WALL_H * NET * p.frontToTotal;
    const delta = Math.abs(implied - p.wallM2) / p.wallM2;
    assert.ok(delta < 0.15, `${type}: geometry implies ${implied.toFixed(0)} m², prior is ${p.wallM2} (${(delta * 100).toFixed(0)}% apart)`);
  }
});

test('front-to-total can be overridden per type', () => {
  const base = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  const tuned = estimateWallArea({
    detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'semi',
    tuning: { frontToTotal: { semi: 2.0 } },
  });
  assert.ok(tuned.m2 < base.m2, `override should lower it: ${base.m2} -> ${tuned.m2}`);
});

test('bungalows are modelled as single storey, not half a house', () => {
  const { PLAN_GEOMETRY: G, HOUSE_TYPE_PRIORS: P } = require('../measure');
  assert.strictEqual(G.bungalow.storeys, 1, 'the whole floor area is the footprint');

  // Treating a bungalow's floor area as two storeys would halve the footprint
  // and understate the walls. Check the single-storey depth is what's used.
  const depth = G.bungalow.floorAreaM2 / G.bungalow.storeys / G.bungalow.frontageM;
  assert.ok(Math.abs(depth - 7.7) < 0.1, `depth was ${depth.toFixed(2)}`);
  assert.ok(Math.abs(P.bungalow.frontToTotal - (2 + 2 * depth / G.bungalow.frontageM)) < 1e-9);

  // A bungalow has less wall than a two-storey detached, more than a mid-terrace.
  assert.ok(P.bungalow.wallM2 < P.detached.wallM2);
  assert.ok(P.bungalow.wallM2 > P.terrace.wallM2);
  assert.strictEqual(estimateWallArea({ houseType: 'Bungalow' }).houseType, 'bungalow');
});

test('a single-storey photo warns when a two-storey type is selected', () => {
  // Same 7 m frontage, but the wall is only ~2.5 m tall — a bungalow shape.
  const FRAME_H = 10, aspect = ASPECT_4_3, FRAME_W = FRAME_H * aspect;
  const w = (m) => (m / FRAME_W) * 100, hh = (m) => (m / FRAME_H) * 100;
  const singleStorey = [
    { type: 'cladding',   x_pct: w(3), y_pct: hh(6),   w_pct: w(10), h_pct: hh(2.5), confidence: 0.9 },
    { type: 'door-front', x_pct: w(7), y_pct: hh(6.5), w_pct: w(0.9), h_pct: hh(1.98), confidence: 0.95 },
  ];
  const asSemi = estimateWallArea({ detections: singleStorey, aspectRatio: aspect, houseType: 'semi' });
  assert.ok(asSemi.notes.some(n => /single-storey/i.test(n)), asSemi.notes.join(' | '));

  const asBungalow = estimateWallArea({ detections: singleStorey, aspectRatio: aspect, houseType: 'bungalow' });
  assert.ok(!asBungalow.notes.some(n => /single-storey/i.test(n)), 'no warning when the type already matches');
});

test('a two-storey photo warns when bungalow is selected', () => {
  const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'bungalow' });
  assert.ok(r.notes.some(n => /more than one storey/i.test(n)), r.notes.join(' | '));
});

test('the two methods cross-check each other when both are available', () => {
  const r = estimateWallArea({ detections: semiPhoto, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(r.method, 'door');
  assert.ok(r.crossCheck, 'coverage should also have been computed');
  assert.ok(r.crossCheck.coverageM2 > 0);
  assert.strictEqual(r.crossCheck.agrees, true, `methods differ by ${r.crossCheck.differencePct}%`);
  assert.strictEqual(r.confidence, 'good');
  assert.ok(r.notes.some(n => /second way/i.test(n)), r.notes.join(' | '));
});

test('a door reading the second method contradicts is not called "good"', () => {
  // Just the wall and a door: no windows are subtracted, so the door method
  // overshoots while coverage stays where it was. In-band, so the clamp
  // doesn't mask the disagreement.
  const FRAME_H = 10, aspect = ASPECT_4_3, FRAME_W = FRAME_H * aspect;
  const w = (m) => (m / FRAME_W) * 100, hh = (m) => (m / FRAME_H) * 100;
  const sparse = [
    { type: 'cladding',   x_pct: w(3.2), y_pct: hh(3.4), w_pct: w(7),   h_pct: hh(6), confidence: 0.9 },
    { type: 'door-front', x_pct: w(6.2), y_pct: hh(7.4), w_pct: w(0.9), h_pct: hh(1.98), confidence: 0.95 },
  ];
  const r = estimateWallArea({ detections: sparse, aspectRatio: aspect, houseType: 'semi' });
  assert.strictEqual(r.method, 'door');
  assert.strictEqual(r.crossCheck.agrees, false);
  assert.strictEqual(r.confidence, 'rough', 'a contradicted reading must not claim good confidence');

  // And the range must widen enough to still cover what the other method said.
  const agreed = estimateWallArea({ detections: semiPhoto, aspectRatio: aspect, houseType: 'semi' });
  const spreadOf = (x) => (x.high - x.low) / x.m2;
  assert.ok(spreadOf(r) > spreadOf(agreed), 'disagreement should widen the range');
  assert.ok(r.low <= r.crossCheck.coverageM2 && r.crossCheck.coverageM2 <= r.high,
    `range ${r.low}-${r.high} should cover the other method's ${r.crossCheck.coverageM2}`);
});

test('no cross-check is claimed when only one method could run', () => {
  // No door, so nothing to cross-check against.
  const noDoor = [{ type: 'cladding', x_pct: 20, y_pct: 25, w_pct: 53, h_pct: 53, confidence: 0.9 }];
  const r = estimateWallArea({ detections: noDoor, aspectRatio: ASPECT_4_3, houseType: 'semi' });
  assert.strictEqual(r.method, 'coverage');
  assert.strictEqual(r.crossCheck, null);
});

test('end-of-terrace is anchored to the surveyed mid-terrace, not guessed', () => {
  const { HOUSE_TYPE_PRIORS: P, PLAN_GEOMETRY: G } = require('../measure');
  // Same house, one more exposed wall: end = mid × (2 + D/W) / 2.
  const t = G.terrace;
  const dw = ((t.floorAreaM2 / t.storeys) / t.frontageM) / t.frontageM;
  const expected = P.terrace.wallM2 * (2 + dw) / 2;
  assert.ok(Math.abs(P.endTerrace.wallM2 - expected) < 1.5,
    `expected ≈${expected.toFixed(1)} from the surveyed ${P.terrace.wallM2}, got ${P.endTerrace.wallM2}`);
  // And the table stays self-consistent.
  assert.ok(Math.abs(P.endTerrace.coverageCentre * P.endTerrace.calibrationFactor - P.endTerrace.wallM2) <= 1);
});

test('imageSize reads PNG and JPEG dimensions', () => {
  // 16×9 PNG: signature, then IHDR length/type/width/height.
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0, 0, 0, 13]), Buffer.from('IHDR'),
    (() => { const b = Buffer.alloc(8); b.writeUInt32BE(16, 0); b.writeUInt32BE(9, 4); return b; })(),
  ]);
  assert.deepStrictEqual(imageSize(png), { width: 16, height: 9 });

  // Minimal JPEG: SOI, then an SOF0 declaring 480 high × 640 wide.
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(480, 5); sof.writeUInt16BE(640, 7);
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(16)]);
  assert.deepStrictEqual(imageSize(jpeg), { width: 640, height: 480 });

  assert.strictEqual(imageSize(Buffer.from('not an image')), null);
  assert.strictEqual(imageSize(null), null);
});

/* ── the fanlight ────────────────────────────────────────────────────────
   A doorway with a fanlight above it is one of the commonest things on a
   Victorian or Edwardian terrace, and the front door is the 1.98 m ruler that
   every other measurement on the house is taken against.

   If the fanlight lands inside the door box, that box is about 29% taller than
   the leaf. Wall area goes as the SQUARE of the door height, so the error
   compounds: measured before the fix, 77 m² of terrace read as 46 m² — a 40%
   under-measurement, silently, on a house type the product is aimed at. */

const terrace = (doorHeightM) => ([
  { type: 'cladding',   label: 'Front wall', confidence: 0.9,  x_pct: pctW(3.2), y_pct: pctH(3.4), w_pct: pctW(7),   h_pct: pctH(6) },
  { type: 'door-front', label: 'Front door', confidence: 0.94, x_pct: pctW(6.2), y_pct: pctH(7.4), w_pct: pctW(0.9), h_pct: pctH(doorHeightM) },
  { type: 'window',     label: 'W',          confidence: 0.9,  x_pct: pctW(4.0), y_pct: pctH(7.6), w_pct: pctW(1.4), h_pct: pctH(1.3) },
]);

const areaOf = (r) => r.totalM2 ?? r.m2 ?? r.frontM2;

test('the door-shaped box is preferred over the tallest one', () => {
  /* The model may offer the doorway both ways. Taking the taller made the
     fanlight the ruler; taking the most door-shaped does not. */
  const leafOnly = estimateWallArea({ detections: terrace(1.98), aspectRatio: ASPECT_4_3, houseType: 'terrace' });
  const both = estimateWallArea({
    detections: [...terrace(1.98), {
      type: 'door-front', label: 'Door with fanlight', confidence: 0.91,
      x_pct: pctW(6.2), y_pct: pctH(6.83), w_pct: pctW(0.9), h_pct: pctH(2.55),
    }],
    aspectRatio: ASPECT_4_3, houseType: 'terrace',
  });

  const drift = Math.abs(areaOf(both) - areaOf(leafOnly)) / areaOf(leafOnly);
  assert.ok(drift < 0.05,
    `a fanlight box should not move the survey: ${areaOf(leafOnly).toFixed(1)} m² against ${areaOf(both).toFixed(1)} m²`);
});

test('a hole is not subtracted twice because it was detected twice', () => {
  /* Openings were summed with no overlap handling, so a doorway returned as
     leaf and as leaf-plus-fanlight lost its area from the wall twice — as
     would a bay returned once whole and again as its three lights. */
  const once = estimateWallArea({ detections: terrace(1.98), aspectRatio: ASPECT_4_3, houseType: 'terrace' });
  const twice = estimateWallArea({
    detections: [...terrace(1.98), {
      type: 'door-front', label: 'Front door again', confidence: 0.9,
      x_pct: pctW(6.2), y_pct: pctH(7.4), w_pct: pctW(0.9), h_pct: pctH(1.98),
    }],
    aspectRatio: ASPECT_4_3, houseType: 'terrace',
  });
  assert.ok(Math.abs(areaOf(twice) - areaOf(once)) < 0.51,
    `the same door twice must not remove its area twice: ${areaOf(once).toFixed(1)} against ${areaOf(twice).toFixed(1)}`);
});

