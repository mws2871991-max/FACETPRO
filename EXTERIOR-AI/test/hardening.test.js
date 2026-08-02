/* Findings from the production review, each with the failure it prevents.

   Three of these were proven against a running server before they were fixed:
   a lead reference collision that destroys a different customer's record, a
   client-set wall area that produced a £231bn quote marked "exact", and an
   Express stack trace served to anyone who sends malformed JSON. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');

const PORT = 3084;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
const { _internals } = require('../server');
const { newLeadId } = _internals;

const post = async (p, payload, raw) => {
  const res = await realFetch(BASE + p, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: raw !== undefined ? raw : JSON.stringify(payload),
  });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch (_) { body = text; }
  return { status: res.status, body, type: res.headers.get('content-type') || '' };
};

/* ── C-1: references that cannot collide ── */

test('lead references do not repeat', () => {
  /* The old scheme drew four digits from a pool of nine thousand with no
     uniqueness check: a coin flip at 112 leads. lead.id is the join key for
     withdrawal, retention and erasure, so a duplicate means one homeowner
     asking to be deleted takes another's record — and their consent evidence
     — with them.

     Fifty thousand is far past the point the old scheme was certain to fail. */
  const seen = new Set();
  for (let i = 0; i < 50000; i++) seen.add(newLeadId());
  assert.strictEqual(seen.size, 50000, `${50000 - seen.size} collision(s)`);
});

test('a reference is unambiguous when read aloud', () => {
  // Crockford base32 drops I, L, O and U so nothing is misheard on the phone.
  for (let i = 0; i < 2000; i++) {
    assert.match(newLeadId(), /^LD-[0-9A-HJKMNP-TV-Z]{12}$/);
  }
});

test('a reference is not guessable, which the old four digits were', () => {
  // 60 bits. The point is not just collisions: LD-4242 was enumerable.
  const a = new Set();
  for (let i = 0; i < 1000; i++) a.add(newLeadId().slice(3, 6));
  assert.ok(a.size > 900, `only ${a.size} distinct prefixes in 1000 — not random enough`);
});

/* ── C-2: the client cannot set the price ── */

test('an absurd wall area does not become an absurd quote', async () => {
  // Proven against the old build: 100,000,000 m² returned £23,118,005,410.
  for (const footprintM2 of [100000000, 999999999, 1e30, -5, 0.001]) {
    const { status, body } = await post('/api/quote', { claddingId: 'sage-slate', footprintM2 });
    assert.strictEqual(status, 200, String(footprintM2));
    assert.ok(body.total < 200000, `${footprintM2} m² produced £${body.total}`);
  }
});

test('a plausible area is still honoured — this is a clamp, not a wall', async () => {
  const small = await post('/api/quote', { claddingId: 'sage-slate', footprintM2: 40 });
  const large = await post('/api/quote', { claddingId: 'sage-slate', footprintM2: 200 });
  assert.ok(large.body.total > small.body.total * 2, 'real areas must still drive the price');
});

test('an absurd trim length does not either', async () => {
  const { body } = await post('/api/quote', { claddingId: 'sage-slate', footprintM2: 95, trimLengthM: 1e12 });
  assert.ok(body.total < 200000, `£${body.total}`);
});

test('a tampered area never reaches a stored lead', async () => {
  const { body } = await post('/api/lead', {
    name: 'Mallory', email: 'm@example.com', footprintM2: 999999999,
    claddingId: 'sage-slate', consent: { terms: true, version: 'v' },
  });
  assert.strictEqual(body.lead.price < 200000, true, `stored £${body.lead?.price}`);
  assert.notStrictEqual(body.lead.measurementSource, 'manual_entry',
    'an out-of-band value should fall back to the measurement, not be dressed up as one');
});

/* ── H-3: errors stay inside the building ── */

test('malformed JSON gets JSON back, not a stack trace', async () => {
  const { status, body, type } = await post('/api/quote', null, '{bad json');
  assert.strictEqual(status, 400);
  assert.match(type, /application\/json/, 'the front end calls res.json() unconditionally');
  assert.strictEqual(body.error, 'Malformed request.');
  const serialised = JSON.stringify(body);
  assert.ok(!/SyntaxError|node_modules|\/Users\/|at\s+\w+\s+\(/.test(serialised), serialised);
});

test('an unknown API path is a JSON 404', async () => {
  const res = await realFetch(`${BASE}/api/nope`);
  assert.strictEqual(res.status, 404);
  assert.match(res.headers.get('content-type') || '', /application\/json/);
});

test('an unknown page is a page, not a stack trace', async () => {
  const res = await realFetch(`${BASE}/nope`);
  assert.strictEqual(res.status, 404);
  const html = await res.text();
  assert.ok(!/Error|node_modules|\/Users\//.test(html), html.slice(0, 200));
});

test('the server does not announce what it is', async () => {
  const res = await realFetch(`${BASE}/`);
  assert.strictEqual(res.headers.get('x-powered-by'), null);
});

/* ── H-5: nobody can plant 20MB in the lead store ── */

test('long fields are capped, not stored whole', async () => {
  const { status, body } = await post('/api/lead', {
    name: 'A'.repeat(500000), email: 'a@example.com',
    phone: 'B'.repeat(100000), postcode: 'C'.repeat(100000),
    claddingId: 'sage-slate', consent: { terms: true, version: 'v' },
  });
  assert.strictEqual(status, 200);
  assert.strictEqual(body.lead.name.length, 100);
  assert.strictEqual(body.lead.phone.length, 32);
  assert.strictEqual(body.lead.postcode.length, 12);
});

test('whitespace is trimmed, so " " is not a name', async () => {
  const { status, body } = await post('/api/lead', {
    name: '   ', email: 'a@example.com', claddingId: 'sage-slate',
    consent: { terms: true, version: 'v' },
  });
  assert.strictEqual(status, 400, JSON.stringify(body));
});

test('a single-letter TLD is not an email address', async () => {
  const { status } = await post('/api/lead', {
    name: 'Jane', email: 'a@b.c', claddingId: 'sage-slate',
    consent: { terms: true, version: 'v' },
  });
  assert.strictEqual(status, 400);
});
