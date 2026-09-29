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

test('"photographs, not renders" is the claim the checker supports', () => {
  /* Kept deliberately. check-gallery-pair.js scored the quietest sixth of all
     three pairs at 2.6, 7.8 and 1.8 on 29 September — a photograph re-finished
     scores under 8, generated imagery over 13, because generating redraws
     every pixel. That claim is evidenced; the one about whose job it was is
     not, and the difference is the point. */
  assert.match(page, /Photographs, not renders/, 'the evidenced claim was removed along with the unevidenced one');
  assert.match(prov, /quietest sixth/i, 'the evidence for it is no longer recorded');
  assert.match(prov, /\*\*2\.6\*\*|2\.6/, 'the measured scores have gone from the file');
});

test('the caption says only what the table can back', () => {
  assert.match(page, /Every picture here is a photograph of a real house, before and after/,
    'the gallery caption has changed — check it against PROVENANCE.md before shipping it');
});
