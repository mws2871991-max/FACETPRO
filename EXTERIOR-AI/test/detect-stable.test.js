/* The same house gets the same number.

   That sentence is on the homepage, in those words, and it was not true.

   The model is sampled and `temperature` is deprecated on it, so there is no
   setting that makes it repeat itself. Five runs of one photograph through the
   live service found 5, 7, 7, 8 and 8 front windows, and priced the same house
   at £16,889–£30,707 on one run and £25,166–£45,757 on another — forty-nine
   per cent apart, each labelled "measured from your photo".

   A homeowner would never see it. They upload once. But they reload, they go
   back a step, they open the link again on a laptop, and they send it to
   whoever pays for the windows — and the number moving by half is the kind of
   thing that ends the sale, because it reads as though somebody is guessing.

   The fix is not a better prompt, it is asking once: the answer is kept
   against a hash of the image bytes. This pins that, and it pins the sentence
   on the page too, so the promise and the behaviour cannot drift apart again
   without a test going red. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3121;
const BASE = `http://127.0.0.1:${PORT}`;

/* Every call returns a different house, which is the behaviour under test —
   if the endpoint asks twice, the two answers cannot agree. */
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    calls++;
    const windows = Array.from({ length: 4 + calls }, (_, i) => ({
      type: 'window', label: `Window ${i + 1}`, confidence: 0.9,
      x_pct: 5 + i * 6, y_pct: 20, w_pct: 5, h_pct: 10,
    }));
    const body = [
      ...windows,
      { type: 'cladding', label: 'Front wall', confidence: 0.9, x_pct: 2, y_pct: 5, w_pct: 90, h_pct: 70 },
      { type: 'door-front', label: 'Front door', confidence: 0.95, x_pct: 45, y_pct: 55, w_pct: 8, h_pct: 20 },
    ];
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }] }) };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
/* This test deliberately sends one photograph over and over, which is exactly
   what the per-minute limiter exists to stop. */
process.env.DETECT_RATE_LIMIT = '200';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

/* Distinct photographs are made by changing the declared dimensions, not by
   salting the bytes after the header — the parser is still walking segments
   there, and a stray byte gets the image rejected before it ever reaches the
   part under test. */
function jpeg(width = 640, height = 480) {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(64)]).toString('base64');
}

const detect = (image) => realFetch(`${BASE}/api/detect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image, mimeType: 'image/jpeg' }),
}).then(r => r.json());

const priceFor = (detectionId) => realFetch(`${BASE}/api/glazing`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ detectionId, houseType: 'detached', windowStyleId: 'casement', windowDoorColourId: 'white' }),
}).then(r => r.json());

test('the same photograph gives the same answer, however many times it is sent', async () => {
  const photo = jpeg(640, 480);
  const first = await detect(photo);
  assert.ok(first.detections.length > 0, 'the first detection returned nothing');

  for (let i = 0; i < 4; i++) {
    const again = await detect(photo);
    assert.deepStrictEqual(again.detections, first.detections,
      'the same photograph came back with a different set of elements');
    assert.strictEqual(again.detectionId, first.detectionId,
      'a second upload of one photograph opened a second measurement');
  }
});

test('and therefore the same price', async () => {
  const photo = jpeg(800, 600);
  const prices = [];
  for (let i = 0; i < 4; i++) {
    const { detectionId } = await detect(photo);
    const g = await priceFor(detectionId);
    prices.push(`${g.marketRange.low}-${g.marketRange.high}`);
  }
  assert.strictEqual(new Set(prices).size, 1,
    `one photograph produced ${new Set(prices).size} different prices: ${[...new Set(prices)].join(', ')}`);
});

test('the model is asked once per photograph, not once per upload', async () => {
  const photo = jpeg(1024, 768);
  const before = calls;
  await detect(photo);
  const afterFirst = calls;
  for (let i = 0; i < 3; i++) await detect(photo);
  assert.strictEqual(afterFirst - before, 1, 'the first upload should ask exactly once');
  assert.strictEqual(calls, afterFirst,
    `three repeat uploads spent ${calls - afterFirst} further detection calls`);
});

test('a different photograph is still read fresh', async () => {
  /* The cache must not be so eager that two houses share an answer — that
     would be a far worse bug than the one it fixes. */
  const a = await detect(jpeg(900, 700));
  const b = await detect(jpeg(901, 700));
  assert.notStrictEqual(a.detectionId, b.detectionId,
    'two different photographs were given the same measurement');
});

test('the homepage only promises this because the code now does it', () => {
  /* The sentence was on the page for weeks while the opposite was true. It is
     pinned here so that if the caching goes, the claim goes with it. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  if (/The same house gets the same number/.test(page)) {
    assert.ok(/detectionByImage/.test(server),
      'the page promises the same house gets the same number, and nothing in the server makes that true');
  }
});
