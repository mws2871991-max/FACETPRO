'use strict';

require('./helpers/data-dir');

/* The launch review (29 September): the blockers, one test each where the
   code can prove it. The lead-level behaviour (consent version, phone,
   honeypot) is exercised in consent.test.js and hardening.test.js. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');

test('installers get only what the consent wording lists', () => {
  const { forInstaller } = require('../leadview');
  const lead = {
    id: 'L1', ts: 't', name: 'N', email: 'e@x.co', phone: '07', postcode: 'RM17 5AA',
    selections: {}, preferences: {}, glazing: {}, price: 1, priceBreakdown: {}, pricing: {},
    project: {}, property: {}, leadScore: { score: 50 },
    notes: 'private', withdrawTokenHash: 'h', homeownerEmail: { sent: true }, notification: {},
    journeySource: 'windows', detectionCount: 3, clientMeasurementSource: 'x', status: 'New lead',
    consent: { at: 'a', version: '2026-09-30', terms: true, emailPack: true, installerQuotes: true, ipHash: 'abc', wording: { installerQuotes: 'W', terms: 'T', emailPack: 'E' } },
  };
  const out = forInstaller(lead);
  for (const k of ['notes', 'withdrawTokenHash', 'homeownerEmail', 'notification', 'journeySource', 'detectionCount', 'clientMeasurementSource', 'status']) {
    assert.ok(!(k in out), `${k} must not reach an installer`);
  }
  assert.deepStrictEqual(out.consent, { at: 'a', version: '2026-09-30', installerQuotes: true, wording: 'W' });
  assert.strictEqual(out.name, 'N');
  assert.ok(!JSON.stringify(out).includes('abc'), 'no IP hash');
  const server = read('server.js');
  assert.match(server, /const forInstaller = leadview\.forInstaller\(lead, \{ siteUrl: SITE_URL \}\);/);
  /* Developer brief, 6 Oct (§9): the design as a link that opens, and the
     quote request said plainly. Both come from what the lead already holds. */
  const withLink = forInstaller({ ...lead, renderUrl: '/r/abc123' }, { siteUrl: 'https://www.facetpro.co.uk/' });
  assert.strictEqual(withLink.renderLink, 'https://www.facetpro.co.uk/r/abc123');
  assert.deepStrictEqual(withLink.quoteRequest, { status: 'requested', at: 'a' });
  assert.ok(!('renderLink' in forInstaller({ ...lead, renderUrl: 'https://elsewhere.example/x' }, { siteUrl: 'https://www.facetpro.co.uk' })),
    'only our own render paths become links');
  assert.match(read('routes/installers.js'), /leadview'\)\.forInstaller/);
});

test('the privacy notice discloses the readiness score and what installers receive', () => {
  const p = read('legal/privacy.html');
  assert.match(p, /readiness score/);
  assert.doesNotMatch(p, /does not assess you, score you/);
  assert.match(p, /They receive your name, postcode, email address and phone number, your design, your estimate, your answers about the project/);
  assert.doesNotMatch(p, /session cookie/);
});

test('LEAD_CAPTURE is on only when plainly asked for', () => {
  assert.match(read('server.js'), /const LEAD_CAPTURE = \['on', 'true', '1', 'yes'\]\.includes\(LEAD_CAPTURE_RAW\);/);
});

test('the consent words live on the server, and the page shows the current ones', () => {
  const c = require('../consent');
  const html = read('index.html');
  const version = html.match(/const CONSENT_VERSION = '([^']+)'/)[1];
  assert.strictEqual(version, c.CURRENT);
  const shown = html.match(/installerQuotes: '((?:[^'\\]|\\.)*)'/)[1].replace(/\\u2019/g, '’');
  assert.strictEqual(shown, c.VERSIONS[c.CURRENT].installerQuotes);
  assert.ok(read('legal/CONSENT-VERSIONS.md').includes(`## ${c.CURRENT} (current)`));
});

test('the lead carries what the page priced: the counting photo and the openers', () => {
  const html = read('index.html');
  assert.match(html, /glazingDetectionId: state\.detectionId \|\| undefined/);
  assert.match(html, /openerCount: state\.openerCount \?\? undefined/);
  const server = read('server.js');
  assert.match(server, /const glazingId = body\.glazingDetectionId \|\| body\.detectionId;/);
  assert.match(server, /openerCount: body\.openerCount,/);
});

test('one window-and-door range everywhere: page, summary, portal, emails', () => {
  const html = read('index.html');
  assert.doesNotMatch(html, /state\.glazing\.range\.low/);
  assert.doesNotMatch(html, /lead\.glazing\?\.range\?\.low/);
  const emails = require('../emails');
  const lead = {
    id: 'L2', name: 'N', email: 'e@x.co', postcode: 'RM17 5AA', consent: { installerQuotes: false },
    glazing: { windowCount: 8, range: { low: 1, high: 2 }, marketRange: { low: 9182, high: 16694 }, price: { windowsIncluded: true } },
    preferences: { windows: { material: { id: 'aluminium', name: 'Aluminium' }, style: { name: 'Casement' } } },
  };
  const html2 = emails.designPackHtml(lead, null, 'https://www.facetpro.co.uk', 'tok', []);
  assert.match(html2, /£9,182 – £16,694/);
  assert.match(html2, /Aluminium · Casement/);
  assert.doesNotMatch(html2, /£1 – £2/);
});

test('a script filling every field is refused, and there is a daily ceiling', () => {
  const html = read('index.html');
  assert.match(html, /id: 'lead-website', name: 'website', tabindex: '-1'/);
  const server = read('server.js');
  assert.match(server, /if \(String\(req\.body\?\.website \|\| ''\)\.trim\(\)\)/);
  assert.match(server, /const leadCap = takeLeadAllowance\(req\);/);
});

test('no installer delivery until the homeowner has the withdrawal link', () => {
  assert.match(read('server.js'), /lead\.deliveryHeld = 'homeowner email failed';/);
});

/* Second pass (30 September): the "most important" list. */
test('missing AI keys give a homeowner a plain 503, never the variable name', () => {
  const server = read('server.js');
  assert.doesNotMatch(server, /error: 'ANTHROPIC_API_KEY not set/);
  assert.doesNotMatch(server, /error: 'REPLICATE_API_TOKEN not set/);
  assert.match(server, /reason: 'analysis_unavailable'/);
  assert.match(server, /reason: 'render_unavailable'/);
});

test('a failed upload stays on step 1 with the reason and a way to try again', () => {
  const html = read('index.html');
  assert.match(html, /const uploadErrorNotice = state\.uploadError/);
  assert.match(html, /'Try another photo'/);
  assert.match(html, /That file isn’t a photo\./);
  assert.doesNotMatch(html, /`We couldn’t read that photo: \$\{err\.message\}`/);
});

test('daily photo caps are raised for launch', () => {
  const server = read('server.js');
  assert.match(server, /envLimit\('DAILY_DETECT_LIMIT', 300\)/);
  assert.match(server, /envLimit\('DAILY_RENDER_LIMIT', 200\)/);
});

test('a saved design brings back its front correction and openers', () => {
  const resume = require('../resume');
  const out = resume.buildPayload({ frontCount: 3, openerCount: 2 });
  assert.strictEqual(out.frontCount, 3);
  assert.strictEqual(out.openerCount, 2);
  assert.match(read('index.html'), /if \(Number\.isFinite\(d\.openerCount\) && d\.openerCount >= 0\) state\.openerCount = d\.openerCount;/);
});
