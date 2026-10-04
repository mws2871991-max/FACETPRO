'use strict';
require('./helpers/data-dir');
/* 0084: roof from above — parsing and failure handling, no network. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { roofFromAbove, summarise } = require('../roofaerial');

const SAMPLE = {
  imageryQuality: 'HIGH', imageryDate: { year: 2024, month: 5, day: 1 }, center: { latitude: 51.9, longitude: 1.08 },
  solarPotential: {
    wholeRoofStats: { areaMeters2: 96.4, groundAreaMeters2: 78.2 },
    roofSegmentStats: [
      { pitchDegrees: 40, azimuthDegrees: 180, stats: { areaMeters2: 48.2, groundAreaMeters2: 36.9 } },
      { pitchDegrees: 40, azimuthDegrees: 0, stats: { areaMeters2: 48.2, groundAreaMeters2: 36.9 } },
    ],
  },
};
const fakeFetch = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('a roof is summarised: area, footprint, area-weighted pitch, segments, quality', () => {
  const s = summarise(SAMPLE);
  assert.deepStrictEqual([s.roofAreaM2, s.footprintM2, s.pitchDeg, s.segments, s.quality], [96.4, 78.2, 40, 2, 'HIGH']);
});

test('pitch is weighted by area, not averaged per segment', () => {
  const s = summarise({ solarPotential: { roofSegmentStats: [
    { pitchDegrees: 45, stats: { areaMeters2: 90 } }, { pitchDegrees: 5, stats: { areaMeters2: 10 } }] } });
  assert.strictEqual(s.pitchDeg, 41);
  assert.strictEqual(s.roofAreaM2, 100);
});

test('every failure is an answer, never a throw', async () => {
  assert.deepStrictEqual(await roofFromAbove({ lat: 1, lng: 1 }), { ok: false, reason: 'no key' });
  assert.strictEqual((await roofFromAbove({ key: 'k' })).reason, 'no location');
  assert.strictEqual((await roofFromAbove({ lat: 1, lng: 1, key: 'k', fetchImpl: fakeFetch(404, {}) })).reason, 'no building with imagery here');
  assert.strictEqual((await roofFromAbove({ lat: 1, lng: 1, key: 'k', fetchImpl: fakeFetch(403, {}) })).reason, 'solar api 403');
  assert.strictEqual((await roofFromAbove({ lat: 1, lng: 1, key: 'k', fetchImpl: async () => { throw new Error('boom'); } })).reason, 'boom');
  const ok = await roofFromAbove({ lat: 1, lng: 1, key: 'k', fetchImpl: fakeFetch(200, SAMPLE) });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.roofAreaM2, 96.4);
});

test('not wired into pricing or the page until it has been checked', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.doesNotMatch(server, /require\('\.\/roofaerial'\)/);
});
