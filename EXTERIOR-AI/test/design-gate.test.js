/* Nothing that designs a house appears until there is a house to design.

   579b193 cut cold /design from 9,432px to 3,719px by hiding four sections
   until there is something to design with. It shipped with no test, and the
   part most worth pinning is the part least likely to be noticed if it
   breaks.

   THE FAILURE MODE. state.resumedDesign is set in exactly one place and read
   in exactly one place. If a refactor loses either end, the page still looks
   perfect to anybody testing with a photograph — every manual check passes.
   It breaks only for somebody returning with a six-character code, who is
   shown an upload box and none of the design they saved. That is a worse bug
   than the one the gate was written to fix, and it is silent.

   So these assert the rule rather than the pixels: the pixels are the
   designer's to move, and the rule is what nobody can see go wrong. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

/* The predicate, read out of the source and pinned exactly.

   Asserting the whole expression rather than matching loosely is deliberate:
   the truth table below is modelled by hand, and a hand-written model is only
   honest while the thing it models is known to be unchanged. Any drift fails
   here first, with a message saying what it drifted to. */
function gateRule() {
  const fn = page.match(/function gateUntilSubject\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'gateUntilSubject has gone or been renamed — /design is ungated');

  const pred = fn[0].match(/const hasSubject = ([^;]+);/);
  assert.ok(pred, 'gateUntilSubject no longer computes hasSubject');

  const actual = pred[1].replace(/\s+/g, ' ').trim();
  const expected = "state.stage !== 'landing' || state.resumedDesign";
  assert.strictEqual(actual, expected,
    `the gate predicate changed to "${actual}". If that is deliberate, update the truth table below — `
    + 'but check the resumed-design case first: a code carries choices, not the photograph.');

  return (stage, resumedDesign) => stage !== 'landing' || resumedDesign;
}

test('cold /design hides the four sections that need a house', () => {
  const hasSubject = gateRule();
  assert.strictEqual(hasSubject('landing', false), false);
});

test('a photograph reveals them', () => {
  const hasSubject = gateRule();
  assert.strictEqual(hasSubject('visualizer', false), true);
});

test('a photograph we could not read still counts', () => {
  /* The detect path sets stage to 'visualizer' on the error branch too, and
     that is right: a photograph we failed on is still a photograph, and that
     person needs the controls more than anybody. */
  const hasSubject = gateRule();
  assert.strictEqual(hasSubject('visualizer', false), true);
  assert.match(page, /state\.stage = 'visualizer';\s*\n\s*state\.detectionStatus = 'error';/,
    'the failed-detection branch no longer reaches the visualiser stage');
});

test('a resumed design is shown even with no photograph', () => {
  /* THE CASE THAT MAKES THIS FILE WORTH HAVING. A code restores the choices
     and not the image, so the visitor is still at stage 'landing'. Under a
     photo test they would come back to find their own saved work hidden. */
  const hasSubject = gateRule();
  assert.strictEqual(hasSubject('landing', true), true,
    'a returning customer with a code is being shown an upload box and none of their design');
});

test('the flag is actually set when a code is redeemed', () => {
  /* Half the bug: the predicate can be perfect and still never fire. */
  const fn = page.match(/async function redeemResumeCode\(code\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'redeemResumeCode has gone or been renamed');
  assert.match(fn[0], /state\.resumedDesign = true;/,
    'redeeming a code no longer records that there is something to design with');

  /* After the design is applied, not before — a failed redemption must not
     reveal the controls for a design that never arrived. */
  const applied = fn[0].indexOf('applyDesign(');
  const flagged = fn[0].indexOf('state.resumedDesign = true');
  assert.ok(applied > -1 && flagged > applied,
    'resumedDesign is set before the design is applied — a failed code would reveal an empty design');
});

test('the flag exists on state, so the predicate is never reading undefined', () => {
  assert.match(page, /resumedDesign: false,/,
    'state.resumedDesign is no longer declared');
});

test('the gate covers the four sections and nothing a visitor needs first', () => {
  const m = page.match(/const GATED_UNTIL_SUBJECT = \[([^\]]*)\];/);
  assert.ok(m, 'GATED_UNTIL_SUBJECT has gone');
  const ids = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, '')).filter(Boolean);

  assert.deepStrictEqual(ids.sort(),
    ['mount-lead', 'mount-refine', 'mount-visualizer', 'windows-doors'].sort());

  /* The upload box, the trade chooser and the beta notice are how somebody
     gets a house on screen at all. Gating any of them behind having a house
     would lock the door and post the key inside. */
  for (const needed of ['mount-upload', 'mount-triage', 'beta-notice']) {
    assert.ok(!ids.includes(needed),
      `${needed} is gated behind having a photo — there is now no way to provide one`);
  }
});

test('the gate runs on every render', () => {
  /* A gate that is never called is a comment. */
  const fn = page.match(/function render\(\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'render() has gone or been renamed');
  assert.match(fn[0], /gateUntilSubject\(\);/,
    'render no longer applies the gate — the sections would stay as the last state left them');
});

test('the gate does not fight applyPage over the same attribute', () => {
  /* Both write el.hidden. applyPage owns data-page visibility, so on the
     homepage — where these sections are hidden as a matter of routing — the
     gate must stand aside rather than keep re-showing them. */
  const fn = page.match(/function gateUntilSubject\(\) \{[\s\S]*?\n\}/);
  assert.match(fn[0], /if \(el\.dataset\.page && el\.dataset\.page !== PAGE\) continue;/,
    'the gate no longer stands aside for applyPage — it will re-show tool sections on the homepage');
});

/* ── A returning customer is not asked what they came for ── */

test('redeeming a code closes the triage question it never answered', () => {
  /* triageOpen starts as !readJourney(), which is right for a cold visitor
     and wrong for a returning one: /design?code=XXXX carries no journey, so
     the question opens, and redeeming the code never closed it.

     Walked live before this: "Your design is back — now take a photo of the
     front of your house", with "What are you looking for today?" directly
     underneath, above the very choices they had saved. A resume code carries
     choices, not intent, so state.journey is null and it fell all the way
     through to the seven-way question.

     Fixed in the state rather than only in the view, because the question is
     not open — it has been answered, by them, the day they saved. */
  const redeem = page.slice(page.indexOf('async function redeemResumeCode'));
  const body = redeem.slice(0, redeem.indexOf('\n}'));
  assert.match(body, /state\.resumedDesign = true/);
  assert.match(body, /state\.triageOpen = false/,
    'redeeming a code leaves the triage question open above the restored design');
});

test('the restored design says so, and stays changeable', () => {
  const triage = page.slice(page.indexOf('function buildTriage'));
  const body = triage.slice(0, triage.indexOf('\nfunction '));

  /* Its own branch, before the full question. */
  assert.match(body, /state\.resumedDesign && !state\.triageOpen/,
    'a restored design has no branch of its own, so it falls to the question');

  /* And the way back. Somebody who saved a windows design may have come back
     about a roof, so the answer has to be reopenable — the same affordance
     the known-journey branch gives. */
  const at = body.indexOf('state.resumedDesign && !state.triageOpen');
  const branch = body.slice(at, at + 1400);
  assert.match(branch, /state\.triageOpen = true/,
    'there is no way to reopen the question from a restored design');

  /* The cold visitor still gets asked — this narrows who is asked, it does
     not remove the question. */
  assert.match(body, /What are you looking for today\?/,
    'the triage question has gone entirely');
});
