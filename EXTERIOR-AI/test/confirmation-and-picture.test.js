/* Two things the customer-journey walk found, on the two screens that matter
   most: the one where the product asks to be checked, and the one where it
   shows what it made.

   The house type is now named in the confirmation question by 54ddcab, which
   phrases it by who decided — "it looks like a detached house" when we guessed,
   "you told us it's" once they have. This file keeps the check that the helper
   behind that sentence still produces an article and a noun.

   THE PICTURE. On a 375px screen the render was 275px wide: 96px lost to the
   page gutter and the section padding it sits inside, which is a quarter of
   the display spent on margins around the one image the product exists to
   show. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the house type is named with its article, not its key', () => {
  /* "detached" and "endTerrace" are internal ids. HOUSE_TYPE_ARTICLE turns
     them into "a detached" and "an end of terrace", which is the difference
     between a sentence and a database row. */
  const m = page.match(/const HOUSE_TYPE_ARTICLE = \(id\) => \{[\s\S]*?\n\};/);
  assert.ok(m, 'HOUSE_TYPE_ARTICLE has gone — the prompt would print a raw key');
  assert.match(m[0], /\/\^\[aeiou\]\//, 'the article is no longer chosen by the first letter');
  assert.match(m[0], /this kind of house/, 'an unknown type must still produce a sentence');
});

test('the picture is edge to edge on a phone and boxed from sm up', () => {
  /* The media card sits inside a section with its own padding, inside a page
     gutter. Below sm it steps back out of both; from sm up the width was never
     what constrained it. */
  const media = page.match(/'-mx-6 sm:mx-0[^']*'/);
  assert.ok(media, 'the render card no longer breaks out of its padding on a phone');
  assert.match(media[0], /rounded-none sm:rounded-2xl/, 'a full-bleed card should not keep its corners');
  assert.match(media[0], /border-y sm:border/, 'a full-bleed card should not keep its side borders');
});

test('the picture still adopts the shape of the photograph', () => {
  /* The reason the crop bug is fixed: the container takes the render's own
     aspect ratio, so a portrait photograph is not cover-cropped into a
     landscape box and the before and after panes share one shape. Easy to lose
     while moving classes around on the same element. */
  assert.match(page, /style: state\.renderAspect \? \{ aspectRatio: state\.renderAspect \} : \{\}/,
    'the container no longer adopts the render aspect — portrait photos will be cropped again');
});
