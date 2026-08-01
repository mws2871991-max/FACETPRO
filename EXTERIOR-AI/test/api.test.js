/* End-to-end test of detect -> measure -> quote.

   The Anthropic call is stubbed, so this runs offline and costs nothing, but
   everything after it is the real server: the real detection record, the real
   geometry, the real price computation. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const PORT = 3099;
const BASE = `http://127.0.0.1:${PORT}`;

// A 4:3 photo of the same two-storey semi used in measure.test.js.
const FRAME_H_M = 10, ASPECT = 4 / 3, FRAME_W_M = FRAME_H_M * ASPECT;
const pctW = (m) => (m / FRAME_W_M) * 100;
const pctH = (m) => (m / FRAME_H_M) * 100;

const DETECTIONS = [
  { type: 'cladding',   label: 'Front wall', confidence: 0.9,  x_pct: pctW(3.2), y_pct: pctH(3.4), w_pct: pctW(7),   h_pct: pctH(6) },
  { type: 'door-front', label: 'Front door', confidence: 0.95, x_pct: pctW(6.2), y_pct: pctH(7.4), w_pct: pctW(0.9), h_pct: pctH(1.98) },
  { type: 'window',     label: 'Window',     confidence: 0.9,  x_pct: pctW(4.0), y_pct: pctH(7.6), w_pct: pctW(1.2), h_pct: pctH(1.2) },
  { type: 'window',     label: 'Window',     confidence: 0.9,  x_pct: pctW(8.0), y_pct: pctH(7.6), w_pct: pctW(1.2), h_pct: pctH(1.2) },
  { type: 'window',     label: 'Window',     confidence: 0.9,  x_pct: pctW(4.0), y_pct: pctH(4.4), w_pct: pctW(1.2), h_pct: pctH(1.2) },
  { type: 'window',     label: 'Window',     confidence: 0.9,  x_pct: pctW(8.0), y_pct: pctH(4.4), w_pct: pctW(1.2), h_pct: pctH(1.2) },
];

// Minimal JPEG whose SOF0 declares 640×480, giving the 4:3 the boxes assume.
function fakeJpegBase64(width = 640, height = 480) {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32)]).toString('base64');
}

// Intercept the Anthropic call; let everything else (our own server) through.
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify(DETECTIONS) }] }),
    };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';
process.env.INSTALLER_PASSWORD = 'test-pw';
delete process.env.RESEND_API_KEY;

require('../server');

const post = async (path, body) => {
  const res = await realFetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

let detectionId;

test('detect returns a detectionId and flags that measuring is possible', async () => {
  const { status, body } = await post('/api/detect', { image: fakeJpegBase64(), mimeType: 'image/jpeg' });
  assert.strictEqual(status, 200);
  assert.ok(body.detectionId, 'expected a detectionId');
  assert.strictEqual(body.canMeasure, true);
  assert.strictEqual(body.scaleReference, true, 'a door and a readable size means we have a scale');
  detectionId = body.detectionId;
});

test('measure returns a range, a method and a caveat', async () => {
  const { status, body } = await post('/api/measure', { detectionId, houseType: 'semi' });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.method, 'door');
  assert.ok(body.low < body.m2 && body.m2 < body.high, `${body.low}/${body.m2}/${body.high}`);
  assert.match(body.caveat, /not a survey/i);
  // Net front elevation is 42 - 1.78 - 5.76 = 34.46 m². The multiplier comes
  // from measure.js rather than being restated here: measure.test.js pins the
  // calibration, and this test is about the endpoint returning it correctly.
  const expected = 34.46 * require('../measure').HOUSE_TYPE_PRIORS.semi.frontToTotal;
  assert.ok(Math.abs(body.m2 - expected) < 2, `m2 was ${body.m2}, expected ≈ ${expected.toFixed(1)}`);
});

test('the quote uses the measured area once measuring has run', async () => {
  const { body } = await post('/api/quote', { claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', detectionId });
  assert.strictEqual(body.footprintSource, 'photo_door');
  const expected = 34.46 * require('../measure').HOUSE_TYPE_PRIORS.semi.frontToTotal;
  assert.ok(Math.abs(body.footprintM2 - expected) < 2, `footprint was ${body.footprintM2}, expected ≈ ${expected.toFixed(1)}`);
});

test('a manual figure overrides the measurement', async () => {
  const { body } = await post('/api/quote', { claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', detectionId, footprintM2: 150 });
  assert.strictEqual(body.footprintSource, 'manual_entry');
  assert.strictEqual(body.footprintM2, 150);
});

test('a client cannot inject a wall area without a detectionId', async () => {
  // No detectionId and no manual figure -> the generic default, never
  // something the client invented.
  const { body } = await post('/api/quote', { claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', measurement: { m2: 9999 } });
  assert.strictEqual(body.footprintSource, 'default_footprint');
  assert.notStrictEqual(body.footprintM2, 9999);
});

test('the lead records the server-side source, not the client claim', async () => {
  const { status, body } = await post('/api/lead', {
    name: 'Test', email: 't@example.com', detectionId,
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
    measurementSource: 'surveyed_by_a_professional',   // a lie from the client
    consent: { terms: true, installerQuotes: true, version: 'v' },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.lead.measurementSource, 'photo_door');
  assert.strictEqual(body.lead.clientMeasurementSource, 'surveyed_by_a_professional');
  assert.ok(body.lead.wallMeasurement, 'the measurement should be attached to the lead');
});

test('an expired or unknown detectionId is refused, not guessed at', async () => {
  const { status, body } = await post('/api/measure', { detectionId: 'made-up' });
  assert.strictEqual(status, 404);
  assert.match(body.error, /expired/i);
});



// Force-exit is handled by --test-force-exit in the npm script; server.js
// keeps the event loop alive by listening.
