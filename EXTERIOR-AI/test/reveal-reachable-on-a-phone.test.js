/* The reveal has to be where the reader is. Run: npm test
 *
 * Mike's phone walk, 5 October, 375x812, live build 0b7944fcf4f7:
 *
 *   "The reveal is about 1,700px below where the phone user is left. After the
 *    scan, the page sits on the 'What we found' list (scrollY ~1000) while the
 *    picture and 'Reveal my design →' are at y ~2,690. The toast says 'Your new
 *    look is ready' but nothing on screen shows it."
 *
 *   "The price shows before the picture. The sticky bar changes to
 *    '£14,000 – £22,000' during the scan, before the user has seen any design."
 *
 * Both are silent: nothing errors, nothing looks broken, and the one thing
 * they came for is announced and then hidden while a number they did not ask
 * for arrives first. That is the shape of fault a test suite never finds and a
 * person finds in thirty seconds, which is why these are pinned from a walk
 * rather than from the code.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
/* index.html ships its comments to the browser, so a bare search finds the
   note explaining a thing as readily as the thing. */
const code = h.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

test('a finished render brings the reveal card into view', () => {
  const i = code.indexOf("U('Your new look is ready");
  assert.ok(i > 0, 'the render-ready toast has moved');
  const after = code.slice(i, i + 700);
  assert.match(after, /getElementById\('visualizer-section'\)/, 'nothing goes looking for the card');
  assert.match(after, /scrollIntoView/, 'the card is announced and left off screen');
});

test('it only scrolls when the card is actually off screen', () => {
  /* A reader who has already scrolled down to the picture must not be yanked
     anywhere. Moving somebody who can already see the thing is worse than
     leaving them alone. */
  const i = code.indexOf("U('Your new look is ready");
  const after = code.slice(i, i + 700);
  assert.match(after, /getBoundingClientRect\(\)\.top/, 'it scrolls without checking where the card is');
  assert.match(after, /window\.innerHeight/, 'off-screen is not being judged against the viewport');
  assert.match(after, /state\.revealed/, 'it would fight a reader who has already revealed');
});

test('the price waits for the picture it prices', () => {
  const f = code.slice(code.indexOf('function buildTotalBar()'), code.indexOf('function buildTotalBar()') + 900);
  /* everRevealed, not revealed (corrected 5 Oct on review). "Full makeover"
     clears state.revealed so the reveal runs again, and keying the bar off it
     made a price that was already on screen blink out mid-flow. The hold is on
     the FIRST design being seen, once a visit. */
  assert.match(f, /!state\.everRevealed/, 'the bar shows a figure before any design is seen');
  assert.match(f, /state\.rendering \|\| state\.renderUrl/,
    'the hold must apply while a picture is coming, not only once it has arrived');
});

test('a design with no picture still carries its price', () => {
  /* Colours only, or a photograph that could not be read: there is no reveal
     coming, so withholding the figure would leave them with nothing. The hold
     is on the gap between a number and its picture, not on the number. */
  const f = code.slice(code.indexOf('function buildTotalBar()'), code.indexOf('function buildTotalBar()') + 900);
  assert.match(f, /state\.uploadedImg &&/,
    'with no photograph at all the bar must behave exactly as before');
});
