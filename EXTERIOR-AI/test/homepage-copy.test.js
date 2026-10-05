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
  ['the h1', '>See your house. See the price.</h1>'],
  ['the sub-head', 'Upload one photo of your home. See new windows and a new front door on your actual house &mdash; with a planning estimate.'],
  ['the four steps', '>Your price &mdash; then you decide</span>'],
  ['the primary button', '>Upload my house &rarr;</button>'],
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
