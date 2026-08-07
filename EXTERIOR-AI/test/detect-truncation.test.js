/* When the model is cut off mid-sentence, say so.

   Detection returned zero elements for every photograph and reported no
   error. The prompt asked for a description sentence per element, the reply
   ran past max_tokens and stopped mid-object:

     {"type":"fascia","label":"Fascia

   The parser looks for a bracketed array, found no closing bracket, and the
   JSON.parse failure went into an empty catch. So "the model was interrupted"
   and "this house has no windows" arrived at the caller as the same answer,
   and neither one appeared in a log.

   The budget and the prompt are fixed. This covers the part that will matter
   again: that a truncated or unreadable reply is refused rather than
   flattened into an empty list. A future prompt that grows past the budget
   will then be visible on the first request instead of silently returning
   nothing to everybody.

   The suite stubs Anthropic, and a stub never truncates — which is exactly
   why this had no coverage. So the stub is made to truncate on purpose. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3109;
const BASE = `http://127.0.0.1:${PORT}`;

/* What the model returns is decided per-test. */
let reply = null;

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    return { ok: true, status: 200, json: async () => reply };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

/* A minimal JPEG whose SOF0 declares 640x480, so readImage is satisfied. */
function jpeg(width = 640, height = 480) {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(64)]).toString('base64');
}

/* A different photograph per call.

   Detection remembers its answer against the image now, so every test here
   sending the identical jpeg meant the first successful reply was handed back
   to all the later ones — the honest-empty-array test cached `[]`, and the
   good-reply test that followed got the empty list instead of asking again.
   Each test wants a fresh reading, so each gets its own house. */
let seq = 0;
const detect = () => realFetch(`${BASE}/api/detect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image: jpeg(640 + (++seq)), mimeType: 'image/jpeg' }),
});

const GOOD = [
  { type: 'cladding', label: 'Front wall', confidence: 0.9, x_pct: 5, y_pct: 5, w_pct: 80, h_pct: 60 },
  { type: 'door-front', label: 'Front door', confidence: 0.95, x_pct: 40, y_pct: 55, w_pct: 8, h_pct: 20 },
];

test('a reply cut off mid-array is refused, not read as an empty house', async () => {
  /* The exact shape that broke it: valid JSON up to the point the model was
     interrupted, and no closing bracket. */
  reply = {
    stop_reason: 'max_tokens',
    usage: { output_tokens: 1200 },
    content: [{ type: 'text', text: '[\n{"type":"window","label":"Front","confidence":0.9,"x_pct":10,"y_pct":10,"w_pct":10,"h_pct":10},\n{"type":"fascia","label":"Fascia' }],
  };
  const res = await detect();
  assert.strictEqual(res.status, 502,
    'a truncated reply came back as a success — the caller cannot tell it from a house with nothing on it');
  const body = await res.json();
  assert.match(body.error, /couldn.t read your photo/i);
  assert.ok(!('detections' in body), 'an empty detection list was returned alongside the error');
});

test('a reply with no array at all is refused', async () => {
  /* The model answering in prose, which it does when a prompt drifts. */
  reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'I can see a house with several windows.' }] };
  assert.strictEqual((await detect()).status, 502);
});

test('an empty reply is refused', async () => {
  reply = { stop_reason: 'end_turn', content: [] };
  assert.strictEqual((await detect()).status, 502);
});

test('a genuinely empty array is NOT an error — that is a real answer', async () => {
  /* A photograph of a hedge has no windows in it, and that is information
     rather than a failure. The whole point is telling this apart from a reply
     nobody could read. */
  reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '[]' }] };
  const res = await detect();
  assert.strictEqual(res.status, 200, 'an honest empty answer was treated as a failure');
  const body = await res.json();
  assert.deepStrictEqual(body.detections, []);
  assert.strictEqual(body.canMeasure, false);
});

test('a good reply still works, fenced in markdown as the model often sends it', async () => {
  reply = { stop_reason: 'end_turn', content: [{ type: 'text', text: '```json\n' + JSON.stringify(GOOD) + '\n```' }] };
  const res = await detect();
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.detections.length, 2);
  assert.strictEqual(body.scaleReference, true, 'the front door was not recognised as the scale reference');
  assert.strictEqual(body.canMeasure, true);
});

test('the token budget is big enough for the prompt we actually send', () => {
  /* 1200 was too small even after the notes field was removed — the same
     photograph now uses 1277 output tokens. A budget that fits the reply is
     not a detail; it is the difference between an estimate and silence. */
  const fs = require('fs');
  const path = require('path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const m = server.match(/max_tokens:\s*(\d+)/);
  assert.ok(m, 'max_tokens has gone from the detection request');
  assert.ok(Number(m[1]) >= 3000, `max_tokens is ${m[1]} — a real house needs more than that`);
  assert.ok(!/"notes":/.test(server),
    'the prompt asks for notes again — nothing reads them and they are what blew the budget');
});
