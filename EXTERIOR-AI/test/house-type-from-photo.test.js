/* What kind of house the photograph shows.

   state.houseType defaulted to 'semi' and moved only if somebody found the
   picker. So a detached house was measured against a semi's 55–130 m² band,
   its perfectly good 181 m² reading was refused, the estimate fell back to a
   typical figure, and the notice suggested trying another photograph — which
   was never the problem. That is a large share of the fallback rate, and the
   measurement was right every time.

   The model was already being asked for an era and a wall material on every
   photograph, and nothing has ever read either, so asking for one more field
   costs no extra call.

   What matters is that it stays a default. A wrong guess must be overridable,
   an unrecognised value must be discarded rather than coerced into a semi,
   and a house type somebody has actually chosen must win. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { resolveHouseType, _internals } = require('../glazing');

const PORT = 3139;
const BASE = `http://127.0.0.1:${PORT}`;

/* The model answers in prose; this is what it is told to choose from. */
let analysisExtra = { houseType: 'detached' };

const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.anthropic.com')) {
    const body = [
      { type: 'cladding', label: 'Front wall', confidence: 0.9, x_pct: 2, y_pct: 5, w_pct: 90, h_pct: 70 },
      { type: 'door-front', label: 'Front door', confidence: 0.95, x_pct: 45, y_pct: 55, w_pct: 8, h_pct: 20 },
      { type: 'window', label: 'Lower Left Window', confidence: 0.9, x_pct: 10, y_pct: 55, w_pct: 12, h_pct: 14 },
      { type: 'analysis', summary: 'A house.', era: 'modern', wallMaterial: 'yellow-brick', ...analysisExtra },
    ];
    return { ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }] }) };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.DETECT_RATE_LIMIT = '200';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test-stub';

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

let jpegSeed = 700;
function jpeg() {
  const height = jpegSeed++;               // a new photograph each call, so the cache never answers
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0);
  sof.writeUInt16BE(8, 2);
  sof[4] = 8;
  sof.writeUInt16BE(height, 5);
  sof.writeUInt16BE(900, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(64)]).toString('base64');
}

const detect = () => realFetch(`${BASE}/api/detect`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image: jpeg(), mimeType: 'image/jpeg' }),
}).then(r => r.json());

/* ── the resolver ── */

test('the words the model is offered all resolve', () => {
  /* Exactly the vocabulary in the prompt. If somebody edits one and not the
     other, every photograph silently goes back to being a semi. */
  assert.strictEqual(resolveHouseType('detached'), 'detached');
  assert.strictEqual(resolveHouseType('semi-detached'), 'semi');
  assert.strictEqual(resolveHouseType('end-terrace'), 'endTerrace');
  assert.strictEqual(resolveHouseType('mid-terrace'), 'terrace');
  assert.strictEqual(resolveHouseType('bungalow'), 'bungalow');
});

test('it refuses to guess, where houseTypeKey has to', () => {
  /* The difference between the two is the whole point: one answers "what do I
     price against" and must produce something; this one answers "did anybody
     say", and inventing an answer there is what put a detached house in a
     semi's band. */
  assert.strictEqual(resolveHouseType('mansion'), null);
  assert.strictEqual(resolveHouseType(''), null);
  assert.strictEqual(resolveHouseType(undefined), null);
  assert.strictEqual(resolveHouseType({ nope: true }), null);
  assert.strictEqual(_internals.houseTypeKey('mansion'), 'semi', 'the pricing default has changed');
});

/* ── the prompt ── */

test('the photograph is actually asked about the house type', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  /* The whole instruction, not just its first half: the analysis object is
     described after the coordinate notes, which is where an earlier version of
     this test stopped reading. */
  const prompt = server.slice(server.indexOf('Detect every exterior architectural element'), server.indexOf('max_tokens', server.indexOf('Detect every exterior architectural element')) + 4000);
  assert.match(prompt, /"houseType":"detached\|semi-detached\|end-terrace\|mid-terrace\|bungalow"/,
    'the analysis object no longer asks for a house type, so every photograph is a semi again');
  assert.match(server, /omit the field rather than guessing/,
    'the model should say nothing rather than guess when the sides are not visible');
});

/* ── the endpoint ── */

test('a detected house type comes back with the detection', async () => {
  analysisExtra = { houseType: 'detached' };
  const body = await detect();
  assert.strictEqual(body.houseType, 'detached');
});

test('the model speaking its own dialect still resolves', async () => {
  analysisExtra = { houseType: 'Semi-Detached' };
  assert.strictEqual((await detect()).houseType, 'semi');
  analysisExtra = { houseType: 'end of terrace' };
  assert.strictEqual((await detect()).houseType, 'endTerrace');
});

test('a value nobody recognises is discarded, not coerced', async () => {
  analysisExtra = { houseType: 'mansion' };
  const body = await detect();
  assert.strictEqual(body.houseType, null,
    'an unrecognised type must not arrive as a semi — that is the bug wearing a different hat');
});

test('a photograph the model would not judge says nothing', async () => {
  analysisExtra = {};
  assert.strictEqual((await detect()).houseType, null);
});

test('the cached answer carries it too', async () => {
  analysisExtra = { houseType: 'bungalow' };
  const image = jpeg();
  const send = () => realFetch(`${BASE}/api/detect`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, mimeType: 'image/jpeg' }),
  }).then(r => r.json());

  const fresh = await send();
  assert.strictEqual(fresh.houseType, 'bungalow');
  /* Read off the stored detections rather than a stored field, so photographs
     cached before this shipped answer as well — and a reload does not quietly
     change the house type under somebody mid-journey. */
  analysisExtra = { houseType: 'detached' };
  const cached = await send();
  assert.strictEqual(cached.houseType, 'bungalow', 'the cached photograph changed its mind');
});

/* ── the page treats it as a default, not a verdict ── */

test('a house type somebody chose is never overwritten by a photograph', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(page, /if \(data\.houseType && !state\.houseTypeChosen/,
    'the detected type is applied without checking whether somebody already chose one');
  /* Both ways of saying it out loud. */
  assert.match(page, /state\.houseTypeChosen = true;/);
  const picker = page.slice(page.indexOf('function buildHouseTypePicker'), page.indexOf('function priceRow'));
  assert.match(picker, /state\.houseTypeChosen = true/, 'tapping the picker does not count as being told');
});

/* ── Side evidence (24 September) ── */

test('the house type comes from what each side shows, not the verdict', () => {
  const { houseTypeFromEvidence } = require('../glazing');
  const a = (left, right, houseType = 'detached') => houseTypeFromEvidence({ houseType, sides: { left, right } });
  assert.strictEqual(a('gap', 'gap'), 'detached');
  assert.strictEqual(a('shared', 'gap'), 'semi');
  assert.strictEqual(a('gap', 'shared', 'end-terrace'), 'endTerrace');
  assert.strictEqual(a('shared', 'shared'), 'terrace');
  // hero-before.jpg: a close crop, neither side in shot, and the model said "detached".
  assert.strictEqual(a('cut-off', 'cut-off'), null);
  assert.strictEqual(a('gap', 'cut-off'), null);
  // A storey count, not a matter of sides.
  assert.strictEqual(a('cut-off', 'cut-off', 'bungalow'), 'bungalow');
  // No evidence (an older record): the verdict, as before.
  assert.strictEqual(houseTypeFromEvidence({ houseType: 'semi-detached' }), 'semi');
});

test('an unread house type is not presented as a reading', () => {
  const fs = require('fs');
  const path = require('path');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(html, /We couldn't see both sides of the house/);
  assert.match(html, /state\.houseTypeRead = !!\(data\.houseType/);
});
