'use strict';
/* /r/:id answers in the smallest format the browser takes (renderformats.js).
   A real PNG goes in, as the provider sends one, so the encoder runs. */
require('./helpers/data-dir');

const PORT = 3318;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const { test, before } = require('node:test');
const assert = require('node:assert');
const sharp = require('sharp');
const store = require('../store');
const formats = require('../renderformats');
require('../server');

let png;
const id = 'fmt' + Date.now().toString(16);
before(async () => {
  await require('./helpers/server-ready')(BASE);
  // Noise, so the PNG is big the way a photograph is and the saving is real.
  const w = 240, h = 160, raw = Buffer.alloc(w * h * 4);
  for (let i = 0; i < raw.length; i += 4) { raw[i] = (i * 7) % 255; raw[i + 1] = (i * 13) % 255; raw[i + 2] = (i * 3) % 255; raw[i + 3] = 255; }
  png = await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toBuffer();
  await store.putRender(id, png, { mime: 'image/png' });
});

const get = (path, accept) => fetch(BASE + path, { headers: accept ? { Accept: accept } : {} });

test('the format follows what the browser says it takes', () => {
  assert.strictEqual(formats.pick('image/avif,image/webp,*/*'), 'avif');
  assert.strictEqual(formats.pick('image/webp,*/*'), 'webp');
  assert.strictEqual(formats.pick('*/*'), 'jpeg');
  assert.strictEqual(formats.pick(undefined), 'jpeg');
  assert.strictEqual(formats.pick('image/avif', { download: true }), 'jpeg', 'a .jpg download must open anywhere');
});

test('a phone that takes AVIF gets AVIF, and it is a real AVIF', async () => {
  const r = await get(`/r/${id}`, 'image/avif,image/webp,image/apng,*/*;q=0.8');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers.get('content-type'), 'image/avif');
  const meta = await sharp(Buffer.from(await r.arrayBuffer())).metadata();
  assert.strictEqual(meta.width, 240);
  assert.strictEqual(meta.format, 'heif');
});

test('WebP for a browser without AVIF, JPEG for one that names neither', async () => {
  const w = await get(`/r/${id}`, 'image/webp,*/*');
  assert.strictEqual(w.headers.get('content-type'), 'image/webp');
  assert.strictEqual((await sharp(Buffer.from(await w.arrayBuffer())).metadata()).format, 'webp');
  const j = await get(`/r/${id}`, '*/*');
  assert.strictEqual(j.headers.get('content-type'), 'image/jpeg');
  assert.strictEqual((await sharp(Buffer.from(await j.arrayBuffer())).metadata()).format, 'jpeg');
});

test('the download is a named JPEG', async () => {
  const r = await get(`/r/${id}?download=1`, 'image/avif,image/webp,*/*');
  assert.strictEqual(r.headers.get('content-type'), 'image/jpeg');
  assert.match(r.headers.get('content-disposition') || '', /attachment; filename="my-facet-pro-design\.jpg"/);
});

test('cached hard in the browser, never on a shared cache, and varied by Accept', async () => {
  const r = await get(`/r/${id}`, 'image/webp');
  assert.strictEqual(r.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.match(r.headers.get('vary') || '', /Accept/);
});

test('the stored original is untouched', async () => {
  const back = await store.getRender(id);
  assert.ok(Buffer.from(back.bytes).equals(png));
  assert.strictEqual(back.mime, 'image/png');
});

test('a deleted render is gone in every format', async () => {
  await get(`/r/${id}`, 'image/avif');   // make sure converted copies exist
  await store.deleteRenders([id]);
  for (const a of ['image/avif', 'image/webp', '*/*']) {
    assert.strictEqual((await get(`/r/${id}`, a)).status, 404, a);
  }
  assert.strictEqual(await formats.encoded(id, Buffer.alloc(0), 'zzz'), null);
});
