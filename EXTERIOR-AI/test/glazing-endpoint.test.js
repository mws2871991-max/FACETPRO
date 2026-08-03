/* The glazing endpoint, and the wiring between the detection record and the
   pricing module.

   The module itself is covered by glazing.test.js. What is covered here is the
   join — which is where this went wrong: the integration note's snippet read
   `record.size.width / record.size.height`, and our detection records hold
   `aspectRatio` directly and no `size` at all. That is not an error, just a
   null, so every estimate silently fell back to the house-type prior while
   looking for all the world like it had measured the photograph.

   Hence the first test. A wiring bug that produces a plausible number is worse
   than one that throws. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');

const PORT = 3082;
const BASE = `http://127.0.0.1:${PORT}`;

/* A two-storey semi: front door, two windows either side of it at ground
   level, three above. Boxes as the model actually returns them — percentages
   in x_pct/y_pct/w_pct/h_pct, not a nested box object. */
const DETECTIONS = [
  { type: 'door-front', confidence: 0.9, x_pct: 44, y_pct: 62, w_pct: 6, h_pct: 30 },
  { type: 'window', confidence: 0.9, x_pct: 12, y_pct: 60, w_pct: 14, h_pct: 20 },
  { type: 'window', confidence: 0.9, x_pct: 60, y_pct: 60, w_pct: 14, h_pct: 20 },
  { type: 'window', confidence: 0.9, x_pct: 12, y_pct: 26, w_pct: 12, h_pct: 16 },
  { type: 'window', confidence: 0.9, x_pct: 44, y_pct: 26, w_pct: 12, h_pct: 16 },
  { type: 'window', confidence: 0.9, x_pct: 70, y_pct: 26, w_pct: 12, h_pct: 16 },
  { type: 'cladding', confidence: 0.9, x_pct: 5, y_pct: 20, w_pct: 88, h_pct: 70 },
];

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    return { ok: true, status: 200,
      json: async () => ({ content: [{ type: 'text', text: JSON.stringify(DETECTIONS) }] }) };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
delete process.env.RESEND_API_KEY;

require('../server');

const jpeg = () => {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(600, 5); sof.writeUInt16BE(800, 7);      // 800 × 600
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32)]).toString('base64');
};

const post = async (path, body) => {
  const res = await realFetch(BASE + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

let detectionId = null;
const detect = async () => {
  if (detectionId) return detectionId;
  const { body } = await post('/api/detect', { image: jpeg(), mimeType: 'image/jpeg' });
  detectionId = body.detectionId;
  assert.ok(detectionId, 'detection should have produced an id');
  return detectionId;
};

const estimate = (extra = {}) => detect().then(id => post('/api/glazing', {
  detectionId: id, houseType: 'semi',
  windowStyleId: 'casement', windowDoorColourId: 'white', ...extra,
}));

test('the estimate is measured from the photograph, not guessed from the house type', async () => {
  const { status, body } = await estimate();
  assert.strictEqual(status, 200);
  assert.strictEqual(body.countSource, 'photo_door',
    'this is the bug: a broken aspect-ratio lookup falls back to the prior and looks fine');
  assert.strictEqual(body.frontCount, 5, 'five windows on the front of the house');
  assert.ok(body.windowCount > body.frontCount, 'the rest of the house is inferred from the front');
});

test('upstairs windows bring in the access cost', async () => {
  // Three of the five front windows sit entirely above the top of the door.
  const { body } = await estimate();
  assert.ok(body.price.upperStoreyCount > 0);
  assert.ok(body.price.access > 0, 'ladders or a tower are not free');
});

test('the homeowner\'s own count beats ours', async () => {
  const { body } = await estimate({ windowCount: 9 });
  assert.strictEqual(body.windowCount, 9);
  assert.strictEqual(body.countSource, 'manual_entry');
});

test('an implausible count is ignored rather than obeyed', async () => {
  const { body } = await estimate({ windowCount: 9999 });
  assert.notStrictEqual(body.windowCount, 9999);
  assert.strictEqual(body.countSource, 'photo_door', 'it should fall back to what it measured');
});

test('a made-up detection id buys nothing', async () => {
  // The client sends an id, never a geometry — the same rule /api/measure has.
  const { status, body } = await post('/api/glazing', {
    detectionId: 'not-a-real-id', houseType: 'semi',
    windowStyleId: 'casement', windowDoorColourId: 'white',
  });
  assert.strictEqual(status, 200, 'still answer — a homeowner should not hit an error');
  assert.strictEqual(body.countSource, 'house_type_prior');
});

test('the price is a range, and it says where the number came from', async () => {
  const { body } = await estimate();
  assert.ok(body.range.low < body.price.total && body.price.total < body.range.high,
    'a single figure would be a precision we do not have');
  assert.match(body.sourceLabel, /\S/);
});

test('while the rates are placeholders, every response says so', async () => {
  /* An itemised, VAT-inclusive figure built from invented rates, presented
     like the sourced cladding pricing, is exactly the misleading-price
     exposure the pricing comments elsewhere worry about. The flag is what the
     panel uses to caveat itself, so it has to travel with the number. */
  const { body } = await estimate();
  const catalogue = require('../catalogue.json');
  const sourced = !/not sourced|placeholder/i.test(catalogue.glazing.source || '');
  assert.strictEqual(body.ratesSourced, sourced,
    'the response must agree with the catalogue about whether the rates are real');
});

test('choosing nothing gets no estimate at all', async () => {
  /* The module prices a default set when given no selection — right for a
     module, wrong for an endpoint. A figure attached to a choice nobody made
     is the same problem as an email confirming a consent nobody gave. */
  const { status, body } = await post('/api/glazing', { detectionId: await detect(), houseType: 'semi' });
  assert.strictEqual(status, 400);
  assert.strictEqual(body.reason, 'nothing_chosen');
});
