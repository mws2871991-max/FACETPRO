/* Carrying a design from one device to another.

   Somebody at a desk has chosen their windows and now has to go outside and
   photograph their house. That is where most of them stop. A six-character
   code is the bridge.

   The reason it is a code and not an emailed link is the reason most of these
   tests exist: an email address collected to send a link is personal data,
   with a lawful basis, a retention period, a line in the notice and something
   to disclose if it leaks. Storing only the choices means there is nothing
   here to protect — so the tests that matter are the ones proving nothing
   else gets in. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const resume = require('../resume');

const PORT = 3080;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
require('../server');

const issue = async (body) => {
  const res = await realFetch(`${BASE}/api/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const redeem = async (code) => {
  const res = await realFetch(`${BASE}/api/resume/${encodeURIComponent(code)}`);
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

const DESIGN = {
  claddingId: 'sage-slate', roofId: 'terracotta', houseType: 'semi',
  windowStyleId: 'flush', windowDoorColourId: 'anthracite', windowCount: 9,
};

/* ── the payload, which is the whole point ── */

test('a photograph never travels with the code', async () => {
  const { body } = await issue({ ...DESIGN, image: 'BASE64IMAGEDATA', uploadedBase64: 'MORE', mimeType: 'image/jpeg' });
  const { body: back } = await redeem(body.code);
  const serialised = JSON.stringify(back);
  assert.ok(!/BASE64IMAGEDATA|MORE|image\/jpeg/.test(serialised), serialised);
});

test('nothing about the person travels either', async () => {
  const { body } = await issue({
    ...DESIGN, name: 'Jane Doe', email: 'jane@example.com',
    phone: '07700900000', postcode: 'SW11 4NP', notes: 'my wife uses a wheelchair',
  });
  const { body: back } = await redeem(body.code);
  const serialised = JSON.stringify(back);
  for (const value of ['Jane Doe', 'jane@example.com', '07700900000', 'SW11 4NP', 'wheelchair']) {
    assert.ok(!serialised.includes(value), `"${value}" travelled with the code`);
  }
});

test('the choices themselves do travel', async () => {
  const { body } = await issue(DESIGN);
  const { status, body: back } = await redeem(body.code);
  assert.strictEqual(status, 200);
  assert.deepStrictEqual(back.design, DESIGN);
});

test('the allowlist is a list of names, not a filter to be got round', () => {
  // Anything not named is simply not built into the payload.
  const built = resume.buildPayload({ claddingId: 'sage-slate', somethingNew: 'x', __proto__: { evil: 1 } });
  assert.deepStrictEqual(Object.keys(built), ['claddingId']);
});

test('numbers out of range are dropped rather than carried', () => {
  const built = resume.buildPayload({ windowCount: 9999, footprintM2: -5, trimLengthM: 1e12, claddingId: 'x' });
  assert.deepStrictEqual(Object.keys(built), ['claddingId']);
});

/* ── the code ── */

test('a code is unambiguous and unguessable enough for what it holds', () => {
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const code = resume.newCode();
    assert.match(code, /^[0-9A-HJKMNP-TV-Z]{6}$/, code);   // no I, L, O or U
    seen.add(code);
  }
  assert.ok(seen.size > 19800, `only ${seen.size} distinct in 20,000 — not random enough`);
});

test('a code typed the way people type is still read', async () => {
  const { body } = await issue(DESIGN);
  // Lower case, spaces, and the two substitutions everybody makes.
  const mangled = ' ' + body.code.toLowerCase().replace(/0/g, 'o').replace(/1/g, 'l') + ' ';
  const { status } = await redeem(mangled);
  assert.strictEqual(status, 200, `"${mangled}" should still redeem`);
});

test('an expired code is gone, and says the same as one that never existed', () => {
  const rows = [{ code: 'ABCDEF', ts: '2026-08-01T00:00:00Z', expiresAt: '2026-08-01T12:00:00Z', design: {} }];
  assert.strictEqual(resume.find(rows, 'ABCDEF', Date.parse('2026-08-01T13:00:00Z')), null);
  assert.ok(resume.find(rows, 'ABCDEF', Date.parse('2026-08-01T11:00:00Z')));
});

test('an unknown code and an expired one are the same answer', async () => {
  const { status, body } = await redeem('ZZZZZZ');
  assert.strictEqual(status, 404);
  assert.match(body.error, /expired or we don’t recognise it/);
  assert.strictEqual(body.reason, 'not_found');
});

test('a code that is not a code is refused before anything is read', async () => {
  for (const bad of ['', 'AB', 'not-a-code', 'A'.repeat(50)]) {
    const { status } = await redeem(bad || 'x');
    assert.strictEqual(status, 400, JSON.stringify(bad));
  }
});

test('choosing nothing gets no code', async () => {
  const { status, body } = await issue({ name: 'Jane', email: 'j@example.com' });
  assert.strictEqual(status, 400, 'a code holding nothing is a code worth nothing');
  assert.strictEqual(body.reason, 'nothing_to_save');
});

test('re-issuing gives the newest design, not the first', () => {
  // The JSONL backend is append-only, so both rows survive a re-issue.
  const rows = [
    { code: 'ABCDEF', ts: '2026-08-02T10:00:00Z', expiresAt: '2026-08-03T10:00:00Z', design: { claddingId: 'old' } },
    { code: 'ABCDEF', ts: '2026-08-02T11:00:00Z', expiresAt: '2026-08-03T11:00:00Z', design: { claddingId: 'new' } },
  ];
  assert.strictEqual(resume.find(rows, 'ABCDEF', Date.parse('2026-08-02T12:00:00Z')).design.claddingId, 'new');
});

test('the code is not cached anywhere between us and the browser', async () => {
  const res = await realFetch(`${BASE}/api/resume`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(DESIGN),
  });
  assert.match(res.headers.get('cache-control') || '', /no-store/);
});
