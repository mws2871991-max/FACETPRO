/* The invitation, where the explanation ends.

   Measured on the live homepage, 375px, 22 September: the four steps finished
   at 4,539px and the next CTA a homeowner could see was at 5,892px. 1,353px —
   1.7 phone screens — with nothing to act on, directly after the section that
   explains the whole product. The CTA before it sat at 3,178px, ABOVE the
   explanation, so the page invited, then explained, then left the most
   persuaded reader on it with nothing to press.

   These assert the rule rather than the pixels, because the pixels are the
   designer's to move. What must not drift is the ORDER — an invitation that
   floats back above the explanation recreates the gap exactly — and the
   counter, because a CTA inserted between two existing CTAs can look
   successful while earning nothing. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('there is an invitation under the four steps', () => {
  assert.match(page, /id="steps-cta-heading"/,
    'the CTA under the four steps has gone — the explanation ends with nothing to press');
  assert.match(page, /reachedStage\('steps_cta_click'\); goToUpload\(\)/,
    'the CTA no longer counts itself or no longer reaches the upload box');
});

test('it comes after the explanation, not before it', () => {
  /* The whole point. There was already a CTA on this page above "How it
     works"; a second one that drifts above it as well would leave the gap
     where it was and add a button nobody needed. */
  const steps = page.indexOf('id="how-it-works"');
  const cta = page.indexOf('id="steps-cta-heading"');
  const fiveTrades = page.indexOf('One photo. Five trades. One starting point.');

  assert.ok(steps > -1 && cta > -1 && fiveTrades > -1, 'one of the three anchors has gone');
  assert.ok(cta > steps, 'the invitation has moved above the four steps — the gap after them is back');
  assert.ok(cta > fiveTrades, 'the invitation has moved inside the four steps rather than after them');
});

test('it is never on the tool page', () => {
  /* /design is where somebody is already doing this. An "upload my house"
     block on the tool page, above the upload box, is the thing 579b193 was
     written to stop. Since 24 September it lives on /how-we-price, with the
     other long-form content the homepage no longer opens with. */
  const cta = page.indexOf('id="steps-cta-heading"');
  const open = page.lastIndexOf('<section', cta);
  assert.match(page.slice(open, cta), /data-page="(home|pricing)"/,
    'the steps CTA is not scoped to a content page');
  assert.doesNotMatch(page.slice(open, cta), /data-page="design"/);
});

test('the stage it fires is one the server will accept', () => {
  /* /api/funnel refuses any stage that is in neither list, with a 400. So a
     button wired to an unregistered stage fails silently in the browser and
     records nothing — the counter reads zero and looks like indifference
     rather than a wiring fault. */
  assert.match(server, /\['steps_cta_click', \{ of: 'landing'/,
    'steps_cta_click is not a registered branch stage — every click will 400 and count nothing');
});

test('it is counted apart from the other two invitations', () => {
  /* Three buttons into one upload box say only "somebody started". The
     question this one has to answer is whether a third position earns
     uploads or merely takes clicks that would have happened 1,353px later,
     and that needs all three counted separately against landing. */
  for (const stage of ['cta_clicked', 'real_home_cta_click', 'steps_cta_click']) {
    assert.ok(page.includes(`reachedStage('${stage}')`),
      `${stage} is no longer fired anywhere — the three entry points cannot be told apart`);
  }
  assert.match(server, /\['real_home_cta_click', \{ of: 'landing'/);
});

test('the branches stay subsets of cta_clicked, and say so', () => {
  /* Every one of these buttons calls goToUpload(), which fires cta_clicked.
     So cta_clicked is the total and the two named branches are subsets —
     summing all three counts the same click twice, and the hero's own share
     is what is left after subtracting them.

     If goToUpload ever stops firing cta_clicked, that arithmetic silently
     inverts and the dashboard under-reports the hero instead. */
  const fn = page.match(/function goToUpload\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'goToUpload has gone or been renamed');
  assert.match(fn[0], /reachedStage\('cta_clicked'\);/,
    'goToUpload no longer fires cta_clicked — it is no longer the total of the three invitations');
  assert.match(server, /hero = cta_clicked - real_home_cta_click - steps_cta_click/,
    'the note saying the three do not sum has gone — somebody will add them up');
});

test('the five-trade line describes rather than argues', () => {
  /* 22 September review: "the customer doesn't need to be told repeatedly how
     frustrating traditional quoting is". It is said in the hero and again in
     "Why two neighbours pay thousands apart"; a third time, inside the
     section explaining how the product works, was arguing where it should
     have been describing. */
  assert.match(page, /One photo\. Five trades\. One starting point\./,
    'the claim itself is gone — that line is the proposition, not the padding');
  assert.ok(!page.includes('booking, waiting in for and chasing'),
    'the booking-and-chasing clause is back in the four-steps section');
  assert.match(page, /Windows, doors, walls, roofline and roof &mdash; priced together from the same photograph\./,
    'the supporting line has drifted from the agreed wording');
});
