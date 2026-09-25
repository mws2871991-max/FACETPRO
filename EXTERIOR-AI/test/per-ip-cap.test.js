/* One visitor cannot take the whole day's allowance.

   The global daily cap bounds the bill and nothing else. At five renders a
   minute, one address can spend all of them in half an hour — for free — and
   every homeowner after that is told the site is busy until midnight UTC.
   That is a denial of service on the one step this product exists for, and
   the person doing it pays nothing for it.

   So these are the two properties that matter, and they pull against each
   other: one address must not be able to exhaust the shared allowance, and a
   second address must still be served after the first has spent its own.

   The per-minute limiter cannot do this job. It is five a minute, which is
   thirty an hour and seven hundred a day; it shapes bursts, not budgets.

   Its own file because the per-address cap has to be SMALLER than the global
   one to be observable at all, and security.test.js sets the global one to 1. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3141;
const BASE = `http://127.0.0.1:${PORT}`;

const PER_IP = 2;
const GLOBAL = 10;

const upstream = { replicate: 0 };
const renderOutput = require('./helpers/render-output');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.replicate.com')) {
    upstream.replicate++;
    return { ok: true, status: 200, json: async () => ({ status: 'succeeded', output: 'https://example.test/r.jpg' }) };
  }
  if (renderOutput.isRenderOutput(u)) return renderOutput.response();
  return realFetch(u, opts);
};

fs.rmSync(path.join(process.env.FACETPRO_DATA_DIR, 'usage.json'), { force: true });

process.env.PORT = String(PORT);
process.env.REPLICATE_API_TOKEN = 'r8-test';
process.env.DAILY_RENDER_LIMIT = String(GLOBAL);
process.env.DAILY_RENDER_PER_IP = String(PER_IP);
/* Five a minute is the real limiter and would refuse the sixth call below
   before the daily cap could be reached. This file is about the day, not the
   minute — the minute is tested by express-rate-limit itself. */
process.env.RENDER_RATE_LIMIT = '1000';

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

/* A 1x1 JPEG, so the request is a real photograph and reaches the cap rather
   than being turned away as invalid. */
const tinyJpeg = () => Buffer.from(
  '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a'
  + 'HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA'
  + 'AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64',
).toString('base64');

/* Two different addresses, through the header express is told to trust —
   server.js sets `trust proxy` to 1, so this is how a request arrives from
   behind Railway's proxy and it is the same path a real visitor's address
   takes. */
const render = (ip) => fetch(`${BASE}/api/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip },
  body: JSON.stringify({
    image: tinyJpeg(), mimeType: 'image/jpeg',
    roofId: 'slate-roof', roofName: 'Slate Roof',
    claddingId: 'none', trimId: 'none',
    claddingName: 'Leave as it is', trimName: 'Leave as it is',
  }),
}).then(async r => ({ status: r.status, body: await r.json().catch(() => ({})) }));

test('one address is held to its own allowance', async () => {
  for (let i = 1; i <= PER_IP; i++) {
    const { status } = await render('203.0.113.9');
    assert.strictEqual(status, 200, `call ${i} from one address should be served`);
  }

  const spent = await render('203.0.113.9');
  assert.strictEqual(spent.status, 429, 'a third call from the same address should be refused');
  assert.strictEqual(spent.body.reason, 'daily_limit');

  /* The refusal must cost nothing. A cap that still pays the provider is a
     bill with extra steps. */
  const paidSoFar = upstream.replicate;
  await render('203.0.113.9');
  assert.strictEqual(upstream.replicate, paidSoFar,
    'a refused call reached the provider anyway');
});

test('and the next visitor is still served', async () => {
  /* The property that makes this worth having. Before it, the first address
     could spend the whole day and everybody after them met the same 429 —
     which is exactly the outcome the cap exists to prevent, arriving by a
     different route. */
  const { status } = await render('198.51.100.4');
  assert.strictEqual(status, 200,
    'a second address was refused because the first had spent its allowance');
});

test('the shared allowance still stops the bill', async () => {
  /* The per-address cap decides who spends; the global cap decides how much
     is spent at all. Enough addresses must still hit the ceiling. */
  for (let i = 0; i < 20; i++) await render(`192.0.2.${i + 1}`);

  const { status, body } = await render('192.0.2.200');
  assert.strictEqual(status, 429, 'the global cap did not hold');
  assert.strictEqual(body.reason, 'daily_limit');
  assert.ok(upstream.replicate <= GLOBAL,
    `the provider was called ${upstream.replicate} times against a cap of ${GLOBAL}`);
});

test('a spent cap still leaves the journey open', async () => {
  /* Same promise the global cap already makes, asserted for this one too: a
     homeowner who is refused a picture keeps their price. Losing the render
     is a disappointment; losing the estimate is a lost customer. */
  const { body } = await render('203.0.113.9');
  assert.strictEqual(body.canContinue, true);
  assert.ok(!/try again tomorrow/i.test(body.error || ''), 'the refusal dead-ends');

  const quote = await fetch(`${BASE}/api/quote`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ claddingId: 'sage-slate', roofId: 'terracotta', trimId: 'cedar', houseType: 'semi' }),
  }).then(r => r.json());
  assert.ok(quote.total > 0, 'an estimate is still available with the cap spent');
});
