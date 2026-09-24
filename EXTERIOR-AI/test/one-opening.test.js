/* One opening, not two: the product choice on /design is the homepage's six
   boxes, and before a photo the price is said once. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const homeBoxes = (() => {
  const sec = html.slice(html.indexOf('aria-labelledby="choose-heading"'));
  const body = sec.slice(0, sec.indexOf('</section>'));
  return [...body.matchAll(/<a href="([^"]+)"[\s\S]*?<img src="([^"]+)"[\s\S]*?text-\[15px\] font-medium">([^<]+)</g)]
    .map(([, href, img, label]) => ({ href, img, label: label.replace(/&amp;/g, '&') }));
})();

const tiles = (() => {
  const src = html.slice(html.indexOf('const PRODUCT_TILES = ['), html.indexOf('];', html.indexOf('const PRODUCT_TILES = [')));
  return [...src.matchAll(/\{ id: '([^']+)',\s*label: '([^']+)'[^}]*img: '([^']+)'[^}]*?(?:href: '([^']+)')?\s*\}/g)]
    .map(([, id, label, img, href]) => ({ href: href || `/design?journey=${id}`, img, label }));
})();

test('the /design product choice is the homepage boxes: same names, pictures, order and places', () => {
  assert.strictEqual(homeBoxes.length, 6);
  assert.deepStrictEqual(tiles, homeBoxes);
});

test('the old text chips are gone', () => {
  assert.ok(!html.includes('The white boards and gutters'));
  assert.ok(!html.includes("'What are you looking for today?'"));
  assert.ok(!/const TRIAGE = \[/.test(html));
});

test('a product picked on /design goes to "Choose the look"; "not sure" goes to the photo', () => {
  const fn = html.slice(html.indexOf('function buildTriage'), html.indexOf('function buildUploadDetect'));
  assert.match(fn, /getElementById\(id \? 'mount-choose' : 'your-photo'\)/);
  assert.match(fn, /Not sure yet\? Price everything from your photo/);
  assert.match(fn, /if \(state\.resumedDesign\) return/, 'a restored design is asked again');
});

test('before a photo the price is shown once, in "Choose the look"', () => {
  const bar = html.slice(html.indexOf('function buildTotalBar'), html.indexOf('function buildTotalBar') + 900);
  assert.match(bar, /if \(chooserShowing\(\)\) return h\('div', \{ id: 'total-bar' \}\)/);
});

test('"Choose the look" is redrawn when the window price arrives', () => {
  const fn = html.slice(html.indexOf('function renderGlazingConsumers'), html.indexOf('function renderGlazingConsumers') + 700);
  assert.match(fn, /if \(choose && chooserShowing\(\)\) choose\.replaceWith\(buildChooser\(\)\)/);
});

test('"not sure yet" closes the question', () => {
  const fn = html.slice(html.indexOf('function buildTriage'), html.indexOf('function buildUploadDetect'));
  assert.match(fn, /if \(state\.triageAnswered && !state\.journey && !state\.triageOpen\) return/);
});
