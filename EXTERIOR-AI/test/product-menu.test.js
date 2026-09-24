/* The product row in the site header: the six products, on every page, as
   real addresses.

   A category menu stood here once and was removed because four of its five
   links were #anchors that did nothing before a photo was uploaded. This
   pins the replacement to working links, the same six as the homepage boxes. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const header = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
const menu = header.slice(header.indexOf('id="product-menu"'));

test('the header lists the six products, outside any data-page section', () => {
  const links = [...menu.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.deepStrictEqual(links, [
    '/design?journey=windows', '/design?journey=doors', '/design?journey=roofline',
    '/design?journey=roof', '/design?journey=cladding', '/cost/conservatory-cost-uk',
  ]);
  assert.ok(!/data-page=/.test(header), 'the header must show on every page');
});

test('the menu and the homepage boxes go to the same places', () => {
  const choose = html.slice(html.indexOf('aria-labelledby="choose-heading"'));
  const boxes = choose.slice(0, choose.indexOf('</section>'));
  for (const [, href] of menu.matchAll(/href="([^"]+)"/g)) {
    assert.ok(boxes.includes(`href="${href}"`), `no homepage box goes to ${href}`);
  }
});

test('no header link is an in-page anchor', () => {
  assert.ok(!/href="#/.test(header), 'a #link in the header goes nowhere on other pages');
});

test('the current product is marked from the journey, on /design only', () => {
  const fn = html.slice(html.indexOf('function markCurrentProduct'), html.indexOf('function journeyExcludes'));
  assert.match(fn, /location\.pathname === '\/design' \? state\.journey : null/);
  assert.match(fn, /aria-current/);
  const applyJourney = html.slice(html.indexOf('async function applyJourney'));
  assert.ok(applyJourney.slice(0, 300).includes('markCurrentProduct()'),
    'answering the triage question should move the marker');
});
