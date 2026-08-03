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
