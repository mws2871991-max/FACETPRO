/* The gallery may only claim what PROVENANCE.md can back. Run: npm test
 *
 * "Real homes. Real work. No showroom." over six photographs whose "Real job?"
 * column says UNKNOWN is an objective claim about services in an
 * advertisement, and under the CAP Code it has to be substantiable before it
 * is published — not after somebody asks. The server has warned about it at
 * every startup since the file was written.
 *
 * This couples the two: while the table says UNKNOWN, the page does not get to
 * say whose job it was. Fill the table in and this test tells you the claim is
 * available again.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const prov = fs.readFileSync(path.join(__dirname, '..', 'assets', 'work', 'PROVENANCE.md'), 'utf8');
const unproven = /\|\s*`[\w-]+\.jpg`\s*\|\s*UNKNOWN/.test(prov);

test('the page does not claim whose job it was while the table says UNKNOWN', () => {
  if (!unproven) return;   // filled in: the stronger claim is earned
  for (const claim of [
    /a job this team has done/i,
    /jobs (we|this team) (have|has) done/i,
    /our own (work|jobs)/i,
  ]) {
    assert.ok(!claim.test(page),
      `the gallery claims work it cannot substantiate (${claim}) while PROVENANCE.md still says UNKNOWN`);
  }
});

/* 5 October: the gallery came down. Softening the wording reduced what we
   claimed about those houses; it did nothing about whether their owners had
   said yes, and permission is UNKNOWN on every row. So while any row says
   UNKNOWN, no file in it is shown anywhere — the gallery, the photo tips, or
   anything added later. The files stay in the tree as test fixtures. */
const withoutPermission = ['hero', 'tilehung', 'newbuild'];
const scripts = ['landing.js'].map(f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8'));

test('no house without recorded permission is shown on the site', () => {
  if (!unproven) return;
  for (const name of withoutPermission) {
    const shown = new RegExp(`/assets/work/${name}-(before|after)`);
    assert.doesNotMatch(page, shown, `${name} is on the page while PROVENANCE.md says UNKNOWN`);
    for (const js of scripts) assert.doesNotMatch(js, shown, `${name} is in landing.js while PROVENANCE.md says UNKNOWN`);
  }
});

test('with the gallery gone, nothing still claims it', () => {
  assert.doesNotMatch(page, /id="our-work"/);
  assert.doesNotMatch(page, /href="\/#our-work"/, 'a footer link to a section that is not there');
  assert.doesNotMatch(page, /Photographs, not renders/, 'a claim about pictures the page no longer shows');
  assert.match(prov, /## Taken down — 5 October 2026/, 'the reason is recorded where the question is asked');
});

test('the photo tips use the credited Unsplash photograph, not anyone\'s house', () => {
  assert.match(page, /src: '\/assets\/work\/demo-windows-before-600\.jpg'/);
  assert.match(page, /src: '\/assets\/work\/demo-close-crop-sm\.jpg'/);
  assert.match(page, /'House photo: Unsplash'\)/);
  assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'work', 'demo-close-crop-sm.jpg')));
});
