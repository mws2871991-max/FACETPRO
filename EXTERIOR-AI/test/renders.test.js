/* Renders are stored by us, not linked from Replicate.

   Replicate's delivery URLs are public and expire within the hour, which meant
   three things at once: a photorealistic image of an identified person's home
   at an unauthenticated URL, a design-pack email that broke for anyone opening
   it later, and a privacy notice claiming we keep the generated image when we
   kept a string that was already dead. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const store = require('../store');
const emails = require('../emails');

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);

test('a render round-trips through storage', async () => {
  const id = 'test' + Date.now().toString(16);
  await store.putRender(id, bytes, { mime: 'image/png' });
  const back = await store.getRender(id);
  assert.ok(back, 'should come back');
  assert.strictEqual(back.mime, 'image/png');
  assert.ok(Buffer.from(back.bytes).equals(bytes), 'bytes must be identical');
  await store.deleteRenders([id]);
  assert.strictEqual(await store.getRender(id), null, 'and delete really deletes');
});

test('an unvetted id never reaches the filesystem', async () => {
  // The id goes into a path, so it is validated before anything is opened.
  for (const bad of ['../../etc/passwd', 'a/../../x', '', 'x', null, 'a'.repeat(200), 'has space']) {
    assert.strictEqual(await store.getRender(bad), null, `"${bad}" must be refused`);
  }
});

test('deleting nothing is a no-op, not an error', async () => {
  assert.strictEqual(await store.deleteRenders([]), 0);
});

test('the design pack makes our relative render path absolute', () => {
  const lead = { id: 'LD-1', name: 'Jane', renderUrl: '/r/abc123' };
  const price = { cladding: 1, roof: 1, trim: 1, scaffolding: 1, waste: 1, vat: 1, total: 6, footprintM2: 95,
    selections: { cladding: 'A', trim: 'B', roof: 'C' } };
  const html = emails.designPackHtml(lead, price, 'https://www.facetpro.co.uk');
  assert.ok(html.includes('https://www.facetpro.co.uk/r/abc123'),
    'a relative path would break in an email client');
  assert.ok(!html.includes('src="/r/abc123"'), 'must not stay relative');
});

test('a provider URL is still rendered if that is all we have', () => {
  // keepRender falls back to the provider URL rather than losing the render;
  // the email should still show it in that session.
  const lead = { id: 'LD-2', name: 'Jane', renderUrl: 'https://replicate.delivery/xyz/out.jpg' };
  const price = { cladding: 1, roof: 1, trim: 1, scaffolding: 1, waste: 1, vat: 1, total: 6, footprintM2: 95,
    selections: { cladding: 'A', trim: 'B', roof: 'C' } };
  const html = emails.designPackHtml(lead, price, 'https://www.facetpro.co.uk');
  assert.ok(html.includes('https://replicate.delivery/xyz/out.jpg'));
});

test('a hostile render path is still refused', () => {
  const price = { cladding: 1, roof: 1, trim: 1, scaffolding: 1, waste: 1, vat: 1, total: 6, footprintM2: 95,
    selections: { cladding: 'A', trim: 'B', roof: 'C' } };
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>']) {
    const html = emails.designPackHtml({ id: 'x', name: 'J', renderUrl: bad }, price, 'https://www.facetpro.co.uk');
    assert.ok(!html.includes('javascript:') && !html.includes('data:text/html'), bad);
  }
});

test('deleting counts renders, not the files behind them', async () => {
  /* Each render is a .bin and a .json, and this counted both — so the
     retention record, which is the evidence for "we delete on schedule",
     reported twice what was removed. It also made the two backends disagree:
     Postgres returns rows deleted. */
  const ids = ['count1' + Date.now().toString(16), 'count2' + Date.now().toString(16)];
  for (const id of ids) await store.putRender(id, bytes, { mime: 'image/png' });
  assert.strictEqual(await store.deleteRenders(ids), ids.length);
  assert.strictEqual(await store.deleteRenders(ids), 0, 'gone means gone');
});

/* ── the same guarantee, on the DOM path ──

   The test above proves a hostile renderUrl is refused in an email template,
   because emails.js has had safeUrl() from the beginning. index.html assigned
   the same value straight into an <img src> with nothing in between:

     state.renderUrl = data.url;

   So the suite and the code disagreed about whether the value could be
   trusted, and the suite was right. This closes the asymmetry rather than
   documenting it.

   The function is read out of index.html and run, rather than checked for by
   pattern — a regex that proves a validator is *mentioned* proves nothing
   about what it accepts. */

const { readFileSync } = require('fs');
const { join } = require('path');

function loadSafeRenderUrl() {
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  /* The two pieces separately, rather than one pattern spanning both.
     Requiring the function to sit on the line immediately after the constant
     meant that explaining the function in a comment above it broke the test —
     which punishes exactly the thing this codebase asks for everywhere else. */
  const constant = html.match(/const RENDER_ID = [^\n]+/);
  const fn = html.match(/function safeRenderUrl\(u\) \{[\s\S]*?\n\}/);
  assert.ok(constant, 'RENDER_ID has been renamed or removed from index.html');
  assert.ok(fn, 'safeRenderUrl has been renamed or removed from index.html');
  return new Function(constant[0].replace('const RENDER_ID', 'var RENDER_ID') + '\n' + fn[0] + '; return safeRenderUrl;')();
}

test('the render URL the browser is given is validated before it reaches the DOM', () => {
  const safe = loadSafeRenderUrl();

  /* The one shape /api/render can return. A reviewer once proposed testing
     for https only, which would have refused this — the normal case — and
     broken every render that stored correctly. */
  assert.strictEqual(safe('/r/abc123def456'), '/r/abc123def456', 'a stored render was refused');

  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    '//evil.example/x.jpg',          // protocol-relative: inherits the page's scheme
    'http://insecure.example/x.jpg', // a render of somebody's home over plain http
    '/r/short',                      // too little entropy to be one of ours
    '/etc/passwd',
    /* The provider's own host, which this used to wave through. The fallback
       that produced such a URL is gone: an image we cannot copy is an error,
       because handing one over leaves a photorealistic picture of an
       identified home at an address we cannot delete. */
    'https://replicate.delivery/x.jpg',
    /* And the reason it mattered that the branch said "any https". It was
       written for one host and admitted every one — including into an
       <a href target="_blank">, which img-src does not govern. */
    'https://evil.example/x.jpg',
    null, undefined, '', 42, {},
  ]) {
    assert.strictEqual(safe(bad), null, `accepted a hostile render URL: ${String(bad)}`);
  }
});

test('nothing assigns an unvalidated render URL', () => {
  /* The validator only helps where it is called. This fails if somebody adds
     a second assignment later and forgets. */
  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const assignments = [...html.matchAll(/state\.renderUrl\s*=\s*([^;\n]+)/g)].map(m => m[1].trim());
  for (const a of assignments) {
    assert.ok(/^null$/.test(a) || /safeRenderUrl\(/.test(a),
      `state.renderUrl is assigned without validation: ${a.slice(0, 60)}`);
  }
});
