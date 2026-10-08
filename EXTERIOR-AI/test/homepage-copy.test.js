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
  ['the photo line at the button', 'Your original photo is deleted immediately after processing.'],
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

/* Developer brief, 6 Oct (§11–12): cost guides on the homepage, before the
   FAQ, linking only to guides that exist, and carrying no prices of their own. */
test('homepage: the cost guides block links real guides and copies no prices', () => {
  const a = html.indexOf('id="cost-guides"');
  assert.ok(a > 0 && a < html.indexOf('id="faq"'), 'before the FAQ');
  const sec = html.slice(a, html.indexOf('</section>', a));
  const slugs = [...sec.matchAll(/href="\/cost\/([a-z0-9-]+)"/g)].map(m => m[1]);
  assert.ok(slugs.length >= 9);
  const landing = fs.readFileSync(path.join(__dirname, '..', 'landing.js'), 'utf8');
  for (const sl of slugs) assert.ok(landing.includes(`'${sl}'`) || landing.includes(`"${sl}"`) || landing.includes(sl), `${sl} is not a guide`);
  assert.doesNotMatch(sec.replace(/<!--[\s\S]*?-->/g, ''), /£|&pound;/, 'a price copied onto the homepage goes stale');
});

/* Developer brief, 6 Oct (§12): about / credibility on the homepage, in the
   words already used elsewhere, third person and unnamed. */
test('homepage: the about block says who is behind it without naming anyone', () => {
  const a = html.indexOf('id="about"');
  assert.ok(a > html.indexOf('id="cost-guides"') && a < html.indexOf('id="faq"'), 'after the cost guides, before the FAQ');
  const sec = html.slice(a, html.indexOf('</section>', a)).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(sec, /Built by somebody who sold these jobs for twenty-four years\./);
  assert.match(sec, /FACETPRO LTD, registered in England and Wales, no\. 17346500\./);
  assert.doesNotMatch(sec, /Mike|Sheehan|\bI (sold|spent)\b/, 'the founder is not named on the page');
});

test('homepage: the founder is described, not named (8 Oct)', () => {
  const home = fs.readFileSync(path.join(__dirname, '..', 'home.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.doesNotMatch(home, /Sheehan|Stephenson/);
  assert.match(home, /Built by someone who spent 24 years/);
});
