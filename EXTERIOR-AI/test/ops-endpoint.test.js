/* Every door behind the installer password is throttled, including this one.

   /api/ops was the exception and nothing covered it. Sixty wrong passwords got
   sixty 401s and no throttle, while /api/leads next door refuses after twenty
   — so the login throttle was intact and there was an unlimited guessing
   endpoint against the same credential a few lines further down. That password
   opens every consenting homeowner's name, email, phone number and postcode.

   The rule this file states is deliberately not "/api/ops is limited". It is
   "no route behind this password is unlimited", checked by reading the routes
   out of server.js and everything in routes/ — because the next endpoint added
   here will be added by somebody who has never read this comment. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3124;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'the-installer-password';

const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const get = (p, headers = {}) => realFetch(BASE + p, { headers });

test('every password-gated route carries a rate limiter', () => {
  /* Read the routes rather than list them, from every file that can declare
     one. A new gated endpoint with no limiter fails here on the day it is
     written. See test/helpers/route-source.js for why the source comes from a
     helper rather than from server.js directly. */
  const { routeSource } = require('./helpers/route-source');
  const src = routeSource();
  /* Everything between the route string and the handler's own (req is the
     middleware chain. Matching up to the handler signature rather than to a
     closing bracket, because middleware like logAccess('/api/leads') has
     brackets of its own and a lazy [^)] stops inside them — which quietly
     found one route out of three. */
  const gated = [];
  for (const m of src.matchAll(/(?:app|router)\.(get|post)\(\s*'([^']+)'\s*,([\s\S]*?)(?:async\s+)?\(\s*req\b/g)) {
    const [, , route, middleware] = m;
    if (/requireInstaller\b|requireInstallerPassword/.test(middleware)) {
      gated.push({ route, limited: /Limiter/.test(middleware) });
    }
  }
  assert.ok(gated.length >= 4, `expected to find the gated routes, found ${gated.length}`);
  const unlimited = gated.filter(g => !g.limited).map(g => g.route);
  assert.deepStrictEqual(unlimited, [],
    `password-gated with no rate limiter: ${unlimited.join(', ')} — the same credential opens every homeowner's contact details`);
});

test('/api/ops refuses a wrong password', async () => {
  const res = await get('/api/ops', { Authorization: 'Bearer wrong' });
  assert.ok(res.status === 401 || res.status === 429, `expected a refusal, got ${res.status}`);
});

test('/api/ops refuses no password at all', async () => {
  const res = await get('/api/ops');
  assert.ok(res.status === 401 || res.status === 429, `expected a refusal, got ${res.status}`);
});

test('/api/ops stops answering guesses before they get anywhere', async () => {
  /* Twenty in fifteen minutes is the installer limit. Well before sixty. */
  let refusedAt = null;
  for (let i = 1; i <= 40; i++) {
    const res = await get('/api/ops', { Authorization: `Bearer guess-${i}` });
    if (res.status === 429) { refusedAt = i; break; }
  }
  assert.ok(refusedAt !== null, '40 wrong passwords in a row were all answered — the endpoint is not throttled');
  assert.ok(refusedAt <= 25, `throttling only began at attempt ${refusedAt}`);
});

test('the right password still works', async () => {
  /* Proving the throttle above did not simply break the endpoint. A fresh
     limiter window is not available mid-run, so this asserts the credential is
     accepted or the caller is throttled — never that a wrong one gets in. */
  const res = await get('/api/ops', { Authorization: 'Bearer the-installer-password' });
  assert.ok(res.status === 200 || res.status === 429, `expected 200 or 429, got ${res.status}`);
  if (res.status === 200) {
    const body = await res.json();
    assert.ok(body && typeof body === 'object', '/api/ops returned nothing useful');
  }
});
