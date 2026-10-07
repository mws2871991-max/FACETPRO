/* The pin fallback: when the model cannot see the front door (a tree, a small
   photo, a shot from the side), the homeowner pins its corners and the walls
   are measured from those — by the same ruler and limits as any other
   measurement, and never from an area the browser sends.

   The Anthropic call is stubbed with the semi from api.test.js, minus its
   front door, as if a tree were in front of it. Pinning that door where it
   really is must give the same walls the model would have measured. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3319;
const BASE = `http://127.0.0.1:${PORT}`;

const FRAME_H_M = 10, ASPECT = 4 / 3, FRAME_W_M = FRAME_H_M * ASPECT;
const pctW = (m) => (m / FRAME_W_M) * 100;
const pctH = (m) => (m / FRAME_H_M) * 100;

const WALL = { type: 'cladding', label: 'Front wall', confidence: 0.9, x_pct: pctW(3.2), y_pct: pctH(3.4), w_pct: pctW(7), h_pct: pctH(6) };
const DOOR = { type: 'door-front', label: 'Front door', confidence: 0.95, x_pct: pctW(6.2), y_pct: pctH(7.4), w_pct: pctW(0.9), h_pct: pctH(1.98) };
const WINDOWS = [[4.0, 7.6], [8.0, 7.6], [4.0, 4.4], [8.0, 4.4]].map(([x, y]) =>
  ({ type: 'window', label: 'Window', confidence: 0.9, x_pct: pctW(x), y_pct: pctH(y), w_pct: pctW(1.2), h_pct: pctH(1.2) }));

let detections = [WALL, ...WINDOWS];   // the door is behind a tree

// Each call a different file: the server reuses its analysis of an identical photo.
let salt = 0;
function fakeJpegBase64(width = 640, height = 480) {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32, ++salt % 250)]).toString('base64');
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: JSON.stringify(detections) }] }) };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';
require('../server');
const measure = require('../measure');

before(async () => { await require('./helpers/server-ready')(BASE); });

const post = async (path, body) => {
  const res = await realFetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
};
const corners = (d) => [
  { x: d.x_pct, y: d.y_pct }, { x: d.x_pct + d.w_pct, y: d.y_pct },
  { x: d.x_pct + d.w_pct, y: d.y_pct + d.h_pct }, { x: d.x_pct, y: d.y_pct + d.h_pct },
];
const detect = async () => (await post('/api/detect', { image: fakeJpegBase64(), mimeType: 'image/jpeg' })).body.detectionId;

let referenceM2;
before(async () => {
  // The same house with the door in view, measured the ordinary way.
  detections = [WALL, DOOR, ...WINDOWS];
  const id = await detect();
  referenceM2 = (await post('/api/measure', { detectionId: id, houseType: 'semi' })).body.m2;
  detections = [WALL, ...WINDOWS];
});

test('with the door hidden, the photo cannot be measured by the door', async () => {
  const id = await detect();
  const { body } = await post('/api/measure', { detectionId: id, houseType: 'semi' });
  assert.notStrictEqual(body.method, 'door');
  assert.ok(!body.pinned);
});

test('pinning the hidden door gives the walls the model would have measured', async () => {
  const id = await detect();
  const { status, body } = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: corners(DOOR) } });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.method, 'door');
  assert.strictEqual(body.pinned, true);
  assert.strictEqual(body.m2, referenceM2);
  assert.match(body.notes[0], /pins you placed/);
  // And the quote is sized by it, as by any measurement.
  const q = await post('/api/quote', { claddingId: 'alabaster', roofId: 'none', trimId: 'none', detectionId: id });
  assert.strictEqual(q.body.footprintSource, 'photo_door');
  assert.ok(Math.abs(q.body.footprintM2 - referenceM2) < 1);
});

test('pins in any order measure the same', async () => {
  const id = await detect();
  const c = corners(DOOR);
  const { body } = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: [c[2], c[0], c[3], c[1]] } });
  assert.strictEqual(body.m2, referenceM2);
});

test('a door shot from the side is measured by its average height, not its near edge', () => {
  // Right edge foreshortened to 80%: a bounding box would take the full left
  // edge; the trapezium's height is the mean of the two.
  const d = DOOR;
  const shrink = d.h_pct * 0.1;
  const quad = [{ x: d.x_pct, y: d.y_pct }, { x: d.x_pct + d.w_pct, y: d.y_pct + shrink },
    { x: d.x_pct + d.w_pct, y: d.y_pct + d.h_pct - shrink }, { x: d.x_pct, y: d.y_pct + d.h_pct }];
  const out = measure.pinnedDetections([WALL], { door: quad }, ASPECT);
  const door = out.detections.find(x => x.type === 'door-front');
  assert.ok(Math.abs(door.h_pct - d.h_pct * 0.9) < 0.05, `height ${door.h_pct}`);
});

test('wall pins replace the model\'s walls; windows are kept', () => {
  const wall = corners(WALL);
  const out = measure.pinnedDetections([WALL, DOOR, ...WINDOWS], { door: corners(DOOR), wall }, ASPECT);
  assert.strictEqual(out.detections.filter(x => x.type === 'cladding').length, 1);
  assert.strictEqual(out.detections.filter(x => x.type === 'door-front').length, 1);
  assert.strictEqual(out.detections.filter(x => x.type === 'window').length, 4);
  assert.match(out.detections.find(x => x.type === 'cladding').label, /your pins/);
});

test('pins that cannot be a door are refused in words the visitor can act on', async () => {
  const id = await detect();
  const wide = [{ x: 30, y: 60 }, { x: 70, y: 60 }, { x: 70, y: 80 }, { x: 30, y: 80 }];
  const r1 = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: wide } });
  assert.strictEqual(r1.status, 422);
  assert.match(r1.body.error, /wider than a front door/);
  const r2 = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: [{ x: 1, y: 1 }] } });
  assert.strictEqual(r2.status, 422);
  const r3 = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: corners(DOOR).map(p => ({ x: p.x + 200, y: p.y })) } });
  assert.strictEqual(r3.status, 422);
  const tinyWall = corners({ x_pct: DOOR.x_pct, y_pct: DOOR.y_pct, w_pct: DOOR.w_pct, h_pct: DOOR.h_pct });
  const r4 = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: corners(DOOR), wall: tinyWall } });
  assert.strictEqual(r4.status, 422);
  assert.match(r4.body.error, /whole front wall/);
});

test('the browser still cannot send an area', async () => {
  const id = await detect();
  const { body } = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: corners(DOOR) }, m2: 999, low: 1, high: 2 });
  assert.strictEqual(body.m2, referenceM2);
});

test('the band still applies to pins', async () => {
  // A "door" a fifth of its true height scales the house up five times.
  const id = await detect();
  const d = { ...DOOR, h_pct: DOOR.h_pct / 5, w_pct: DOOR.w_pct / 5 };
  const { body } = await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: corners(d) } });
  assert.strictEqual(body.method, 'prior');
  assert.strictEqual(body.observed.rejected.side, 'above');
});

test('pinned readings are recorded apart from the model\'s', async () => {
  const store = require('../store');
  const id = await detect();
  await post('/api/measure', { detectionId: id, houseType: 'semi', pins: { door: corners(DOOR) } });
  const rows = await store.readMeasurements(5000);
  assert.strictEqual(rows[0].method, 'door-pins');
});

test('the page offers the pins only for a reason, and keeps them through a house-type change', () => {
  const html = require('fs').readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /function photoHelpReasons\(\)/);
  assert.match(html, /pinsHelpPanel\(\),/);
  assert.match(html, /pins: state\.pins \|\| undefined/);
  assert.match(html, /state\.pins = null;\n {4}state\.photoLongEdge = null;/, 'a new photo forgets the last one\'s pins');
});
