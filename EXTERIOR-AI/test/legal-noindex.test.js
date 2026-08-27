/* An unfinished legal page must not be offered to search engines.

   /privacy and /terms were live, HTTP 200, carrying
   `<meta name="robots" content="index, follow">`, listed in the sitemap — and
   holding thirteen and nine unfilled placeholders between them. Anybody could
   read a privacy notice that said [COMPANY LEGAL NAME], and Google was being
   invited to keep a copy.

   Nothing caught it, and the reason is worth stating because it is the kind of
   gap that reopens. refuseToStartIfTheNoticeIsUnfinished() reads exactly these
   two files, and it is correct for what it guards — taking someone's details
   behind an unfinished Article 13 notice — so it only looks when LEAD_CAPTURE
   is on. Capture is off. It never looked. Publishing an unfinished notice and
   collecting behind one are different failures, and only the second was
   watched. An external review found the first.

   The rule under test is not "these two pages are noindex". It is "a legal
   page is indexable exactly when it has no brackets left in it" — so the
   protection lifts by itself when the brackets are filled, and no one has to
   remember to lift it. Both directions are asserted below, because a guard
   that never turns off is a guard that will be deleted by whoever fills in the
   company number and finds their notice still invisible.

   Deliberately NOT asserted: that the pages 404 or redirect. They must stay
   reachable. A service that processes photographs of people's homes and
   offers no privacy notice at all is worse than one offering a visibly draft
   notice, and a visitor who goes looking for it is entitled to find it. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3241;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.LEAD_CAPTURE = 'off';

const realFetch = globalThis.fetch;
require('../server');

before(async () => { await require('./helpers/server-ready')(BASE); });

const LEGAL = ['/privacy', '/terms'];
const FILES = { '/privacy': 'privacy.html', '/terms': 'terms.html' };
const legalDir = path.join(__dirname, '..', 'legal');

/* The same definition the app uses: a placeholder is its brackets. */
const PLACEHOLDER = /\[[A-Z][^\]]{2,200}\]/g;
const bracketsIn = (file) =>
  (fs.readFileSync(path.join(legalDir, file), 'utf8').match(PLACEHOLDER) || []).length;

test('the legal pages are still served — a draft notice beats no notice', async () => {
  for (const p of LEGAL) {
    const res = await realFetch(BASE + p);
    assert.strictEqual(res.status, 200, `${p} must stay reachable`);
    assert.ok((await res.text()).length > 500, `${p} served something substantive`);
  }
});

test('while a legal page has placeholders it is served noindex', async () => {
  for (const p of LEGAL) {
    const left = bracketsIn(FILES[p]);
    const res = await realFetch(BASE + p);
    const tag = res.headers.get('x-robots-tag');
    if (left) {
      assert.match(tag || '', /noindex/,
        `${p} has ${left} placeholder(s) and must not be indexed`);
    } else {
      assert.ok(!/noindex/.test(tag || ''),
        `${p} is finished — the guard must lift itself, not need lifting`);
    }
  }
});

test('an unfinished legal page is kept out of the sitemap', async () => {
  const xml = await (await realFetch(`${BASE}/sitemap.xml`)).text();
  for (const p of LEGAL) {
    const listed = xml.includes(`<loc>`) && new RegExp(`<loc>[^<]*${p}</loc>`).test(xml);
    assert.strictEqual(listed, bracketsIn(FILES[p]) === 0,
      `${p} should be in the sitemap only once its brackets are filled`);
  }
});

/* The reversal, proved rather than assumed. Everything above is conditional on
   the real files, so on the day they are finished those tests keep passing by
   taking the other branch — which means they would also pass if the mechanism
   had been ripped out. This one writes a clean page to disk and checks the
   protection actually lifts. */
test('a finished legal page becomes indexable again, with no restart', async () => {
  const file = path.join(legalDir, 'privacy.html');
  const original = fs.readFileSync(file, 'utf8');
  const cleaned = original.replace(PLACEHOLDER, 'Example Ltd');
  assert.ok(!PLACEHOLDER.test(cleaned), 'the stand-in must itself be bracket-free');

  try {
    fs.writeFileSync(file, cleaned);
    const res = await realFetch(`${BASE}/privacy`);
    assert.strictEqual(res.status, 200);
    assert.ok(!/noindex/.test(res.headers.get('x-robots-tag') || ''),
      'a finished notice must not stay hidden — it is read per request for this reason');

    const xml = await (await realFetch(`${BASE}/sitemap.xml`)).text();
    assert.match(xml, /<loc>[^<]*\/privacy<\/loc>/, 'and it returns to the sitemap');
  } finally {
    fs.writeFileSync(file, original);
  }

  // And back again, without touching the process.
  const again = await realFetch(`${BASE}/privacy`);
  assert.match(again.headers.get('x-robots-tag') || '', /noindex/,
    'restoring the placeholders restores the protection');
});

test('the homepage is still indexable — this must not have leaked', async () => {
  const res = await realFetch(`${BASE}/`);
  assert.ok(!/noindex/.test(res.headers.get('x-robots-tag') || ''),
    'only the legal pages are gated, and only while unfinished');
});
