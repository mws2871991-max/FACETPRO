#!/usr/bin/env node
/* Validate wall-area estimation against properties with known wall areas.
   Run: npm run validate  [path/to/samples.json]

   The calibration currently in measure.js is derived — from plan geometry and
   published housing-stock averages — not measured. This is how you replace
   that with evidence: collect real properties whose wall area you know from a
   survey, put them in a samples file, and run this.

   It reports per-sample error, bias and spread per house type, and the
   multiplier each sample implies, so a systematic offset is obvious.

   Two kinds of sample, both optional per entry:

   1. `detections` + `aspectRatio` — the real thing. Take what /api/detect
      returned for that property's photo and paste it in. Exercises the whole
      pipeline including detection quality.
   2. `frontageM` + `depthM` + `storeys` — geometry only. Checks the
      front-to-total multiplier in isolation, without detection error muddying
      it. Useful when you have a floor plan but not a photo.

   See data/survey-samples.example.json for the format. */

'use strict';

const fs = require('fs');
const path = require('path');
const measure = require('../measure');

const file = process.argv[2] || path.join(__dirname, '..', 'data', 'survey-samples.json');

if (!fs.existsSync(file)) {
  console.log(`No samples file at ${path.relative(process.cwd(), file)}.\n`);
  console.log('Copy data/survey-samples.example.json to data/survey-samples.json and');
  console.log('fill it with real properties whose wall area you know.\n');
  console.log('Until then the calibration in measure.js is derived, not validated —');
  console.log('see the accuracy caveats in the README.');
  process.exit(0);
}

let samples;
try {
  samples = JSON.parse(fs.readFileSync(file, 'utf8'));
} catch (err) {
  console.error(`Could not read ${file}: ${err.message}`);
  process.exit(1);
}
if (!Array.isArray(samples)) {
  console.error('The samples file must contain a JSON array.');
  process.exit(1);
}

// Entries exist purely to carry a `comment` in the template; a real sample is
// one that states an actual surveyed area. Filtering on the data rather than
// on the presence of a comment lets real samples stay annotated.
const real = samples.filter(s => s && s.knownWallAreaM2 !== undefined);
if (!real.length) {
  console.log('The samples file has no real entries yet — nothing to validate.');
  process.exit(0);
}

const pct = (n) => `${n >= 0 ? '+' : ''}${(n * 100).toFixed(1)}%`;
const rows = [];

for (const s of real) {
  const known = Number(s.knownWallAreaM2);
  if (!Number.isFinite(known) || known <= 0) {
    console.warn(`Skipping "${s.label || 'unlabelled'}": knownWallAreaM2 is missing or not a positive number.`);
    continue;
  }
  const type = s.houseType;
  const prior = measure.HOUSE_TYPE_PRIORS[type];
  if (!prior) {
    console.warn(`Skipping "${s.label}": unknown houseType "${type}". Expected one of ${Object.keys(measure.HOUSE_TYPE_PRIORS).join(', ')}.`);
    continue;
  }

  const row = { label: s.label || '(unlabelled)', type, known };

  if (Array.isArray(s.detections) && s.detections.length) {
    const est = measure.estimateWallArea({
      detections: s.detections,
      aspectRatio: Number(s.aspectRatio) || null,
      houseType: type,
    });
    row.estimated = est.m2;
    row.method = est.method;
    row.error = (est.m2 - known) / known;
    row.inRange = known >= est.low && known <= est.high;
  }

  // What multiplier would this property have needed? Compares directly with
  // the value in use, which is the single most useful number here.
  if (Number.isFinite(Number(s.frontageM)) && Number.isFinite(Number(s.depthM))) {
    const W = Number(s.frontageM), D = Number(s.depthM);
    const storeys = Number(s.storeys) || 2;
    const heightM = Number(s.wallHeightM) || storeys * 2.6;
    const frontGross = W * heightM;
    row.impliedRatio = known / frontGross;
  }

  rows.push(row);
}

if (!rows.length) {
  console.log('No usable samples.');
  process.exit(0);
}

console.log(`\nValidating ${rows.length} propert${rows.length === 1 ? 'y' : 'ies'} against measure.js\n`);
console.log('property                     type         known   est   method    error   in range');
console.log('─'.repeat(84));
for (const r of rows) {
  console.log(
    String(r.label).slice(0, 26).padEnd(28),
    String(r.type).padEnd(12),
    String(r.known).padStart(5),
    String(r.estimated ?? '—').padStart(5),
    String(r.method ?? '—').padEnd(9),
    (r.error === undefined ? '—' : pct(r.error)).padStart(7),
    (r.inRange === undefined ? '  —' : r.inRange ? '  yes' : '  NO').padStart(9)
  );
}

const withError = rows.filter(r => r.error !== undefined);
if (withError.length) {
  const errors = withError.map(r => r.error);
  const mean = errors.reduce((a, b) => a + b, 0) / errors.length;
  const absMean = errors.reduce((a, b) => a + Math.abs(b), 0) / errors.length;
  const sd = Math.sqrt(errors.reduce((a, e) => a + (e - mean) ** 2, 0) / errors.length);
  const covered = withError.filter(r => r.inRange).length;

  console.log('\nOverall');
  console.log(`  bias (mean error)      ${pct(mean)}   ${Math.abs(mean) > 0.1 ? '<- systematic, worth correcting' : ''}`);
  console.log(`  mean absolute error    ${(absMean * 100).toFixed(1)}%`);
  console.log(`  spread (sd)            ${(sd * 100).toFixed(1)}%`);
  console.log(`  inside quoted range    ${covered}/${withError.length}`);
}

// Per-type implied multipliers — the thing most in need of evidence.
const byType = {};
for (const r of rows) {
  if (r.impliedRatio === undefined) continue;
  (byType[r.type] ||= []).push(r.impliedRatio);
}
if (Object.keys(byType).length) {
  console.log('\nFront-to-total multiplier: in use vs implied by these properties');
  console.log('  type          in use   implied (mean)   n');
  for (const [type, ratios] of Object.entries(byType)) {
    const mean = ratios.reduce((a, b) => a + b, 0) / ratios.length;
    const inUse = measure.HOUSE_TYPE_PRIORS[type].frontToTotal;
    const delta = (mean - inUse) / inUse;
    console.log(
      '  ' + type.padEnd(13),
      inUse.toFixed(2).padStart(6),
      mean.toFixed(2).padStart(15),
      String(ratios.length).padStart(3),
      Math.abs(delta) > 0.1 ? `   <- ${pct(delta)}, consider updating PLAN_GEOMETRY` : ''
    );
  }
  console.log('\n  A consistent gap here is the multiplier being wrong, not the photo.');
}

console.log('');
