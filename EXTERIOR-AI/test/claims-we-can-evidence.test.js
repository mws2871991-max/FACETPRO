/* Claims about installers must be ones we can stand behind. Run: npm test
 *
 * The consent wording dropped "vetted" on 1 October and names the actual
 * installers instead, because consent to be contacted has to say WHO will
 * contact you — the ICO has fined lead generators over exactly that
 * description (Join the Triboo, 2023). The town pages kept the word, so the
 * same claim was made in one place and abandoned in the other.
 *
 * "Vetted" describes a checking process. Ours is not written down or
 * evidenced yet; clause 6.3 of the installer agreement is what would make it
 * true. Put it back then, not before.
 */

'use strict';

require('./helpers/data-dir');

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const landing = require('../landing');
const consent = require('../consent');
const catalogue = JSON.parse(fs.readFileSync(path.join(root, 'catalogue.json'), 'utf8'));
const OPTS = { catalogue, siteUrl: 'https://www.facetpro.co.uk' };

/* What a visitor is served, not what the source says. A comment explaining
   why the word was removed contains the word, and a test that reads source
   cannot tell the two apart — it failed on exactly that first time. */
const rendered = () => {
  const out = [];
  for (const a of (landing.AREA_PAGES || [])) out.push([`area:${a.slug}`, landing.renderAreaPage(a.slug, OPTS)]);
  for (const c of (landing.COST_PAGES || []).slice(0, 6)) out.push([`cost:${c.slug}`, landing.renderCostPage(c.slug, OPTS)]);
  out.push(['index.html', fs.readFileSync(path.join(root, 'index.html'), 'utf8')]);
  for (const f of ['legal/privacy.html', 'legal/terms.html']) out.push([f, fs.readFileSync(path.join(root, f), 'utf8')]);
  return out;
};

test('no page served calls an installer vetted', () => {
  const guilty = rendered().filter(([, html]) => /vetted/i.test(html)).map(([name]) => name);
  assert.deepStrictEqual(guilty, [],
    `"vetted" is a claim about a checking process nobody has written down yet — installer agreement 6.3: ${guilty.join(', ')}`);
});

test('the consent wording in force does not claim it either', () => {
  /* Only the CURRENT version. The superseded ones keep their exact words on
     purpose: a stored consent record has to reproduce what that person
     actually agreed to, and rewriting history would defeat the point of
     versioning it. */
  const current = consent.VERSIONS[consent.CURRENT];
  assert.ok(current, `no wording stored for ${consent.CURRENT}`);
  assert.ok(!/vetted/i.test(JSON.stringify(current)),
    'the wording in force has taken "vetted" back');

  const superseded = Object.keys(consent.VERSIONS).filter(v => v !== consent.CURRENT);
  assert.ok(superseded.length, 'the earlier versions should still be kept');
  assert.ok(superseded.some(v => /vetted/i.test(JSON.stringify(consent.VERSIONS[v]))),
    'an earlier version has been edited — those are a record of what people agreed to, not copy');
});

test('removing the claim did not remove the information', () => {
  /* They cover the postcode, at most three get the enquiry, and only on
     request — all true, and all still said.

     With recipients supplied, because that is the branch carrying the claim.
     Without any (LEAD_RECIPIENTS unset, as now) the page correctly says the
     opposite: still signing installers up, no quotes promised here yet. */
  const recipients = [
    { id: 'a', name: 'A', areas: ['SS'], trades: [] },
    { id: 'b', name: 'B', areas: ['SS'], trades: [] },
  ];
  const html = landing.renderAreaPage('windows-basildon', { ...OPTS, recipients });
  assert.ok(!/vetted/i.test(html), 'the claim came back when installers were configured');
  assert.match(html, /covering/i, 'the page no longer says they cover the area');
  assert.match(html, /up to three/i, 'the page no longer says at most three');
  assert.match(html, /only if you ask/i, 'the page no longer says it happens only on request');

  /* And the honest empty state, which is what a visitor sees today. */
  const none = landing.renderAreaPage('windows-basildon', { ...OPTS, recipients: [] });
  assert.match(none, /still signing up installers/i,
    'with no installers the page should say so rather than imply coverage');
});

test('the FENSA claim is tied to the installers it is about', () => {
  /* "Our window and door installers are FENSA registered" is shown under the
     render and beside the quote form — read at the moment somebody decides
     whether to hand over their details. Mike confirmed on 1 October 2026 that
     every glazing installer taking leads is registered, and installer
     agreement 6.2 holds the proof.

     What this guards is the future. The claim covers whoever is in
     LEAD_RECIPIENTS, which is empty today; adding an installer without their
     registration makes a published sentence false for everybody reading it.
     This test is the place that says so out loud — it cannot check FENSA's
     register, and does not pretend to. */
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const at = page.indexOf("const INSTALLER_VETTING =");
  assert.ok(at > 0, 'the claim has moved — check what keeps it true');
  const context = page.slice(Math.max(0, at - 1300), at);
  assert.match(context, /FENSA/, 'the claim no longer records what it rests on');
  assert.match(context, /6\.2/, 'it no longer points at where the proof is held');
  assert.match(context, /LEAD_RECIPIENTS/,
    'it no longer says that adding an installer is what can make it false');

  /* And it is one constant, so changing it changes every place it appears. */
  const uses = (page.match(/INSTALLER_VETTING/g) || []).length;
  assert.ok(uses >= 3, 'the claim should be stated from one constant, not retyped');
});
