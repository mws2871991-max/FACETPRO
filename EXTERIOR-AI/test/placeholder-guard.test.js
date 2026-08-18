/* The guard that stops a half-finished legal page reaching a deployment.

   It exists so shipping a notice that still says [COMPANY LEGAL NAME] is
   impossible rather than merely unlikely — Article 13 wants the controller
   named at the point of collection, and a placeholder names nobody.

   It had a hole. The pattern enumerated the characters a placeholder may
   contain:

     /\[[A-Z][A-Z0-9 &;#/,.'’-]{2,60}\]/

   & and ; were allowed so HTML entities would pass — but an entity's name is
   lowercase and only A-Z was in the class, so &mdash; broke the match. The
   sixty-character cap and the missing literal em dash did the rest. Six real
   placeholders were invisible to it, and the startup line reporting the count
   under-reported by the same six.

   Three of those six were one field: the international-transfer mechanism in
   the privacy notice — the instrument under which a homeowner's photograph
   reaches a company in the United States. Precisely the field the guard was
   written to protect, and precisely the one it could not see.

   Enumerating was the mistake. A placeholder is defined by its brackets, so
   the pattern anchors on those. These tests pin the shapes we actually write,
   because this is a regex that looked correct for months and was not. */

'use strict';

require('./helpers/data-dir');

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

/* Read the live pattern out of the source rather than restating it here — a
   copy in the test would let the two drift, which is the whole failure mode
   this file exists to catch. */
function livePattern() {
  const m = server.match(/const PLACEHOLDER = (\/(?:[^/\\]|\\.)+\/[gimsuy]*)/);
  assert.ok(m, 'const PLACEHOLDER has moved or been renamed — re-check this test');
  const body = m[1].replace(/^\//, '').replace(/\/[gimsuy]*$/, '');
  return new RegExp(body);
}

test('the guard catches every placeholder shape we actually write', () => {
  const P = livePattern();
  for (const s of [
    '[COMPANY NUMBER]',
    '[CRM PROVIDER &mdash; DELETE THIS LINE IF YOU DO NOT USE ONE]',
    '[UK EXTENSION TO THE EU&ndash;US DATA PRIVACY FRAMEWORK / UK ADDENDUM TO THE EU SCCs]',
    '[FCA-PRESCRIBED RISK WARNING &mdash; EXACT WORDING FROM SOLICITOR]',
    '[A LITERAL EM DASH — LIKE THIS]',
    '[' + 'A'.repeat(80) + ']',
  ]) {
    assert.match(s, P, `the guard would not catch: ${s.slice(0, 70)}`);
  }
});

test('the guard ignores ordinary prose in brackets', () => {
  /* A guard that fires on "[see section 4]" refuses to start for no reason,
     and the next person deletes it. */
  const P = livePattern();
  for (const s of ['[see section 4]', '[1]', 'array[0]', '[a note]']) {
    assert.doesNotMatch(s, P, `the guard fires on ordinary text: ${s}`);
  }
});

test('every page that carries placeholders is actually checked', () => {
  /* The investor page had two — the exemption being relied on and the FCA
     risk warning — and was checked nowhere, so a financial promotion could
     have gone out with a solicitor's placeholder in it.

     Matched on the path components rather than on "gated/investors.html",
     because the path is assembled with path.join and the literal string with
     a slash in it does not appear in the source. An earlier version of this
     assertion looked for that string and passed only by luck. */
  assert.match(server, /'gated',\s*'investors\.html'/,
    'nothing reads the investor page to check it for placeholders');
  assert.match(server, /function investorPageUnfinished/,
    'the investor page placeholder check has gone');
  assert.match(server, /PAGES_WITH_PLACEHOLDERS = \[[^\]]*legal\/privacy\.html[^\]]*legal\/terms\.html/,
    'the legal pages are no longer in the startup guard list');
});

test('an unfinished investor page is refused at the door, not at startup', () => {
  /* The first version of this refused to START when the page had placeholders
     and INVESTOR_PASSWORD was set. Both were true on the deployment, so the
     next restart would have taken the whole site down over one gated page.

     Refusing to boot is right for an unfinished privacy notice — the
     alternative is collecting personal data behind it. It is wrong for an
     unfinished financial promotion, where not serving that one page costs
     nothing else. */
  assert.match(server, /if \(IS_DEPLOYED\) \{\s*const left = investorPageUnfinished\(\)/,
    'the investor page is no longer checked when it is requested');
  assert.doesNotMatch(server, /INVESTOR_PASSWORD \? \['gated\/investors\.html'\]/,
    'the startup guard still takes the whole process down over the investor page');
});

test('the reporting script uses the same pattern as the guard', () => {
  /* There are now two bracket-matching regexes: the one in server.js that
     refuses to start, and the one in scripts/check-legal-placeholders.js that
     lists what is left. Two of these drifting apart is precisely how six real
     placeholders became invisible to the last version of the guard — a
     reporting tool that sees fewer than the gate does would tell somebody the
     job was finished when it was not.

     Compared by source rather than by behaviour, because "equivalent regex" is
     not a thing you can check. If one is edited, edit both. */
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-legal-placeholders.js'), 'utf8');
  const patternIn = (src, where) => {
    const m = src.match(/const PLACEHOLDER = (\/(?:[^/\\]|\\.)+\/[gimsuy]*)/);
    assert.ok(m, `const PLACEHOLDER has moved in ${where}`);
    return m[1];
  };
  assert.strictEqual(patternIn(script, 'the script'), patternIn(server, 'server.js'),
    'the reporting script and the startup guard no longer match the same placeholders');
});

test('the reporting script covers every page the guard does', () => {
  /* Reporting on fewer pages than the gate blocks on would produce a clean
     report and a deployment that will not boot. */
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'check-legal-placeholders.js'), 'utf8');
  for (const page of ['legal/privacy.html', 'legal/terms.html', 'gated/investors.html']) {
    assert.ok(script.includes(`'${page}'`), `the script does not read ${page}`);
  }
});

test('the pages on disk match what the guard reports', () => {
  /* The count is what somebody reads before deciding the pages are done. If
     the pattern regresses, this is the assertion that notices — it fails when
     the guard sees fewer than a plain bracket-scan does. */
  const P = livePattern();
  const plain = /\[[A-Z][^\]]{2,200}\]/g;
  for (const page of ['legal/privacy.html', 'legal/terms.html', 'gated/investors.html']) {
    const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
    const byGuard = (html.match(new RegExp(P.source, 'g')) || []).length;
    const byScan = (html.match(plain) || []).length;
    assert.strictEqual(byGuard, byScan,
      `${page}: the guard sees ${byGuard} placeholders, a plain bracket scan sees ${byScan}`);
  }
});
