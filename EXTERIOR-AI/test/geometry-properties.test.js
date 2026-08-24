/* Adversarial and property-based tests for the measurer.

   From the August 2026 code audit: "Traditional example-based tests can miss
   unusual combinations of geometry, missing doors, occlusion and unusual house
   forms. Generate randomized valid/invalid measurements and assert invariants
   such as non-negative areas, sane totals, stable ordering and no impossible
   overlaps."

   The existing measurement tests are example-based and good at the cases
   somebody thought of. This file is for the ones nobody did. It asserts
   properties that must hold for every input rather than outputs for particular
   ones, which is the only way to cover a space this shape: a detection list is
   arbitrary-length, arbitrary-order, and every field can be absent, null, NaN,
   negative, enormous, or the wrong type entirely.

   Seeded, not random. A property test that fails once and passes on re-run
   tells you nothing and gets deleted; every case here is reproducible from its
   seed, and a failure prints the seed and the input that broke it. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const measure = require('../measure');
const geometry = require('../geometry');

/* mulberry32 — small, fast, and deterministic from a seed. Node has no seeded
   RNG, and Math.random cannot be used here for the reason in the header. */
function rng(seed) {
  return function next() {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HOUSE_TYPES = Object.keys(measure.HOUSE_TYPE_PRIORS);
const TYPES = ['cladding', 'window', 'door-front'];

/* Values chosen to sit on the edges the code has to survive: zero, negative,
   absurd, non-finite, and the wrong type. A generator that only produces
   plausible numbers tests the happy path with extra steps. */
const HOSTILE = [
  0, -1, -0.0001, 100.0001, 1e9, -1e9, NaN, Infinity, -Infinity,
  null, undefined, '', 'x', '42', true, [], {},
];

function randomDetection(r, { hostile = false } = {}) {
  const pick = (arr) => arr[Math.floor(r() * arr.length)];
  const num = () => (hostile && r() < 0.45 ? pick(HOSTILE) : r() * 100);
  const d = {
    type: hostile && r() < 0.2 ? pick([...TYPES, 'roof', '', null, undefined, 42]) : pick(TYPES),
    x_pct: num(), y_pct: num(), w_pct: num(), h_pct: num(),
  };
  // Sometimes drop a field entirely — absent is not the same as invalid.
  if (hostile && r() < 0.15) delete d[pick(['x_pct', 'y_pct', 'w_pct', 'h_pct', 'type'])];
  return d;
}

function randomCase(r, { hostile = false } = {}) {
  const n = Math.floor(r() * 12);
  return {
    detections: Array.from({ length: n }, () => randomDetection(r, { hostile })),
    aspectRatio: hostile && r() < 0.3
      ? HOSTILE[Math.floor(r() * HOSTILE.length)]
      : 0.3 + r() * 3,
    houseType: hostile && r() < 0.2
      ? [null, undefined, '', 'mansion', 42][Math.floor(r() * 5)]
      : HOUSE_TYPES[Math.floor(r() * HOUSE_TYPES.length)],
  };
}

const show = (seed, i, input) =>
  `seed ${seed}, case ${i}\n${JSON.stringify(input, (_k, v) => (Number.isNaN(v) ? 'NaN' : v), 1)}`;

/* ── the invariants ── */

test('an estimate is always a positive, finite, sane number — 2000 hostile inputs', () => {
  const seed = 20260824;
  const r = rng(seed);
  for (let i = 0; i < 2000; i++) {
    const input = randomCase(r, { hostile: true });
    let out;
    /* Never throwing is itself the first property. This runs behind
       /api/measure, and an exception here is a 500 for a homeowner who did
       nothing wrong but upload an awkward photograph. */
    try {
      out = measure.estimateWallArea(input);
    } catch (err) {
      assert.fail(`estimateWallArea threw: ${err.message}\n${show(seed, i, input)}`);
    }

    const ctx = () => show(seed, i, input);
    assert.ok(Number.isFinite(out.m2), `m2 not finite: ${out.m2}\n${ctx()}`);
    assert.ok(out.m2 > 0, `m2 not positive: ${out.m2}\n${ctx()}`);
    assert.ok(Number.isFinite(out.low) && out.low > 0, `low: ${out.low}\n${ctx()}`);
    assert.ok(Number.isFinite(out.high), `high: ${out.high}\n${ctx()}`);

    /* A range that does not contain its own estimate is worse than no range:
       the page shows both, and a homeowner reading "£27,000 (£30,000–£34,000)"
       has caught us being incoherent. */
    assert.ok(out.low <= out.m2 && out.m2 <= out.high,
      `range does not contain the estimate: ${out.low} <= ${out.m2} <= ${out.high}\n${ctx()}`);

    assert.ok(['door', 'coverage', 'prior'].includes(out.method), `method ${out.method}\n${ctx()}`);
    assert.ok(['good', 'rough', 'typical figure'].includes(out.confidence),
      `confidence ${out.confidence}\n${ctx()}`);
  }
});

test('no estimate ever escapes the band for its house type', () => {
  /* The band exists so a wildly wrong number is never given confidently. It
     clamps to the prior, and every prior sits inside its own band — so the
     returned figure is in range whichever path produced it. If this ever
     fails, a homeowner has been shown a number the system itself considers
     implausible. */
  const seed = 8724;
  const r = rng(seed);
  for (let i = 0; i < 2000; i++) {
    const input = randomCase(r, { hostile: true });
    const out = measure.estimateWallArea(input);
    const [lo, hi] = measure.HOUSE_TYPE_PRIORS[out.houseType].band;
    assert.ok(out.m2 >= lo && out.m2 <= hi,
      `${out.m2} m² outside ${lo}–${hi} for ${out.houseType} via ${out.method}\n${show(seed, i, input)}`);
  }
});

test('the order detections arrive in does not change the answer', () => {
  /* The detector returns elements in whatever order the model emitted them,
     which is not stable between runs on the same photograph. If the measurer
     is order-sensitive anywhere — a first-match, a reduce that keeps the
     earliest, a min/max that ties — then the same house measures differently
     on a retry, and the homepage's promise that the same house gets the same
     starting point is not true. */
  const seed = 99137;
  const r = rng(seed);
  for (let i = 0; i < 800; i++) {
    const input = randomCase(r);
    const straight = measure.estimateWallArea(input);

    const shuffled = input.detections.slice();
    for (let j = shuffled.length - 1; j > 0; j--) {
      const k = Math.floor(r() * (j + 1));
      [shuffled[j], shuffled[k]] = [shuffled[k], shuffled[j]];
    }
    const reordered = measure.estimateWallArea({ ...input, detections: shuffled });

    assert.strictEqual(reordered.m2, straight.m2,
      `reordering changed the estimate: ${straight.m2} -> ${reordered.m2}\n${show(seed, i, input)}`);
    assert.strictEqual(reordered.method, straight.method,
      `reordering changed the method\n${show(seed, i, input)}`);
  }
});

test('the same input measures the same twice — the function is pure', () => {
  const seed = 5150;
  const r = rng(seed);
  for (let i = 0; i < 500; i++) {
    const input = randomCase(r, { hostile: true });
    const a = measure.estimateWallArea(input);
    const b = measure.estimateWallArea(input);
    assert.deepStrictEqual(
      { m2: b.m2, method: b.method, confidence: b.confidence },
      { m2: a.m2, method: a.method, confidence: a.confidence },
      `two identical calls disagreed\n${show(seed, i, input)}`);
  }
});

test('a measurement never mutates the detections it was given', () => {
  /* The caller keeps this array — server.js hands the same record to /api/quote
     and /api/lead afterwards. A measurer that sorted in place would corrupt
     what the next endpoint reads. */
  const seed = 3312;
  const r = rng(seed);
  for (let i = 0; i < 500; i++) {
    const input = randomCase(r, { hostile: true });
    const before = JSON.stringify(input.detections, (_k, v) => (Number.isNaN(v) ? 'NaN' : v));
    measure.estimateWallArea(input);
    const after = JSON.stringify(input.detections, (_k, v) => (Number.isNaN(v) ? 'NaN' : v));
    assert.strictEqual(after, before, `detections were mutated\n${show(seed, i, input)}`);
  }
});

test('the observation recorded for calibration is never junk', () => {
  /* These rows are the only evidence that could ever revise MIN_DOOR_RATIO and
     the bands. A NaN or a negative written into measurement_observations is
     worse than a missing row: it silently skews the figure the thresholds are
     eventually set from. */
  const seed = 71104;
  const r = rng(seed);
  for (let i = 0; i < 2000; i++) {
    const input = randomCase(r, { hostile: true });
    const { observed } = measure.estimateWallArea(input);
    const ctx = () => show(seed, i, input);

    assert.ok(Number.isInteger(observed.doorBoxes) && observed.doorBoxes >= 0,
      `doorBoxes ${observed.doorBoxes}\n${ctx()}`);
    for (const field of ['doorRatio', 'doorHeightPct']) {
      const v = observed[field];
      assert.ok(v === null || (Number.isFinite(v) && v > 0),
        `${field} is ${v} — must be null or a positive number\n${ctx()}`);
    }
    if (observed.rejected) {
      assert.ok(Number.isFinite(observed.rejected.m2), `rejected.m2\n${ctx()}`);
      assert.ok(['above', 'below'].includes(observed.rejected.side), `rejected.side\n${ctx()}`);
    }
  }
});

/* ── the geometry primitives underneath ── */

test('box() either returns a clamped box inside the frame, or null', () => {
  const seed = 40404;
  const r = rng(seed);
  for (let i = 0; i < 3000; i++) {
    const d = randomDetection(r, { hostile: true });
    const b = geometry.box(d);
    if (b === null) continue;
    for (const k of ['x', 'y', 'w', 'h']) {
      assert.ok(Number.isFinite(b[k]) && b[k] >= 0 && b[k] <= 100,
        `box.${k} = ${b[k]} escaped 0–100\n${show(seed, i, d)}`);
    }
    assert.ok(b.w > 0 && b.h > 0, `a zero-area box was accepted\n${show(seed, i, d)}`);
  }
});

test('an overlap is never impossible: symmetric, and no larger than either box', () => {
  /* `intersectionPct` returns an AREA in square percentage-points (w × h, so
     up to 10,000), not a 0–100 percentage. The name says otherwise and cost
     this test a wrong assertion on its first run — worth knowing before
     reading measure.js, where the one caller does the right thing and
     multiplies by a scale factor to reach m².

     The properties below are the ones that actually matter. An overlap larger
     than one of its own boxes is the "impossible overlap" the audit asked
     about: subtracted from the wall it would produce a negative elevation, and
     a negative elevation priced is a free house. */
  const seed = 60606;
  const r = rng(seed);
  const areaOf = (b) => b.w * b.h;

  for (let i = 0; i < 2000; i++) {
    const a = geometry.box(randomDetection(r, { hostile: true }));
    const b = geometry.box(randomDetection(r, { hostile: true }));
    if (!a || !b) continue;
    const ctx = `seed ${seed}, case ${i}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;

    const overlap = geometry.intersectionPct(a, b);
    assert.ok(Number.isFinite(overlap) && overlap >= 0, `overlap ${overlap} — ${ctx}`);
    assert.ok(overlap <= 100 * 100 + 1e-9, `overlap exceeds the whole frame — ${ctx}`);

    assert.ok(overlap <= areaOf(a) + 1e-9 && overlap <= areaOf(b) + 1e-9,
      `overlap ${overlap} exceeds a box it is inside (${areaOf(a)}, ${areaOf(b)}) — ${ctx}`);

    assert.ok(Math.abs(geometry.intersectionPct(b, a) - overlap) < 1e-9,
      `overlap is not symmetric — ${ctx}`);

    assert.ok(Math.abs(geometry.intersectionPct(a, a) - areaOf(a)) < 1e-9,
      `a box does not fully overlap itself — ${ctx}`);
  }
});
