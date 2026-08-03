/* What gets sent to the paid providers.

   Both endpoints used to take the client's word for what it was handing over.
   /api/detect allowlisted the declared mimeType and then passed it to
   Anthropic as media_type; /api/render did not even allowlist it, and
   interpolated it into a data: URL for Replicate — or, if the client sent a
   data: URL of its own, forwarded that whole. Nothing anywhere read the bytes,
   so arbitrary base64 could be pushed through both API keys. The daily caps
   bound how much of that happens, not what it is.

   Its own file because the per-minute rate limiters are per process, and these
   tests deliberately make a run of refused requests.

   Nothing here should ever reach a provider, so the stubs count calls and the
   counts are asserted rather than assumed. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');

const PORT = 3086;
const BASE = `http://127.0.0.1:${PORT}`;

const upstream = { anthropic: 0, replicate: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.anthropic.com')) {
    upstream.anthropic++;
    return { ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: '[]' }] }) };
  }
  if (u.includes('api.replicate.com')) {
    upstream.replicate++;
    return { ok: true, status: 200, json: async () => ({ status: 'succeeded', output: 'https://example.test/r.jpg' }) };
  }
  return realFetch(u, opts);
};

process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.REPLICATE_API_TOKEN = 'r8-test';
delete process.env.RESEND_API_KEY;

require('../server');

const post = async (p, payload) => {
  const res = await realFetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const b64 = (s) => Buffer.from(s, 'binary').toString('base64');
const jpeg = () => {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(480, 5); sof.writeUInt16BE(640, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32)]).toString('base64');
};

test('content that is not an image is refused by both paid endpoints', async () => {
  const before = { ...upstream };
  const php = b64('<?php system($_GET["c"]); ?>'.repeat(4));
  assert.strictEqual((await post('/api/detect', { image: php, mimeType: 'image/jpeg' })).status, 400, 'detect took a php file');
  assert.strictEqual((await post('/api/render', { image: php, mimeType: 'image/jpeg' })).status, 400, 'render took a php file');

  const zeroes = Buffer.alloc(64).toString('base64');
  assert.strictEqual((await post('/api/detect', { image: zeroes, mimeType: 'image/png' })).status, 400, 'detect took 64 zero bytes');
  assert.strictEqual((await post('/api/render', { image: zeroes, mimeType: 'image/png' })).status, 400, 'render took 64 zero bytes');

  assert.deepStrictEqual(upstream, before, 'unvalidated content reached a provider on our key');
});

test('an image lying about its own type is refused, not corrected', async () => {
  // A confused client at best, and there is no good reason to guess for it.
  const { status, body } = await post('/api/detect', { image: jpeg(), mimeType: 'image/png' });
  assert.strictEqual(status, 400);
  assert.match(body.error, /isn.t the type it says/i);
});

test('the declared type is still allowlisted', async () => {
  for (const mimeType of ['image/svg+xml', 'text/html']) {
    const { status, body } = await post('/api/detect', { image: jpeg(), mimeType });
    assert.strictEqual(status, 400, mimeType);
    assert.match(body.error, /unsupported image type/i);
  }
});

test('a client-supplied data: URL is never forwarded verbatim', async () => {
  const before = upstream.replicate;
  const { status } = await post('/api/render', {
    image: 'data:text/html;base64,' + b64('<script>alert(1)</script>'),
    claddingName: 'Alabaster',
  });
  assert.strictEqual(status, 400, 'the type in a data: URL is still a claim by the client');
  assert.strictEqual(upstream.replicate, before, 'and it reached Replicate');
});

test('a real photograph still goes through, measured from its own header', async () => {
  // The gate has to let the product work — this is the one call here that is
  // meant to reach a provider.
  const before = upstream.anthropic;
  const { status, body } = await post('/api/detect', { image: jpeg(), mimeType: 'image/jpeg' });
  assert.strictEqual(status, 200);
  assert.strictEqual(upstream.anthropic, before + 1);
  assert.strictEqual(body.canMeasure, false, 'no cladding in an empty detection');
});

test('a photo too big for the provider does not spend a paid slot', async () => {
  /* consumeDailyQuota is irreversible, and /api/detect called it before
     posting to a provider that rejects oversized images — so an 8MB phone
     picture burned one of fifty daily slots on a request guaranteed to fail.
     /api/render already checked; detect did not. */
  const before = upstream.anthropic;
  const big = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x02, 0x58, 0x02, 0x80]),
    Buffer.alloc(6 * 1024 * 1024),
  ]).toString('base64');
  const { status, body } = await post('/api/detect', { image: big, mimeType: 'image/jpeg' });
  assert.strictEqual(status, 413);
  assert.strictEqual(body.reason, 'image_too_large');
  assert.strictEqual(upstream.anthropic, before, 'it reached the provider anyway');
});
