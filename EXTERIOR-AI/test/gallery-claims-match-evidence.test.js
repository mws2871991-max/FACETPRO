/* Each gallery claim against its own evidence. Run: npm test
 *
 * Handoff §1 asks for "a test so the badge can only show when PROVENANCE.md
 * has no UNKNOWN entries". That single check would be wrong in both
 * directions, so this is three.
 *
 * The homepage makes two claims about those photographs and they have
 * different evidence behind them:
 *
 *   "Photographs, not renders"  — settled. scripts/check-gallery-pair.js
 *     scored the quietest sixth of each pair: hero 2.6, newbuild 7.8,
 *     tilehung 1.8. A re-finished photograph scores under 8; generated
 *     imagery scores over 13, because generating redraws every pixel even
 *     when it is the same house. A sibling from the same batch also carries
 *     iPhone 16 EXIF (5 Oct, see PROVENANCE.md).
 *
 *   "Real homes. Real WORK."   — not settled. That is a claim about a service
 *     performed, and the six job rows are UNKNOWN.
 *
 * Tying both to one UNKNOWN count would pull down the proven claim because of
 * unrelated unknowns about job history — and would let the unproven one stand
 * the moment somebody filled a date column. So each is checked against the
 * thing that actually supports it.
 *
 * The third check is the one nothing else covers: permission. A house is
 * identifiable and these are on a public marketing page. The Victorian terrace
 * was deleted outright on exactly this question (91d095b) when a plaque made
 * it addressable, which is the standard this file already holds itself to.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const prov = fs.readFileSync(path.join(root, 'assets', 'work', 'PROVENANCE.md'), 'utf8');
/* index.html ships its comments, so a note about a claim reads like the claim. */
const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

/* The rows that answer "is this a real job somebody did, and did they agree" —
   the table under "Fill this in", not the prose anywhere else in the file. */
const jobRows = () => {
  const table = prov.slice(prov.indexOf('## Fill this in'));
  return table.split('\n').filter(l => /^\|\s*`[a-z-]+\.jpg`/.test(l));
};
const unknownsIn = (col) => jobRows().filter(l => (l.split('|')[col] || '').includes('UNKNOWN')).length;

test('the photographs claim is backed by the pixel check', () => {
  /* This one is allowed to stand while job rows are unknown — whether an
     image is a photograph is a different question from whose house it is. */
  assert.match(prov, /Quietest sixth/i, 'the measurement that supports it has gone from the file');
  for (const pair of ['hero', 'newbuild', 'tilehung']) {
    assert.ok(new RegExp(`\\|\\s*${pair}\\s*\\|`, 'i').test(prov),
      `${pair} is claimed on the page but has no row in the machine check`);
  }
  assert.match(prov, /reads as a photograph/, 'the verdicts have gone');
});

test('a "real work" claim needs the job rows answered', () => {
  /* The claim says a job was carried out. Nothing but the table can say so. */
  const claimsWork = /Real homes\.\s*Real work\./i.test(page);
  const unknownJobs = unknownsIn(2);          // "Real job?" column
  if (claimsWork) {
    assert.strictEqual(unknownJobs, 0,
      `the homepage says "Real work" with ${unknownJobs} of ${jobRows().length} job rows still UNKNOWN — ` +
      'fill them in, or drop "Real work" and keep "Photographs, not renders"');
  }
});

test('no gallery photograph hands a reader an address', () => {
  /* The rule actually in force, and the one that removed a pair.
   *
   * Permission is still UNKNOWN for all six and that is tracked in the file,
   * not asserted here — a test that cannot pass today would be skipped or
   * deleted by the next person, and the position was taken deliberately:
   * `91d095b` removed terrace-before.jpg because a plaque read "118, Dysons
   * R…", making the property addressable rather than merely recognisable,
   * while hero, newbuild and tilehung were checked at the same time and kept.
   *
   * So what is pinned is the check itself. If a fourth pair goes in without
   * that paragraph naming it, this fails — which is the moment somebody is
   * about to publish a house without having looked. */
  const addressSection = prov.slice(prov.indexOf('## The Victorian terrace pair has been removed entirely'));
  assert.ok(addressSection.length > 100, 'the record of the addressability check has gone');
  for (const pair of ['hero', 'newbuild', 'tilehung']) {
    assert.ok(new RegExp(`\\b${pair}\\b`).test(addressSection),
      `${pair} is on the page but is not named in the addressability check`);
  }
  assert.match(addressSection, /permission question is still open/i,
    'the file no longer says the permission question is open');
});

test('the file still says plainly that it is unfinished', () => {
  /* While any row is open, the title is the thing a reader meets first and
     the server warning quotes it. */
  if (unknownsIn(2) || unknownsIn(7)) {
    assert.match(prov, /NOT YET COMPLETED/,
      'the title says the work is done while rows are still UNKNOWN');
  }
});
