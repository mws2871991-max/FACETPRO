/* A trade somebody declined is not a control, it is scenery.

   Measured on the live site, windows journey, 375px: 14,265px of page, about
   6,100 of it belonging to trades the visitor had just said no to — the
   conservatory guide, the walls-only calculator, the roofline profiles and
   three swatch rows. Answering "what are you looking for?" scoped the estimate
   correctly and barely touched the page, which is the finding that started
   this and the one the split alone did not fix.

   These assert the rules rather than the pixels, because pixels are the
   designer's to move:

     - a declined trade folds behind one line
     - the trade they came for never folds
     - choosing anything inside a fold takes it out of the fold
     - "everything / not sure yet" declines nothing, so nothing folds

   The fourth is the one that would cost the most if it broke: a visitor who
   has not said what they want must not have half the product hidden from
   them. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* The visualiser's own rule, read out of the source. Keeping the test on the
   predicate rather than on a rendered page is deliberate: this file has no
   DOM, and the predicate is where the decision actually lives. */
function isDeclinedRule() {
  const m = page.match(/const isDeclined = \(group\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(m, 'isDeclined has moved or been renamed — the folding rule is gone');
  const OWN_GROUP = { cladding: 'Cladding', roofline: 'Trim', roof: 'Roof' };
  return (journey, group, swatchId) => {
    if (!journey) return false;
    if (OWN_GROUP[journey] === group) return false;
    return !swatchId || swatchId === 'none';
  };
}

test('the trade they came for is never folded away', () => {
  const declined = isDeclinedRule();
  assert.strictEqual(declined('cladding', 'Cladding', 'none'), false);
  assert.strictEqual(declined('roof', 'Roof', 'none'), false);
  assert.strictEqual(declined('roofline', 'Trim', 'none'), false);
});

test('a trade they declined folds', () => {
  const declined = isDeclinedRule();
  assert.strictEqual(declined('windows', 'Cladding', 'none'), true);
  assert.strictEqual(declined('windows', 'Roof', 'none'), true);
  assert.strictEqual(declined('roof', 'Cladding', 'none'), true);
});

test('choosing something inside a fold takes it out of the fold', () => {
  /* Plenty of people add the walls once they have seen the windows. Having
     done so, they should not have to reopen the same line every render. */
  const declined = isDeclinedRule();
  assert.strictEqual(declined('windows', 'Cladding', 'clay-stone'), false);
  assert.strictEqual(declined('roof', 'Trim', 'ink-trim'), false);
});

test('"everything / not sure yet" declines nothing', () => {
  const declined = isDeclinedRule();
  for (const group of ['Cladding', 'Trim', 'Roof']) {
    assert.strictEqual(declined(null, group, 'none'), false,
      'a visitor who has not chosen a trade must not have the product hidden from them');
  }
});

test('the two big sections fold on the same terms', () => {
  /* Windows and doors is 3,941px and the roofline profiles 1,427px — the two
     largest blocks that can belong to somebody else. They go through the same
     fold() helper, with their own "engaged" test, so a visitor who has picked
     a window style or a fascia profile keeps it open. */
  assert.match(page, /const fold = \(el, summary, isOwn, engaged\) => \{/,
    'the fold helper has gone');
  assert.match(page, /if \(!state\.journey \|\| isOwn \|\| engaged\) return el;/,
    'fold no longer exempts the chosen trade, an engaged section, or the undecided visitor');
  assert.match(page, /'Also thinking about windows or a front door\?', glazingJourney, glazingEngaged/);
  assert.match(page, /'Also thinking about fascias, soffits and guttering\?', state\.journey === 'roofline', rooflineEngaged/);

  /* Engagement is any real choice in that section — 'none' is a decision to
     decline, not a reason to keep the controls open. */
  assert.match(page, /glazingEngaged = \['windowStyleId', 'doorStyleId', 'windowDoorColourId'\][\s\S]{0,120}!== 'none'/);
});

test('the summary names the trades it is hiding', () => {
  /* "Also thinking about the walls or a roof?" — a line that names them is a
     line somebody can decide about without opening it. */
  assert.match(page, /Also thinking about \$\{declined\.map\(g => declinedWords\[g\]\)/);
  assert.match(page, /declinedWords = \{ Cladding: 'the walls', Trim: 'the roofline', Roof: 'a roof' \}/);
});
