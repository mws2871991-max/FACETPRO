'use strict';

require('./helpers/data-dir');

/* The privacy answer at the moment of upload (29 September).

   A photograph of somebody's home is the one thing on this site people
   hesitate over. The answer was in the FAQ, and the link beside the upload
   button went to #tech-heading — a section about measurement, on a different
   page, so on /design the tap did nothing. These tests keep the answer next to
   every upload button, keep its link pointing at the privacy notice, and keep
   what it says in step with legal/privacy.html. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'landing.js'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'legal', 'privacy.html'), 'utf8');
const LINE = /Your original photo isn(’|&rsquo;)t kept/;

test('the privacy notice has the anchor the upload lines link to', () => {
  assert.match(privacy, /id="your-photograph"[^>]*>What happens to your photograph/);
});

test('the first screen answers the question right under the hero button', () => {
  const start = index.indexOf('id="choose-heading"');
  const button = index.indexOf('See my house &amp; price', start);
  const after = index.slice(button, button + 2000);
  assert.match(after, LINE);
  assert.ok(after.includes('/privacy#your-photograph'));
});

test('the upload panel answers it in place, and links to the notice', () => {
  const at = index.search(/'Your original photo isn’t kept\./);
  assert.ok(at > 0, 'the upload panel line is missing');
  const block = index.slice(at - 400, at + 1200);
  assert.ok(block.includes("h('details'"), 'it opens in place');
  assert.ok(block.includes('/privacy#your-photograph'));
});

test('no "how your photo is used" link points at the measurement section', () => {
  assert.ok(!/href=["']#tech-heading["']/.test(index));
  assert.ok(!/href: '#tech-heading'/.test(index));
});

test('every cost-page upload has the line and the link', () => {
  const buttons = (landing.match(/No sales call unless you ask<\/p>/g) || []).length;
  const lines = (landing.match(/Your original photo isn&rsquo;t kept\. <a href="\/privacy#your-photograph">/g) || []).length;
  assert.ok(buttons > 0);
  assert.strictEqual(lines, buttons);
});

test('what the explanation promises is what the privacy notice promises', () => {
  assert.match(privacy, /original photograph is deleted/);
  assert.match(privacy, /7 days/);
  for (const needle of ['photo is deleted immediately after processing', '6 months', '7 days', 'fingerprint']) {
    assert.ok(index.includes(needle), needle);
  }
  assert.ok(!/photo[^.]{0,40}kept for 30 days/i.test(index), 'no retention period the system does not implement');
});

test('one retention statement everywhere a person reads about their photo (priority fixes v2, 7 Oct)', () => {
  const home = fs.readFileSync(path.join(root, 'home.html'), 'utf8');
  const STATEMENT = 'Your original photo is deleted immediately after processing. We keep a secure fingerprint for 7 days to maintain estimate consistency, and store your generated designs for 6 months so you can return to your project.';
  assert.ok(home.includes(STATEMENT), 'homepage FAQ');
  assert.ok(index.split(STATEMENT).length - 1 >= 4, 'design page: hero, upload panel, trust card, FAQ');
  assert.ok(!/deleted after processing\. We keep your generated design/.test(home + index), 'the older wording is gone');
  assert.match(privacy, /7 days/);
  assert.match(privacy, /6 months/);
});

test('the measuring explanation says only what the engine does (8 Oct)', () => {
  const block = index.slice(index.indexOf('id="measuring-promises"'), index.indexOf('id="good-photo"') + 2000).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(block, /1\.98/);
  assert.match(block, /Estimated from your house type/);
  assert.match(block, /A typical length for your house type/);
  // never the brief's door height, an accuracy percentage, or a correction the engine does not do
  assert.doesNotMatch(block, /2,?095|2\.1 ?m|\d+ ?%|homograph|vanishing|perspective correct/i);
});
