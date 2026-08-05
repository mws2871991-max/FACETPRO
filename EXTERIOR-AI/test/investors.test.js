/* The investor page must not be readable by whoever finds the URL.

   It describes a pre-revenue UK company and itemises what money would be
   spent on. s.21 FSMA 2000 restricts communicating an inducement to engage in
   investment activity, and the exemptions — certified high net worth,
   self-certified sophisticated investor — require the reader to have
   certified BEFORE the communication reaches them. A public URL cannot do
   that. Breach is a criminal offence.

   It shipped open. `robots.txt` said `Disallow: /investors` with a comment
   reading "sent to people directly; not for search", which keeps it out of
   search results and keeps nobody out. The comment described an intention the
   server did not enforce — the same failure as a CSS rule guarded by a class
   nothing ever set, and the reason both are now pinned by tests rather than
   by good intentions.

   Two doors, and the second is the one that will be forgotten: the page used
   to live in legal/, which is in PUBLIC_DIRS, so express.static served the
   file underneath the route. It now lives in gated/. If anybody moves it
   back, or adds gated/ to the public list, the tests below fail. */

'use strict';

require('./helpers/data-dir');

const {test, before } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');

const PORT = 3106;
const BASE = `http://127.0.0.1:${PORT}`;
const PASSWORD = 'test-investor-password';

process.env.PORT = String(PORT);
process.env.INVESTOR_PASSWORD = PASSWORD;

require('../server');

/* The server listens asynchronously. Against JSONL that is a tick; against
   Postgres it is a schema, and a fetch issued before the socket exists fails
   with "fetch failed". See test/helpers/server-ready.js. */
before(async () => { await require('./helpers/server-ready')(BASE); });

const get = (p, opts) => fetch(BASE + p, opts);

test('the page is not served to somebody with no password', async () => {
  const res = await get('/investors');
  assert.notStrictEqual(res.status, 200,
    'the investor page is readable by anybody with the link');
  assert.strictEqual(res.status, 404,
    'an unauthenticated visitor should not learn the page exists');
});

test('a wrong password is refused', async () => {
  const res = await get('/investors?k=not-the-password');
  assert.notStrictEqual(res.status, 200, 'a wrong password got in');
});

test('the right password gets in', async () => {
  const res = await get('/investors?k=' + encodeURIComponent(PASSWORD));
  assert.strictEqual(res.status, 200, 'the correct password was refused');
  assert.match(await res.text(), /For investors/, 'the wrong page came back');
});

test('a bearer token works, for a link not pasted into a URL', async () => {
  const res = await get('/investors', { headers: { authorization: `Bearer ${PASSWORD}` } });
  assert.strictEqual(res.status, 200);
});

test('there is no static path to the file underneath the gate', async () => {
  /* The original bug: the page sat in legal/, and /legal/ is a public
     directory, so the gate on /investors was decoration. */
  for (const p of ['/legal/investors.html', '/gated/investors.html']) {
    const res = await get(p);
    assert.notStrictEqual(res.status, 200, `${p} serves the page around the gate`);
  }
});

test('the file is not in a directory the static handler will serve', () => {
  /* Asserts the arrangement rather than the symptom, so moving the file back
     into legal/ fails here even if the routes were changed to match. */
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const dirs = server.match(/const PUBLIC_DIRS = \[([^\]]*)\]/);
  assert.ok(dirs, 'PUBLIC_DIRS has moved or been renamed — re-check this test');
  assert.ok(!/gated/.test(dirs[1]), 'gated/ has been made a public directory');
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'gated', 'investors.html')),
    'the investor page is not where the gated route expects it');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'legal', 'investors.html')),
    'a copy is back in legal/, which express.static serves publicly');
});

test('the page carries a risk warning and disclaims being an offer', () => {
  /* No substitute for the solicitor's wording, but it fails loudly if
     somebody deletes the placeholder rather than filling it in. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'gated', 'investors.html'), 'utf8');
  assert.match(page, /capital at risk|lose all of it/i, 'no risk warning on the page');
  assert.match(page, /not an offer or invitation/i, 'the page does not disclaim being an offer');
});
