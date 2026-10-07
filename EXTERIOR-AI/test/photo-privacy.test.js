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
  for (const needle of ['photo is deleted after processing', '6 months', 'seven days', 'fingerprint']) {
    assert.ok(index.includes(needle), needle);
  }
  assert.ok(!/photo[^.]{0,40}kept for 30 days/i.test(index), 'no retention period the system does not implement');
});

test('one retention sentence everywhere a person first reads about their photo (handoff 7 Oct §8)', () => {
  const home = fs.readFileSync(path.join(root, 'home.html'), 'utf8');
  const SIMPLE = 'Your original photo is deleted after processing. We keep your generated design and selections for 6 months so you can return to your project.';
  assert.ok(home.includes(SIMPLE), 'homepage FAQ');
  assert.ok(index.split(SIMPLE).length - 1 >= 4, 'design page: hero, upload panel, trust card, FAQ');
  // The fingerprint is said separately, never inside the first explanation.
  for (const block of index.split(SIMPLE).slice(1)) assert.ok(!/^[^<]{0,80}fingerprint/.test(block));
  assert.match(privacy, /6 months/);
});
