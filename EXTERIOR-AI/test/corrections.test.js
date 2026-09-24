/* The customer corrects us, and the price stays about their house.

   The P0 journey: upload → we find the house → you correct it → you change
   the design → the price moves. Walked live on 24 September, the correction
   step broke in three ways; these pin each one. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const withoutComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('changing the house type measures the photograph again', () => {
  /* It cleared the measurement and never re-ran it: tapping Semi on a
     detached reading turned photo_door 90 m² into the typical 85. */
  const at = html.indexOf('state.houseTypeChosen = true;\n        state.measurement = null;');
  assert.ok(at > 0, 'the house-type picker handler has moved — find it and re-point this test');
  const handler = withoutComments(html.slice(at, at + 2500));
  const measure = handler.indexOf('await autoMeasure()');
  const price = handler.indexOf('refreshPrice()');
  assert.ok(measure > 0, 'the picker no longer re-measures the photograph');
  assert.ok(measure < price, 're-measure must finish before the price is refreshed, or the price is the typical one');
});

test('"Something looks wrong" goes to the window counter, not the top of the section', () => {
  assert.match(html, /id: 'window-count'/, 'the counter row lost its id');
  const at = html.indexOf("btn('Something looks wrong'");
  const handler = html.slice(at, at + 1200);
  assert.match(handler, /getElementById\('window-count'\)/);
});

test('a count the customer entered is not called ours', () => {
  const at = html.indexOf("g.countSource === 'house_type_prior'");
  const block = withoutComments(html.slice(at, at + 800));
  assert.match(block, /g\.countSource === 'manual_entry'\s*\?\s*`You told us \$\{counted\}/);
});
