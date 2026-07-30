/* Tests for the wall-area geometry. Run: npm test
   Plain node:test — no dependencies, no build step, consistent with the
   rest of the project. */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { estimateWallArea, imageSize, HOUSE_TYPE_PRIORS, DOOR_HEIGHT_M } = require('../measure');

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
