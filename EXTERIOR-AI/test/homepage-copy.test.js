'use strict';
require('./helpers/data-dir');
/* The homepage lines that were chosen word by word (1 October). Changing one
   should be a decision someone makes on purpose, not a side effect: if this
   fails, update the line here in the same commit as the page. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const LINES = [
  ['the h1', '>See your house.<br>See what it could cost.</h1>'],
  /* Developer brief, 6 Oct: the sub-head, the trust line and four steps. */
  ['the sub-head', 'Upload one photo of your home to visualise improvements and get a planning estimate &mdash; before speaking to an installer.'],
  ['the trust line', '>Free &middot; No account &middot; No measurements &middot; No sales call</p>'],
  ['the four steps', '>Choose whether you&rsquo;d like up to three installers to quote.</p>'],
  ['never twenty companies', '<strong class="font-semibold text-zinc-900">Never sent to 20 companies.</strong> At most three installers, and only if you ask.'],
  ['the primary button', '>See my house &amp; price &rarr;</button>'],
  ['the two neighbours, near the top', 'Two neighbours. Same street.<br>Same windows. Thousands apart.'],
  ['the simple answer first', 'It&rsquo;s a planning estimate, not a survey.'],
  ['the promise in the closing band', 'No measuring. No sales call. No pressure.'],
  ['the photo line at the button', 'We use it only to make your picture.'],
];

for (const [name, words] of LINES) {
  test(`homepage: ${name} is unchanged`, () => {
    assert.ok(html.includes(words), `${name} changed — if on purpose, update test/homepage-copy.test.js`);
  });
}

test('homepage: no "No survey" anywhere — the installer does survey', () => {
  assert.doesNotMatch(html.replace(/<!--[\s\S]*?-->/g, ''), /No survey/i);
});

test('homepage FAQ: the fears come first', () => {
  const faq = html.slice(html.indexOf('id="faq"'));
  const qs = [...faq.matchAll(/<h3 class="text-lg font-medium">(.*?)<\/h3>/g)].map(m => m[1]).slice(0, 4);
  assert.deepStrictEqual(qs, ['Will someone call me?', 'How much do new windows cost in the UK?',
    'What happens to my photo?', 'Does Facet Pro do the work?']);
});
