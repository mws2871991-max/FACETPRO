/* What we ask the model to change.

   Every before-and-after photograph on the site is a window-frame recolour.
   The render prompt said the windows and doors "must remain completely
   untouched and pixel-perfect to the original" — so the visualiser was
   instructed to refuse the one transformation the site uses as its proof.

   Conditional rather than reversed, because the cladding, roof and trim
   visualiser is a real product too: frames change when somebody has chosen a
   style and a colour for them, and stay frozen when nobody has. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const {test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3083;
const BASE = `http://127.0.0.1:${PORT}`;

const prompts = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('api.replicate.com')) {
    prompts.push(JSON.parse(opts.body).input.prompt);
    return { ok: true, status: 200, json: async () => ({ status: 'succeeded', output: 'https://example.test/r.jpg' }) };
  }
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.REPLICATE_API_TOKEN = 'r8-test';
delete process.env.RESEND_API_KEY;

require('../server');

/* The server listens asynchronously. Against JSONL that is a tick; against
   Postgres it is a schema, and a fetch issued before the socket exists fails
   with "fetch failed". See test/helpers/server-ready.js. */
before(async () => { await require('./helpers/server-ready')(BASE); });

const jpeg = () => {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(480, 5); sof.writeUInt16BE(640, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32)]).toString('base64');
};

const render = async (extra) => {
  const before = prompts.length;
  const res = await realFetch(`${BASE}/api/render`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ image: jpeg(), mimeType: 'image/jpeg', claddingName: 'Sage Slate',
      trimName: 'Ink', roofName: 'Terracotta', ...extra }),
  });
  assert.strictEqual(res.status, 200, `render failed: ${res.status}`);
  assert.strictEqual(prompts.length, before + 1, 'the provider should have been called once');
  return prompts[before];
};

test('with no window choice, the frames are left alone', async () => {
  const prompt = await render({});
  assert.match(prompt, /windows, doors, garden, path, sky/,
    'someone recolouring their walls has not asked for new windows');
  assert.doesNotMatch(prompt, /Replace the window frames/);
});

test('with a style and a colour, the frames actually change', async () => {
  const prompt = await render({
    windowStyleName: 'Flush', doorStyleName: 'Composite', windowDoorColourName: 'Anthracite Grey',
  });
  assert.match(prompt, /Replace the window frames and the front door/);
  assert.match(prompt, /Flush/);
  assert.match(prompt, /Composite/);
  assert.match(prompt, /Anthracite Grey/);
  // What stays untouched has to change with it, or the prompt contradicts itself.
  assert.match(prompt, /brickwork, garden, path, sky/);
  assert.doesNotMatch(prompt, /windows, doors, garden/, 'it cannot both change and freeze them');
});

test('a colour with no style changes nothing', async () => {
  // Half a choice is not a choice; guessing a style is not ours to do.
  const prompt = await render({ windowDoorColourName: 'Anthracite Grey' });
  assert.doesNotMatch(prompt, /Replace the window frames/);
});

test('a bifold is not painted onto the front of the house', async () => {
  /* "Bifold, 3 m" used to reach the model as "a Bifold, 3 m front door" — a
     three-metre opening asked for in a 0.9 m doorway, in the same prompt that
     forbids resizing any opening. The model can only obey one of those. It
     either widens the door and shows somebody a house they do not own, or
     ignores the style and shows them a picture that is quietly wrong.

     Bifolds open onto a garden; the photograph is of the front, by
     instruction, and the front door is the 1.98 m scale reference. So the
     elevation being rendered is not the one this door is on. */
  const prompt = await render({
    windowStyleName: '', doorStyleName: 'Bifold, 3 m', doorStyleId: 'bifold-3m',
    windowDoorColourName: 'Anthracite Grey',
  });
  assert.doesNotMatch(prompt, /Bifold/, 'a bifold must not be drawn onto the front elevation');
  assert.doesNotMatch(prompt, /front door/, 'and must not be described as a front door');
});

test('the other rear openings are on the same list', () => {
  /* Asserted against the list rather than through the endpoint: the render
     limiter allows five a minute and this file already uses them, so proving
     the same rule twice more would cost two 429s and prove nothing new. The
     bifold case above exercises the wiring; this checks the membership.

     A real front door is deliberately absent from it — the case where a door
     SHOULD still change is covered by "with a style and a colour, the frames
     actually change" above, which passes no id and so is treated as a front
     door. */
  const { REAR_OPENINGS } = require('../server')._internals;
  for (const id of ['bifold', 'bifold-3m', 'sliding', 'double']) {
    assert.ok(REAR_OPENINGS.has(id), `${id} opens onto the garden, not the street`);
  }
  for (const id of ['upvc', 'composite']) {
    assert.ok(!REAR_OPENINGS.has(id), `${id} is a front door and must still be drawn`);
  }
});

test('the model is told not to invent an opening, either way', async () => {
  /* FLUX Kontext will happily "improve" a house by adding a window. A render
     showing an opening the homeowner does not have is a complaint an
     installer discovers on survey. */
  for (const p of prompts) {
    assert.match(p, /Do not add, remove, move or resize any window, door or other opening/);
  }
  assert.match(prompts[1], /match the existing apertures exactly/);
});
