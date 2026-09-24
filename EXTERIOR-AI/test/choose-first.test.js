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
  // The rule lives in chooserShowing(), which the price bar reads too.
  assert.match(fnBody('buildChooser'), /if \(!chooserShowing\(\)\) return empty;/);
  assert.match(fnBody('chooserShowing'), /j && JOURNEYS\[j\] && !state\.uploadedImg && !state\.resumedDesign && state\.stage === 'landing'/);
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

test('the homepage has exactly one h1, and it is the homepage’s own', () => {
  /* One document serves /, /design, /installers and /how-we-price, so every
     heading in it reaches the homepage's served HTML whether a visitor can see
     it or not. When /installers and /how-we-price each gained an h1 (PRs #22
     and #25), the homepage silently went from one h1 to three — and because
     the installers section comes first in the document, the first h1 a crawler
     read on the one indexed page on this site was a line recruiting
     installers.

     Invisible to a customer, which is why a live walk did not catch it. This
     is the assertion that does.

     The other two headings keep their ids, because aria-labelledby points at
     them, and both their routes are served noindex — so being h2 costs them
     nothing they were getting. */
  const heads = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.strictEqual(heads.length, 1,
    `index.html has ${heads.length} h1s: ${heads.map(m => m[1].replace(/\s+/g, ' ').trim().slice(0, 40)).join(' | ')}`);
  assert.match(heads[0][0], /id="choose-heading"/,
    'the single h1 should be the homepage’s "What would you like to change?"');

  /* And the two demoted ones are still there, still labelling their sections. */
  for (const id of ['installers-heading', 'pricing-heading']) {
    assert.match(html, new RegExp(`<h2[^>]*id="${id}"`), `${id} should still exist as an h2`);
    assert.match(html, new RegExp(`aria-labelledby="${id}"`), `${id} is no longer labelling its section`);
  }
});
