/* A tab left open should not go on running an old page forever.

   Caching is not the problem and has not been since 7 August: HTML and CSS are
   served must-revalidate, so a returning visitor gets the current page on their
   next load. The problem is the visit that never ends — somebody opens Facet
   Pro, wanders off, comes back two hours later, and is still running the
   JavaScript from before a deploy against a server that has moved on. That is
   how a page shows a price the server would no longer produce.

   /api/version answers with a hash of what the browser was actually given. The
   page records it on load and checks again when the tab comes back to the
   foreground; a different answer means the page is older than the server, and
   it offers a refresh rather than forcing one — somebody halfway through
   choosing a colour should not have the page pulled out from under them. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3129;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

test('the build id is served, and never cached', async () => {
  /* A cached answer to "is this stale" is the one thing that cannot be cached. */
  const res = await fetch(`${BASE}/api/version`);
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('cache-control') || '', /no-store/);
  const body = await res.json();
  assert.match(body.build, /^[a-f0-9]{12}$/, `unexpected build id: ${body.build}`);
});

test('it is the same answer twice, so a poll does not cry wolf', async () => {
  const a = (await (await fetch(`${BASE}/api/version`)).json()).build;
  const b = (await (await fetch(`${BASE}/api/version`)).json()).build;
  assert.strictEqual(a, b, 'the build id changed without the build changing');
});

test('it is derived from what the browser is actually given', async () => {
  /* If it were a timestamp or a random value it would change on every restart
     and prompt everybody to refresh for nothing. It has to be a function of
     the bytes. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const block = src.slice(src.indexOf('const BUILD_ID'), src.indexOf('app.get(\'/api/version\''));
  assert.match(block, /index\.html/, 'the build id should hash the page');
  assert.match(block, /app\.css/, 'and the stylesheet, so a style-only change counts');
  assert.doesNotMatch(block, /Date\.now|randomBytes|randomUUID/,
    'the build id must not be a timestamp or a random value — every restart would prompt a refresh');
});

test('the page checks on refocus rather than on a timer', async () => {
  /* A poll every minute is a request per minute per open tab, forever, for
     something that changes about once a week. The moment that matters is the
     moment somebody looks at the tab again. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(page, /visibilitychange/, 'nothing re-checks when the tab is refocused');
  assert.match(page, /checkBuild/);
  assert.doesNotMatch(page, /setInterval\([^)]*checkBuild/, 'the build check should not be on a timer');
});

test('a stale page is offered a refresh, never given one', async () => {
  /* location.reload() on a timer would throw away a design somebody is halfway
     through. The prompt has to be dismissible and the reload has to be theirs. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fn = page.slice(page.indexOf('function offerRefresh'), page.indexOf('async function checkBuild'));
  assert.match(fn, /location\.reload/, 'the prompt should be able to reload');
  assert.match(fn, /Dismiss|aria-label/, 'and should be dismissible');
  assert.ok(!/setTimeout\([^)]*location\.reload/.test(page), 'nothing may reload the page on its own');
});

test('the first check records rather than warns', async () => {
  /* On the very first answer there is nothing to compare against. Warning then
     would show the prompt to everybody on every load. */
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const fn = page.slice(page.indexOf('async function checkBuild'), page.indexOf('document.addEventListener(\'visibilitychange\''));
  assert.match(fn, /buildAtLoad === null/, 'the first reading should be stored, not compared');
});
