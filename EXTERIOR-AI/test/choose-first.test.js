/* Choose the look, see a price, then the photo (24 September).

   The homepage opens with six product boxes; each lands on /design with a
   journey, where the visitor picks the style/colour or finish and sees a
   typical price before being asked for a photograph. These pin the wiring —
   the behaviour was walked in a browser (see the commit). */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const fnBody = (name) => {
  const at = html.indexOf(`function ${name}(`);
  assert.ok(at > 0, `${name} has gone`);
  return html.slice(at, html.indexOf('\nfunction ', at + 10));
};

test('the homepage opens with six product boxes, each to a journey', () => {
  const at = html.indexOf('id="choose-heading"');
  const section = html.slice(html.lastIndexOf('<section', at), html.indexOf('</section>', at));
  const hrefs = [...section.matchAll(/<a href="([^"]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(hrefs.filter(h => h !== '/how-we-price'), [
    '/design?journey=windows', '/design?journey=doors', '/design?journey=roofline',
    '/design?journey=roof', '/design?journey=cladding', '/cost/conservatory-cost-uk',
  ]);
  for (const img of ['windows', 'doors', 'roofline', 'roofs', 'walls', 'conservatory']) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'products', `${img}.jpg`)), `${img}.jpg is missing`);
  }
});

test('the chooser shows only for a journey, before any photo', () => {
  const body = fnBody('buildChooser');
  assert.match(body, /if \(!j \|\| !JOURNEYS\[j\] \|\| state\.uploadedImg \|\| state\.resumedDesign \|\| state\.stage !== 'landing'\) return empty;/);
  assert.match(html, /\['mount-choose',\s+buildChooser\]/);
  assert.ok(html.indexOf('id="mount-choose"') < html.indexOf('id="mount-upload"'), 'the choice must come before the upload');
});

test('choices set the same state the rest of the page prices and renders', () => {
  assert.match(fnBody('chooserPref'), /state\.prefs\[key\] = id;[\s\S]*refreshGlazing/);
  assert.match(fnBody('chooserSwatch'), /state\[key\] = sw;[\s\S]*refreshPrice/);
  // A new choice invalidates any picture of an old one.
  assert.match(fnBody('chooserPref'), /state\.renderUrl = null/);
});

test('the price says it is typical, and the button goes to the photo', () => {
  const body = fnBody('buildChooser');
  assert.match(body, /Your house will be priced from your photo\./);
  assert.match(body, /getElementById\('your-photo'\)\?\.scrollIntoView/);
});
