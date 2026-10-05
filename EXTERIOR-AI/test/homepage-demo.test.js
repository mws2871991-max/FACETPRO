'use strict';
require('./helpers/data-dir');
/* 0086 (5 Oct, Michael Stephenson's launch review): the homepage shows the
   product right under the promise: your house, the new look, the estimated
   cost, see yours. It replaced an illustration (house 22) that had a driveway
   the tool does not do. These are the rules that pair has to keep:
   - real Facet Pro output, and the after is labelled an AI visualisation;
   - the price carries "Planning estimate · inc. VAT · not a quotation" in the
     same frame (ASA);
   - the photo is credited;
   - the problem, the solution and the installer example sit in the order the
     review set. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const demo = (() => { const a = html.indexOf('<figure id="demo"'); return html.slice(a, html.indexOf('</figure>', a)); })();

test('the demo is real output, labelled, and its pictures exist', () => {
  assert.ok(demo.length > 0, 'the demo has gone');
  const imgs = [...demo.matchAll(/<img [^>]*>/g)].map(m => m[0]);
  assert.strictEqual(imgs.length, 2);
  for (const img of imgs) {
    const src = img.match(/src="([^"]+)"/)[1];
    assert.ok(fs.existsSync(path.join(root, src)), `${src} is missing`);
  }
  assert.match(imgs[1], /alt="AI visualisation:/);
  assert.match(demo, /Real Facet Pro output\. The picture on the right is an AI visualisation\. House photo: Unsplash\./);
});

test('every price on the homepage demo and installer example has the full line beside it', () => {
  const example = html.slice(html.indexOf('id="for-installers"'), html.indexOf('id="trust"'));
  for (const block of [demo, example]) {
    assert.match(block, /&pound;7,076 &ndash; &pound;12,866/);
    assert.match(block, /Planning estimate &middot; inc\. VAT &middot; not a quotation/);
  }
});

/* The proof section ("Real homes") came down 5 October; see gallery-claims. */
test('the homepage runs hero, demo, problem, solution, price, installers, trust, close', () => {
  const order = ['id="choose-heading"', '<figure id="demo"', 'id="problem"', 'id="how-it-works"',
    'id="price-basis"', 'id="for-installers"', 'id="trust"', 'id="close-heading"'].map(k => html.indexOf(k));
  for (const at of order) assert.ok(at > 0);
  assert.deepStrictEqual([...order].sort((a, b) => a - b), order);
  assert.strictEqual(html.split('id="how-it-works"').length, 2, 'one How it works');
});
