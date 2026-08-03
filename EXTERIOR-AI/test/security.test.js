/* Tests for the paths that protect data and money: installer auth, the
   static-file allowlist, the daily spend caps, and lead notification.

   These were all fixed by hand and verified with one-off curl runs. That is
   exactly the kind of work a refactor silently undoes — re-exposing
   data/leads.jsonl, or turning a 429 back into a paid API call — so it is
   pinned here.

   Runs offline: the Anthropic and Replicate calls are stubbed, and the
   assertions are about what the server does BEFORE reaching them. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3097;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'correct-horse-battery-staple';
const DAILY_DETECT = 2;
const DAILY_RENDER = 1;

// Count upstream calls so we can prove a capped request never makes one.
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

const DATA_DIR = process.env.FACETPRO_DATA_DIR;
fs.rmSync(path.join(DATA_DIR, 'usage.json'), { force: true });

process.env.PORT = String(PORT);
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.REPLICATE_API_TOKEN = 'r8-test';
process.env.INSTALLER_PASSWORD = PASSWORD;
process.env.DAILY_DETECT_LIMIT = String(DAILY_DETECT);
process.env.DAILY_RENDER_LIMIT = String(DAILY_RENDER);
delete process.env.RESEND_API_KEY;

require('../server');

const get = async (p, headers = {}) => {
  const res = await realFetch(BASE + p, { headers });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, body, headers: res.headers };
};
const post = async (p, payload) => {
  const res = await realFetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const tinyJpeg = () => {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(480, 5); sof.writeUInt16BE(640, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(32)]).toString('base64');
};

/* ── installer auth ── */

test('GET /api/leads refuses every wrong or missing credential', async () => {
  const cases = [
    ['no credentials',        {}],
    ['empty bearer',          { Authorization: 'Bearer ' }],
    ['wrong password',        { Authorization: 'Bearer wrong' }],
    ['much shorter password', { Authorization: 'Bearer x' }],
    ['much longer password',  { Authorization: `Bearer ${'x'.repeat(500)}` }],
    ['prefix of the real one', { Authorization: `Bearer ${PASSWORD.slice(0, -1)}` }],
    ['wrong header name',     { 'X-Password': PASSWORD }],
  ];
  for (const [label, headers] of cases) {
    const { status, body } = await get('/api/leads', headers);
    assert.strictEqual(status, 401, `${label} should be 401, got ${status}`);
    assert.ok(!('leads' in body), `${label} must not return leads`);
  }
});

test('GET /api/leads accepts the password by either header', async () => {
  for (const headers of [
    { Authorization: `Bearer ${PASSWORD}` },
    { 'x-installer-password': PASSWORD },
  ]) {
    const { status, body } = await get('/api/leads', headers);
    assert.strictEqual(status, 200);
    assert.ok(Array.isArray(body.leads));
  }
});

test('a rejected request advertises how to authenticate, and leaks nothing', async () => {
  const { status, body, headers } = await get('/api/leads');
  assert.strictEqual(status, 401);
  assert.match(headers.get('www-authenticate') || '', /Bearer/);
  // The error must not hint at the password's length or content.
  const text = JSON.stringify(body);
  assert.ok(!text.includes(PASSWORD));
  assert.ok(!/\d{2,}/.test(text), `error should not mention lengths: ${text}`);
});

/* ── static file allowlist ── */

test('source, data and config files are not served', async () => {
  const blocked = [
    '/server.js', '/store.js', '/measure.js',
    '/data/leads.jsonl', '/data/usage.json', '/data/survey-samples.json',
    '/catalogue.json', '/package.json', '/package-lock.json',
    '/README.md', '/.env', '/.gitignore',
    '/scripts/set-domain.js', '/scripts/validate-measurements.js',
    '/test/security.test.js',
    '/assets/swatches/CREDITS.md',
  ];
  for (const p of blocked) {
    const { status } = await get(p);
    assert.strictEqual(status, 404, `${p} must not be served, got ${status}`);
  }
});

test('path traversal cannot escape the allowlist', async () => {
  // A prefix check alone would wave these through: they normalise to files
  // that really do sit inside the project root.
  const attempts = [
    '/assets/../server.js',
    '/legal/../package.json',
    '/assets/%2e%2e/server.js',
    '/assets/..%2fserver.js',
    '/assets/./../../EXTERIOR-AI/server.js',
    '/legal/../data/leads.jsonl',
  ];
  for (const p of attempts) {
    const res = await realFetch(BASE + p);
    assert.strictEqual(res.status, 404, `${p} must not be served, got ${res.status}`);
  }
});

test('the genuinely public files are still served', async () => {
  for (const p of ['/', '/index.html', '/robots.txt', '/sitemap.xml', '/privacy', '/terms', '/legal/privacy.html']) {
    const { status } = await get(p);
    assert.strictEqual(status, 200, `${p} should be served, got ${status}`);
  }
});

test('no wildcard CORS header is sent', async () => {
  for (const p of ['/', '/api/catalogue']) {
    const { headers } = await get(p);
    assert.strictEqual(headers.get('access-control-allow-origin'), null, `${p} should send no CORS header`);
  }
});

test('/api/catalogue does not leak internal provenance fields', async () => {
  const { body } = await get('/api/catalogue');
  assert.ok(!('internalNote' in body), 'internalNote must be stripped');
  assert.ok(!('source' in body), 'source must be stripped');
  assert.ok(Array.isArray(body.cladding), 'but the catalogue itself is still served');

  // Nested notes used to carry these too, at any depth.
  const serialised = JSON.stringify(body);
  for (const marker of ['services/', 'quote_generator', 'material_detector', '.py', 'internalNote']) {
    assert.ok(!serialised.includes(marker), `public catalogue must not mention "${marker}"`);
  }
});

test('/api/catalogue does not publish the cost model', async () => {
  // Labour rates, the material-vs-labour split on trim, the waste allowance
  // and the scaffolding charge are the basis of every quote. The page never
  // reads them — prices come from /api/quote — so they have no business
  // being in a public response where a competitor can read the margin.
  const { body } = await get('/api/catalogue');
  for (const key of ['labour', 'trimRates', 'wastePct', 'scaffoldingCost', 'vatPct', 'defaultFootprintM2', 'defaultTrimLengthM']) {
    assert.ok(!(key in body), `${key} must not be public`);
  }
  const serialised = JSON.stringify(body);
  for (const marker of ['LabourPerM', 'claddingPerM2', 'roofPerM2', 'fasciaPerM']) {
    assert.ok(!serialised.includes(marker), `cost-model field "${marker}" leaked`);
  }

  // Swatches keep only what gets drawn — no per-material rates. Trim swatches
  // are colour-only and carry no image, so allow a subset rather than an
  // exact set.
  const allowed = new Set(['id', 'name', 'hex', 'image']);
  for (const item of [...body.cladding, ...body.trim, ...body.roof]) {
    for (const key of Object.keys(item)) {
      assert.ok(allowed.has(key), `swatch ${item.id} exposes "${key}"`);
    }
    assert.ok(item.id && item.name, `swatch ${item.id} still needs id and name`);
  }
});

test('the optional sections keep the figures they actually display', async () => {
  // The hardening is an allowlist, so it could just as easily strip too much.
  const { body } = await get('/api/catalogue');
  assert.ok(body.wholeHouse.finishes.every(f => f.pricePerM2 > 0), 'finish prices are rendered');
  assert.ok(body.conservatories.styles.every(s => s.priceMin && s.priceMax), 'guide ranges are rendered');
  assert.ok(body.fsgc.fascia.every(f => f.pricePerM > 0), 'guide rates are rendered');
  assert.ok(body.fsgc.cladding.some(f => f.guaranteeYears), 'guarantees are rendered');
  assert.ok(body.cladding.every(s => s.image), 'swatch images are needed to draw the preview');
  assert.ok(body.windowsDoors.colours.every(c => c.hex), 'colour chips need their hex');
});

test('/healthz reports storage, and says nothing else', async () => {
  // The host's health check. It exists mainly to catch a deploy with no
  // volume mounted — the failure that otherwise looks perfectly healthy
  // right up until the first lead is silently lost.
  const { status, body } = await get('/healthz');
  assert.strictEqual(status, 200);
  assert.strictEqual(body.ok, true);
  assert.strictEqual(body.storageWritable, true);
  // Must not become an information endpoint.
  assert.deepStrictEqual(Object.keys(body).sort(), ['mode', 'ok', 'storageWritable']);
  const text = JSON.stringify(body);
  for (const marker of ['PASSWORD', 'sk-', 'r8', 're_', '/Users/', 'node_modules']) {
    assert.ok(!text.includes(marker), `/healthz leaked "${marker}"`);
  }
});

/* ── daily spend caps ── */

test('the detect cap stops calling Anthropic once spent', async () => {
  const before = upstream.anthropic;
  const payload = { image: tinyJpeg(), mimeType: 'image/jpeg' };

  for (let i = 0; i < DAILY_DETECT; i++) {
    const { status } = await post('/api/detect', payload);
    assert.strictEqual(status, 200, `call ${i + 1} should succeed`);
  }
  assert.strictEqual(upstream.anthropic, before + DAILY_DETECT, 'each allowed call reaches the provider');

  const { status, body } = await post('/api/detect', payload);
  assert.strictEqual(status, 429);
  // Assert the machine-readable reason, not the wording — the copy is written
  // to keep the homeowner going and is expected to change.
  assert.strictEqual(body.reason, 'daily_limit');
  assert.strictEqual(upstream.anthropic, before + DAILY_DETECT, 'a capped call must NOT reach the provider');
});

test('the render cap is counted separately from detect', async () => {
  const before = upstream.replicate;
  const payload = { image: tinyJpeg(), mimeType: 'image/jpeg', claddingName: 'Alabaster' };

  const first = await post('/api/render', payload);
  assert.strictEqual(first.status, 200);
  assert.strictEqual(upstream.replicate, before + 1);

  const second = await post('/api/render', payload);
  assert.strictEqual(second.status, 429, 'render has its own limit of 1 here');
  assert.strictEqual(upstream.replicate, before + 1, 'a capped render must NOT reach the provider');
});

test('a spent cap keeps the journey open rather than dead-ending', async () => {
  // Both caps are exhausted by the tests above. The refusal has to say which
  // capability is unavailable and that the rest still works — a homeowner who
  // reads "try again tomorrow" leaves, and the lost lead costs more than the
  // API call would have.
  const detect = await post('/api/detect', { image: tinyJpeg(), mimeType: 'image/jpeg' });
  const render = await post('/api/render', { image: tinyJpeg(), mimeType: 'image/jpeg' });
  for (const [name, r] of [['detect', detect], ['render', render]]) {
    assert.strictEqual(r.status, 429, name);
    assert.strictEqual(r.body.reason, 'daily_limit', `${name} should be identifiable as a cap`);
    assert.strictEqual(r.body.canContinue, true, `${name} should say the journey continues`);
    assert.ok(!/try again tomorrow/i.test(r.body.error), `${name} should not dead-end`);
    assert.match(r.body.error, /still/i, `${name} should say what still works`);
  }

  // And the unpaid parts of the journey must genuinely still work.
  const quote = await post('/api/quote', { claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', houseType: 'semi' });
  assert.strictEqual(quote.status, 200);
  assert.ok(quote.body.total > 0, 'an estimate is still available with both caps spent');
});

test('a malformed request does not spend quota', async () => {
  // Validation runs before the cap, so junk costs nothing. Both endpoints are
  // already capped out by now, and a 400 proves the check ran first.
  const { status } = await post('/api/detect', {});
  assert.strictEqual(status, 400);
});

/* ── lead capture ── */

test('lead capture is on by default', async () => {
  // The switch has to fail safe in the other direction too: a site that has
  // quietly stopped capturing leads is its own kind of failure.
  const { body } = await get('/api/config');
  assert.strictEqual(body.leadCapture, true, 'LEAD_CAPTURE is unset here, so capture should be on');
});

test('a lead without consent is refused', async () => {
  const { status, body } = await post('/api/lead', { name: 'A', email: 'a@example.com' });
  assert.strictEqual(status, 400);
  assert.match(body.error, /tick the box|agree/i);
});

test('a lead is stored even when it cannot be emailed, and says so', async () => {
  const { status, body } = await post('/api/lead', {
    name: 'Jane', email: 'jane@example.com',
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
    /* Terms only. This run has no RESEND_API_KEY, and asking for installer
       quotes without email is refused outright — we would be sharing their
       details with no way to send them the link that undoes it. That refusal
       has its own tests; this one is about the lead surviving a failed
       notification. */
    consent: { terms: true, installerQuotes: false, version: 'v' },
  });
  assert.strictEqual(status, 200);
  assert.ok(body.lead.id, 'the lead is saved regardless');
  // No RESEND_API_KEY in this run, so it must report that rather than pretend.
  assert.strictEqual(body.lead.notification.sent, false);
  assert.match(body.lead.notification.reason, /RESEND_API_KEY/);
});

test('the price on a lead is recomputed, never taken from the client', async () => {
  const { body } = await post('/api/lead', {
    name: 'Mallory', email: 'm@example.com',
    claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar',
    price: 1, total: 1, priceBreakdown: { total: 1 },   // all ignored
    consent: { terms: true, installerQuotes: false, version: 'v' },   // see above
  });
  assert.ok(body.lead.price > 1000, `price should be server-computed, got ${body.lead.price}`);
});

test('an invalid email is refused', async () => {
  const { status } = await post('/api/lead', {
    name: 'A', email: 'not-an-email',
    consent: { terms: true, installerQuotes: true, version: 'v' },
  });
  assert.strictEqual(status, 400);
});

test('the guided demo is not published', async () => {
  /* An unmaintained fork of the product UI that asks for a real email address
     and posts it to /api/lead with no consent object, and links to neither the
     privacy notice nor the terms. Nothing links to it, and it carried a
     canonical tag, so its only visitors would have been search engines. */
  const { status } = await get('/guided-demo.html');
  assert.strictEqual(status, 404, 'it collects an email address from a page with no privacy notice');
});
