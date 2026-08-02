/* Security headers, and the third parties the pages reach for.

   Two separate concerns that happen to live in the same place.

   Article 32 asks for measures appropriate to the risk. For a site handling
   contact details and photographs of people's homes, a content-security
   policy and a frame-ancestors rule are the floor.

   And the legal pages used to load Tailwind from a CDN and fonts from Google,
   so every reader's IP address reached two third parties from the page whose
   purpose is to explain that we do not do that. Google Fonts has been
   litigated on exactly that point. Both are now served from here. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3096;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
require('../server');

const parseCsp = (header) => Object.fromEntries(
  (header || '').split(';').map(d => d.trim()).filter(Boolean)
    .map(d => { const [name, ...values] = d.split(/\s+/); return [name, values]; }));

test('every page carries the baseline headers', async () => {
  const res = await realFetch(`${BASE}/`);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.headers.get('x-content-type-options'), 'nosniff');
  assert.strictEqual(res.headers.get('x-frame-options'), 'DENY');
  assert.match(res.headers.get('referrer-policy'), /strict-origin/);
  assert.match(res.headers.get('permissions-policy'), /camera=\(\)/);
  assert.ok(res.headers.get('content-security-policy'), 'a CSP is the whole point');
});

test('nothing may frame the site — clickjacking a consent box is the risk', async () => {
  const res = await realFetch(`${BASE}/`);
  assert.deepStrictEqual(parseCsp(res.headers.get('content-security-policy'))['frame-ancestors'], ["'none'"]);
});

test('the legal pages allow no script at all', async () => {
  for (const p of ['/privacy', '/terms']) {
    const res = await realFetch(BASE + p);
    assert.strictEqual(res.status, 200, p);
    const csp = parseCsp(res.headers.get('content-security-policy'));
    assert.deepStrictEqual(csp['script-src'], ["'none'"], `${p} needs no JavaScript to show text`);
    assert.deepStrictEqual(csp['default-src'], ["'self'"]);
    assert.deepStrictEqual(csp['connect-src'], ["'none'"]);
    assert.deepStrictEqual(csp['font-src'], ["'self'"], 'fonts come from us now');
    // No 'unsafe-inline' escape hatch anywhere in the legal policy.
    assert.ok(!res.headers.get('content-security-policy').includes('unsafe'), `${p} has an escape hatch`);
  }
});

test('the app policy still names every host it actually needs', async () => {
  const csp = parseCsp((await realFetch(`${BASE}/`)).headers.get('content-security-policy'));
  // The visualiser compiles Tailwind in the browser, which needs eval. That is
  // a real weakness and the reason to move to a built stylesheet — but the
  // policy must at least be honest about it rather than absent.
  assert.ok(csp['script-src'].includes('https://cdn.tailwindcss.com'));
  assert.ok(csp['img-src'].includes('data:'), 'the uploaded photo is a data URL');
  assert.deepStrictEqual(csp['object-src'], ["'none'"]);
  assert.deepStrictEqual(csp['base-uri'], ["'self'"]);
});

test('HSTS is not sent over plain http', async () => {
  // Sending it from a local http server would pin a developer's browser to
  // https://localhost and break their day.
  const res = await realFetch(`${BASE}/`);
  assert.strictEqual(res.headers.get('strict-transport-security'), null);
});

test('HSTS is sent when the proxy terminated TLS', async () => {
  const res = await realFetch(`${BASE}/`, { headers: { 'x-forwarded-proto': 'https' } });
  assert.match(res.headers.get('strict-transport-security') || '', /max-age=31536000/);
});

/* ── no third parties on the pages themselves ── */

const pages = {
  'index.html': fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8'),
  'legal/privacy.html': fs.readFileSync(path.join(__dirname, '..', 'legal', 'privacy.html'), 'utf8'),
  'legal/terms.html': fs.readFileSync(path.join(__dirname, '..', 'legal', 'terms.html'), 'utf8'),
};

/* Hosts the browser contacts on its own, before the reader does anything.

   Only tags that fetch: <link>, <script>, <img>, <iframe>, <source>. An <a
   href> to the ICO is a link someone chooses to follow, which is the opposite
   of the problem — the notice should point people at the regulator. */
const requestedHosts = (html) => [...new Set(
  [...html.matchAll(/<(link|script|img|iframe|source)\b[^>]*?\b(?:src|href)="https?:\/\/([a-z0-9.-]+)/gi)]
    .map(m => m[2].toLowerCase())
    .filter(h => h !== 'www.w3.org'))];              // the SVG namespace is not a request

test('no page sends a reader to Google for its fonts', () => {
  for (const [name, html] of Object.entries(pages)) {
    const hosts = requestedHosts(html);
    assert.ok(!hosts.some(h => h.includes('fonts.googleapis') || h.includes('gstatic')),
      `${name} still asks Google for fonts: ${hosts.join(', ')}`);
  }
});

test('the legal pages contact nobody at all', () => {
  for (const name of ['legal/privacy.html', 'legal/terms.html']) {
    const hosts = requestedHosts(pages[name]).filter(h => !h.endsWith('facetpro.co.uk'));
    assert.deepStrictEqual(hosts, [],
      `${name} is the page that explains we do not share people's data with third parties`);
  }
});

test('the fonts are actually here, not just referenced', async () => {
  for (const file of ['/assets/fonts.css', '/assets/legal.css',
                      '/assets/fonts/geist-variable.woff2', '/assets/fonts/instrument-serif-400.woff2']) {
    const res = await realFetch(BASE + file);
    assert.strictEqual(res.status, 200, `${file} is referenced but not served`);
    assert.ok(Number(res.headers.get('content-length')) > 0, `${file} is empty`);
  }
});

test('the legal stylesheet covers every class the pages use', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'assets', 'legal.css'), 'utf8');
  const used = new Set();
  for (const name of ['legal/privacy.html', 'legal/terms.html']) {
    for (const m of pages[name].matchAll(/class="([^"]+)"/g)) {
      m[1].split(/\s+/).forEach(c => c && used.add(c));
    }
  }
  // With no Tailwind runtime, an unstyled class is a silently broken layout —
  // there is nothing left to compile it.
  const missing = [...used].filter(c => !css.includes('.' + c.replace(/([.:[\]#\\/])/g, '\\$1')));
  assert.deepStrictEqual(missing, [], `unstyled classes: ${missing.join(' ')}`);
});
