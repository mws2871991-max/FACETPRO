/* The lead score.

   A score is the kind of number that gets believed, and this one decides what
   an installer is charged for and eventually who a lead is routed to. So the
   tests here are less about arithmetic than about the four promises the module
   makes: it counts only what happened, it never scores a person, it is
   deterministic, and the reasons match the number.
*/

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const leadscore = require('../leadscore');

/* The strongest lead the journey can produce: their house, their design, a
   price, a render, a postcode, and a request to be contacted this month. */
const complete = () => ({
  postcode: 'RM17 6SL',
  detectionCount: 9,
  price: 12400,
  glazing: { price: true, range: { low: 9000, high: 14000 } },
  renderUrl: '/r/abc123',
  selections: { cladding: { id: 'alabaster' }, roof: { id: 'slate' }, trim: { id: 'ink' } },
  preferences: { windows: { style: { id: 'casement' }, door: { id: 'composite' } } },
  project: { interests: ['whole-exterior'], timing: 'asap' },
  property: { type: 'semi', homeowner: true },
  consent: { terms: true, installerQuotes: true },
});

/* The weakest thing that is still a lead: a name and an email, terms agreed,
   nothing else. */
const bare = () => ({ consent: { terms: true } });

test('the weights sum to 100, so a factor cannot be added for free', () => {
  const total = Object.values(leadscore.WEIGHTS).reduce((a, b) => a + b, 0);
  assert.strictEqual(total, 100,
    'adding a factor without deciding what it displaces makes the score drift');
});

test('a complete, contactable, ready-to-buy project scores high', () => {
  const { score, band } = leadscore.score(complete());
  assert.ok(score >= 80, `expected a hot lead, got ${score}`);
  assert.strictEqual(band, 'hot');
});

test('a bare lead scores low but never zero', () => {
  const { score, band } = leadscore.score(bare());
  assert.ok(score < 40, `expected a cold lead, got ${score}`);
  assert.strictEqual(band, 'cold');
  /* Zero would route them to nobody at all, and somebody who typed their
     details in is not worth nothing. */
  assert.ok(score > 0, 'a lead that exists should score above zero');
});

test('the same lead always scores the same', () => {
  /* An installer querying a lead they were sent last week must see the number
     they were charged against. */
  const lead = complete();
  const runs = new Set(Array.from({ length: 5 }, () => leadscore.score(lead).score));
  assert.strictEqual(runs.size, 1, `five runs produced ${[...runs].join(', ')}`);
});

test('asking for quotes is the heaviest single signal', () => {
  const withConsent = leadscore.score(complete()).score;
  const without = complete();
  without.consent.installerQuotes = false;
  assert.ok(withConsent - leadscore.score(without).score >= 15,
    'the one place the homeowner says out loud that they want a quote should dominate');
});

test('an unusable postcode costs the lead, because it costs the routing', () => {
  const good = leadscore.score(complete()).score;
  const bad = complete();
  bad.postcode = 'not a postcode';
  const scored = leadscore.score(bad);
  assert.ok(scored.score < good);
  assert.ok(scored.reasons.some(r => r.factor === 'postcodeUsable' && r.points === 0));
});

test('"just researching" scores lower than "as soon as possible", and still scores', () => {
  const soon = complete();
  const later = complete();
  later.project.timing = 'researching';
  const a = leadscore.score(soon).score;
  const b = leadscore.score(later).score;
  assert.ok(b < a, 'timescale should move the number');
  const factor = leadscore.score(later).reasons.find(r => r.factor === 'timescale');
  assert.ok(factor.points > 0, 'a researcher in August is a job in October');
});

test('an unanswered timescale is not treated as researching', () => {
  /* "Not told" and "not urgent" are different facts. Scoring silence as the
     worst answer marks down every design saved without the quote steps. */
  const silent = complete();
  delete silent.project.timing;
  const researching = complete();
  researching.project.timing = 'researching';
  assert.ok(leadscore.score(silent).score > leadscore.score(researching).score);
});

test('an unanswered homeowner question is not treated as a denial', () => {
  const asked = complete();
  const notAsked = complete();
  delete notAsked.property;
  const denied = complete();
  denied.property = { type: 'semi', homeowner: false };
  assert.strictEqual(leadscore.score(notAsked).reasons.find(r => r.factor === 'homeownerConfirmed').points, 0);
  assert.strictEqual(leadscore.score(denied).reasons.find(r => r.factor === 'homeownerConfirmed').points, 0);
  assert.ok(leadscore.score(asked).score > leadscore.score(notAsked).score);
});

test('a bigger project scores higher than a small one', () => {
  const big = complete();
  const small = complete();
  small.price = 900;
  small.glazing = { price: true, range: { low: 800, high: 1200 } };
  assert.ok(leadscore.score(big).score > leadscore.score(small).score);
});

test('the project value is the midpoint of the range, never the top of it', () => {
  const value = leadscore.projectValueOf({ price: 10000, glazing: { range: { low: 4000, high: 8000 } } });
  assert.strictEqual(value, 16000, 'a range should contribute its midpoint');
});

test('every reason names its factor, its award and its ceiling', () => {
  const { score, reasons } = leadscore.score(complete());
  const summed = reasons.reduce((a, r) => a + r.points, 0);
  assert.strictEqual(summed, score, 'the reasons should add up to the number shown');
  for (const r of reasons) {
    assert.ok(leadscore.WEIGHTS[r.factor] !== undefined, `${r.factor} is not a declared weight`);
    assert.strictEqual(r.of, leadscore.WEIGHTS[r.factor]);
    assert.ok(typeof r.why === 'string' && r.why.length > 3, `${r.factor} has no explanation`);
  }
});

test('it never scores the person', () => {
  /* Two leads identical in every project respect and different in every
     personal one must score the same. Anything else is profiling — on a
     lawful basis nobody has agreed to, using inputs (an email domain, a
     phone prefix, a name) that stand in for who somebody is. */
  const a = complete();
  const b = complete();
  Object.assign(a, { name: 'Ade Okonjo', email: 'ade@gmail.com', phone: '07700 900001' });
  Object.assign(b, { name: 'Henry Fitzwilliam-Vane', email: 'h.fitzwilliam-vane@savills.co.uk', phone: '020 7000 0000' });
  assert.strictEqual(leadscore.score(a).score, leadscore.score(b).score);
});

test('the area itself is never an input, only whether we could read it', () => {
  /* Postcode is used for "can an installer reach them", never for what the
     area is like. Two valid postcodes at opposite ends of the country and of
     the property market must score identically. */
  const rich = complete(); rich.postcode = 'SW1A 1AA';
  const poor = complete(); poor.postcode = 'TS1 1AA';
  assert.strictEqual(leadscore.score(rich).score, leadscore.score(poor).score);

  const source = fs.readFileSync(path.join(__dirname, '..', 'leadscore.js'), 'utf8');
  /* A tripwire, not proof: if somebody adds an area lookup table, this is the
     test that should have to be deleted deliberately. */
  assert.ok(!/\b(deprivation|imd|affluen|houseprice|house_price|acorn|mosaic)\b/i.test(source),
    'the scorer appears to have gained a demographic input');
});

test('it does not fall over on rubbish', () => {
  /* It runs on every lead at the moment of capture, after the response has
     been promised. A throw here loses a lead that was already saved. */
  for (const input of [undefined, null, {}, { consent: null }, { glazing: 'nonsense' },
    { price: NaN }, { postcode: 12345 }, { project: [] }, { property: 'yes' },
    { detectionCount: 'nine' }, { selections: null }]) {
    const out = leadscore.score(input);
    assert.ok(Number.isFinite(out.score) && out.score >= 0 && out.score <= 100,
      `scored ${out.score} on ${JSON.stringify(input)}`);
  }
});

test('the payload says what the number is not', () => {
  /* There are no completed jobs to fit a model on. A score presented without
     that caveat gets read as a probability of conversion. */
  const out = leadscore.score(complete());
  assert.match(out.basis, /not a fitted conversion model/);
  assert.strictEqual(out.version, 1, 'the version travels with the score, so re-weighting cannot rewrite history');
});

test('the score is stored with the lead rather than recomputed on read', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /lead\.leadScore = leadscore\.score\(lead\)/,
    'the score should be part of the stored record');
  const scoreAt = server.indexOf('lead.leadScore = leadscore.score(lead)');
  const appendAt = server.indexOf("await store.append('leads', lead)");
  assert.ok(scoreAt > 0 && appendAt > scoreAt,
    'the lead should be scored before it is stored, not after');
});
