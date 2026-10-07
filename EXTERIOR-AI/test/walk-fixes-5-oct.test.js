/* Fixes from the 5 October walks and handoff. Run: npm test
 *
 * Each of these was found by a person using the site, not by the suite — a
 * claim nobody can evidence, a message written for a developer, a link too
 * small to hit, a bar that truncated. None of them error, which is why 1,260
 * passing tests never saw one of them.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const landing = fs.readFileSync(path.join(__dirname, '..', 'landing.js'), 'utf8');
/* index.html ships its comments, so a note explaining a removal reads the
   same as the thing removed. */
const code = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
const landingCode = landing.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('no popularity claims anywhere a homeowner reads (handoff §2)', () => {
  /* Mike's rule: no "most popular" or popularity claim unless evidenced. The
     front-door guide said a composite was "what most people are choosing";
     two more said "the most common combined job" and "the most common
     avoidable cost". Nothing stands behind any of them. */
  for (const claim of [/most people are choosing/i, /most popular/i, /most common/i]) {
    assert.doesNotMatch(landingCode, claim, `an unevidenced popularity claim is back: ${claim}`);
  }
});

test('the front-door answer still says what the figure covers', () => {
  /* Dropping the clause must not take the substance with it. */
  assert.match(landing, /fitted for a composite front door, supplied and fitted with the old door taken away, inc VAT/);
});

test('the sales-process claim is about us, not about them (5 Oct)', () => {
  /* It read "The traditional sales process can decide the price as much as
     the product does" — an objective claim about how a whole trade prices,
     which we cannot substantiate, and which puts the reader's nerve on trial.
     What we can say is what our own figure does. */
  assert.doesNotMatch(code, /sales process can decide the price/i);
  // Replaced by the priority fixes v2 (7 Oct), which softened the precision claim.
  assert.match(code, /Two neighbours\. Same street\. Same windows\. Very different quotes\./);
  assert.doesNotMatch(code, /same work, same figure/);
});

test('the wall-area message is written for a homeowner (handoff §8)', () => {
  /* It read: "The walls fill 80.0% of the photo, outside the 24–32% expected
     for a semi-detached — the photo is probably framed too close or too far.,
     so this uses a typical figure instead." A stray ".," and three numbers
     nobody can act on. */
  const f = code.slice(code.indexOf('const framed = note'), code.indexOf('houseTypeMayBeWrong: true'));
  assert.match(f, /quite close up/, 'the plain message has gone');
  assert.match(f, /quite far back/, 'only one direction of framing is explained');
  assert.match(f, /type your own wall area/, 'the way out is no longer offered');
  assert.doesNotMatch(f, /\$\{note\}/, 'the technical note is being shown to a homeowner again');
});

test('and it says which way the photo was framed, from the numbers in the note', () => {
  /* Above the band is too close, below it too far. Pinned because the advice
     is opposite in each case: "from across the road" would be wrong for a
     photograph already taken from too far away. */
  const note = 'The walls fill 80.0% of the photo, outside the 24–32% expected for a semi-detached — the photo is probably framed too close or too far.';
  const framed = note.match(/fill\s+([\d.]+)%[\s\S]*?the\s+(\d+)–(\d+)%\s+expected for a ([^—]+?)\s*—/);
  assert.ok(framed, 'the note measure.js writes no longer parses');
  assert.strictEqual(framed[4].trim(), 'semi-detached');
  assert.ok(Number(framed[1]) > Number(framed[3]), '80% of the frame is too close, not too far');
});

test('the measurement links can be hit with a thumb (handoff §8)', () => {
  /* "try another photo" and "type your own wall area" were 28px. */
  const f = code.slice(code.indexOf('const link = (label, onClick)'), code.indexOf('const link = (label, onClick)') + 300);
  assert.match(f, /min-h-\[44px\]/, 'the links are back under the 44px minimum');
});

test('the bar before an upload fits a 375px phone', () => {
  assert.doesNotMatch(code, /Tell us what you’d like to change and we’ll price it/,
    'the long label truncated to "Tell us what you\'d like to ch…"');
  assert.match(code, /Tell us what to price/);
});
