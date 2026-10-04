'use strict';
/* 0074: the site can be added to a home screen and opens like an app. */
require('./helpers/data-dir');
const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3157;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the manifest is served, parses, and names icons that exist', async () => {
  const res = await fetch(BASE + '/assets/manifest.webmanifest');
  assert.strictEqual(res.status, 200);
  const m = JSON.parse(await res.text());
  assert.strictEqual(m.display, 'standalone');
  assert.strictEqual(m.short_name, 'Facet Pro');
  assert.match(m.start_url, /^\/design/);
  assert.ok(m.icons.some(i => i.sizes === '192x192'));
  assert.ok(m.icons.some(i => i.sizes === '512x512' && i.purpose === 'any'));
  assert.ok(m.icons.some(i => i.purpose === 'maskable'));
  for (const i of m.icons) {
    const r = await fetch(BASE + i.src);
    assert.strictEqual(r.status, 200, i.src);
    assert.match(r.headers.get('content-type') || '', /image\/png/);
  }
});

test('the worker is served from the root, as script, not cached', async () => {
  const res = await fetch(BASE + '/sw.js');
  assert.strictEqual(res.status, 200);
  assert.match(res.headers.get('content-type') || '', /javascript/);
  assert.match(res.headers.get('cache-control') || '', /no-cache/);
});

test('opening /sw.js did not open the rest of the source', async () => {
  for (const p of ['/server.js', '/pwa/sw.js', '/glazing.js']) {
    assert.notStrictEqual((await fetch(BASE + p)).status, 200, p);
  }
});

test('the worker caches the offline page and nothing else', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'pwa', 'sw.js'), 'utf8');
  assert.match(sw, /if \(e\.request\.mode !== 'navigate'\) return;/, 'only page loads are touched');
  assert.strictEqual((sw.match(/\.add\(|\.addAll\(|\.put\(/g) || []).length, 1, 'one thing cached: the offline page');
});

test('there is an offline page with no script in it', async () => {
  const res = await fetch(BASE + '/offline');
  assert.strictEqual(res.status, 200);
  const body = await res.text();
  assert.match(body, /You're offline/);
  assert.doesNotMatch(body, /<script/i);
});

test('the page links the manifest, registers the worker, and offers install after the reveal', () => {
  assert.match(html, /<link rel="manifest" href="\/assets\/manifest\.webmanifest">/);
  assert.match(html, /navigator\.serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(html, /beforeinstallprompt/);
  assert.match(html, /state\.revealed = true;[\s\S]{0,200}window\.fpOfferInstall\(\)/);
  const s = html.slice(html.indexOf('window.fpOfferInstall = function'));
  assert.match(s, /if \(standalone\(\) \|\| offered\(\)\) return;/, 'never when installed, once a visit');
  assert.match(s, /if \(!deferred && !iosSafari\(\)\) return;/, 'never in a browser that cannot install');
});
