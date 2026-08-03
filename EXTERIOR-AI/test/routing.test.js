/* Which installers a lead goes to.

   The consent wording is the specification:

     "up to three vetted installers covering my area"

   Both halves were unenforced. Delivery posted every lead to every configured
   recipient — with three buyers that happens to be the same thing, which is
   exactly why it would have stayed unnoticed until a fourth was added or a
   regional buyer signed. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const { parsePostcode, normaliseAreas, covers, chooseRecipients } = require('../routing');
const { parseRecipients } = require('../delivery');

const R = (id, areas) => ({ id, name: id, url: `https://${id}.test/h`, areas: areas || [], headers: {} });

/* ── reading a postcode a person typed ── */

test('a postcode is read however it was typed', () => {
  for (const raw of ['SW11 4NP', 'sw114np', ' Sw11  4nP ', 'SW11-4NP']) {
    assert.deepStrictEqual(parsePostcode(raw), { outward: 'SW11', area: 'SW' }, raw);
  }
});

test('every outward-code shape is handled', () => {
  const cases = [['M1 1AE', 'M1', 'M'], ['B33 8TH', 'B33', 'B'], ['CR2 6XH', 'CR2', 'CR'],
                 ['DN55 1PT', 'DN55', 'DN'], ['EC1A 1BB', 'EC1A', 'EC'], ['W1A 0AX', 'W1A', 'W']];
  for (const [raw, outward, area] of cases) {
    assert.deepStrictEqual(parsePostcode(raw), { outward, area }, raw);
  }
});

test('rubbish is rejected rather than half-read', () => {
  for (const bad of ['', null, undefined, 'hello', 'SW11', '4NP', '12345', 'SW11 4N', 'SW11 44NP', 'ABCDEFG', 'SW1 1A']) {
    assert.strictEqual(parsePostcode(bad), null, JSON.stringify(bad));
  }
});

/* ── coverage ── */

test('an installer with no areas covers everywhere', () => {
  assert.strictEqual(covers(R('national'), parsePostcode('SW11 4NP')), true);
  assert.strictEqual(covers(R('national'), null), true, 'even with no postcode — nothing is being claimed');
});

test('an area covers its districts, a district covers only itself', () => {
  const wide = R('wide', ['SW']);
  const narrow = R('narrow', ['SW11']);
  assert.strictEqual(covers(wide, parsePostcode('SW11 4NP')), true);
  assert.strictEqual(covers(wide, parsePostcode('SW1A 1AA')), true);
  assert.strictEqual(covers(narrow, parsePostcode('SW11 4NP')), true);
  assert.strictEqual(covers(narrow, parsePostcode('SW1A 1AA')), false, 'SW1A is not inside SW11');
});

test('SW1 and SW11 are different places', () => {
  // A prefix match would put them in the same one. They are miles apart.
  assert.strictEqual(covers(R('x', ['SW1']), parsePostcode('SW11 4NP')), false);
  assert.strictEqual(covers(R('x', ['SW11']), parsePostcode('SW1A 1AA')), false);
});

test('an area-restricted installer is not eligible without a postcode', () => {
  assert.strictEqual(covers(R('regional', ['SW']), null), false,
    'we cannot promise they cover an area we were never told');
});

test('areas are normalised, and nonsense is reported not guessed at', () => {
  assert.deepStrictEqual(normaliseAreas(['sw11', ' M ', 'po3']).areas, ['SW11', 'M', 'PO3']);
  const { areas, bad } = normaliseAreas(['SW', 'Greater London', '', 'SW1234']);
  assert.deepStrictEqual(areas, ['SW']);
  assert.deepStrictEqual(bad, ['Greater London', '', 'SW1234']);
  assert.deepStrictEqual(normaliseAreas(undefined), { areas: [], bad: [] });
});

test('the configuration accepts areas and complains about the rest', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'anglian', url: 'https://a.test/h' },
    { id: 'zenith', url: 'https://z.test/h', areas: ['sw11', 'M'] },
    { id: 'muddled', url: 'https://m.test/h', areas: ['the south east'] },
  ]));
  assert.deepStrictEqual(recipients[0].areas, [], 'no areas means national');
  assert.deepStrictEqual(recipients[1].areas, ['SW11', 'M']);
  assert.strictEqual(recipients.length, 3, 'a bad area is reported, not a reason to drop the buyer');
  assert.match(problems[0], /muddled.*the south east/i);
});

/* ── choosing ── */

test('only installers covering the area get it', () => {
  const { chosen, routing } = chooseRecipients(
    [R('national'), R('london', ['SW', 'SE']), R('manchester', ['M'])],
    { id: 'LD-1', postcode: 'SW11 4NP' });
  assert.deepStrictEqual(chosen.map(r => r.id), ['national', 'london']);
  assert.strictEqual(routing.outward, 'SW11');
  assert.deepStrictEqual(routing.skipped.map(s => s.id), ['manchester']);
  assert.match(routing.skipped[0].reason, /does not cover/);
});

test('no usable postcode leaves only the national buyers', () => {
  const { chosen, routing } = chooseRecipients(
    [R('national'), R('london', ['SW'])], { id: 'LD-1', postcode: '' });
  assert.deepStrictEqual(chosen.map(r => r.id), ['national']);
  assert.strictEqual(routing.postcodeUsable, false);
  assert.match(routing.skipped[0].reason, /no usable postcode/);
});

test('nobody eligible means nobody gets it', () => {
  const { chosen, routing } = chooseRecipients([R('london', ['SW'])], { id: 'LD-1', postcode: 'M1 1AE' });
  assert.deepStrictEqual(chosen, []);
  assert.deepStrictEqual(routing.eligible, []);
});

test('the cap is honoured — three means three', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => R(id));
  const { chosen, routing } = chooseRecipients(many, { id: 'LD-1', postcode: 'SW11 4NP' }, { max: 3 });
  assert.strictEqual(chosen.length, 3);
  assert.strictEqual(routing.eligible.length, 5);
  assert.strictEqual(routing.skipped.length, 2);
  assert.ok(routing.skipped.every(s => /over the cap of 3/.test(s.reason)));
});

test('under the cap, everyone eligible gets it', () => {
  const { chosen } = chooseRecipients([R('a'), R('b')], { id: 'LD-1', postcode: 'SW11 4NP' }, { max: 3 });
  assert.strictEqual(chosen.length, 2, 'the cap is a ceiling, not a quota');
});

test('the same lead always routes the same way', () => {
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => R(id));
  const once = chooseRecipients(many, { id: 'LD-4821', postcode: 'SW11 4NP' }, { max: 3 });
  const twice = chooseRecipients(many, { id: 'LD-4821', postcode: 'SW11 4NP' }, { max: 3 });
  assert.deepStrictEqual(once.routing.chosen, twice.routing.chosen,
    'a delivery log you cannot reproduce is not evidence of anything');
});

test('over the cap, the work is spread rather than given to whoever is listed first', () => {
  // Order in the configuration would starve the last buyer completely. At £100
  // a lead that is somebody's revenue, so it rotates on the lead id.
  const many = ['a', 'b', 'c', 'd', 'e'].map(id => R(id));
  const counts = Object.fromEntries(many.map(r => [r.id, 0]));
  for (let i = 0; i < 500; i++) {
    for (const r of chooseRecipients(many, { id: `LD-${i}`, postcode: 'SW11 4NP' }, { max: 3 }).chosen) counts[r.id]++;
  }
  const share = Object.values(counts);
  const expected = 500 * 3 / 5;
  assert.ok(Math.min(...share) > expected * 0.8 && Math.max(...share) < expected * 1.2,
    `uneven split: ${JSON.stringify(counts)}`);
});

test('a cap of zero sends to nobody', () => {
  // The switch for "stop sharing entirely" without unconfiguring the buyers.
  // Reading zero as "no limit" would make the setting someone reaches for to
  // stop sharing the one that shares with everybody.
  const { chosen, routing } = chooseRecipients([R('a'), R('b')], { id: 'LD-1', postcode: 'SW11 4NP' }, { max: 0 });
  assert.deepStrictEqual(chosen, []);
  assert.strictEqual(routing.skipped.length, 2);
  assert.match(routing.skipped[0].reason, /switched off/);
});

test('no recipients at all is not a crash', () => {
  const { chosen, routing } = chooseRecipients([], { id: 'LD-1', postcode: 'SW11 4NP' });
  assert.deepStrictEqual(chosen, []);
  assert.deepStrictEqual(routing.skipped, []);
});

/* ── who does what ──

   Postcode was only half the question. The two installers with signed
   per-lead contracts buy windows and doors; render, roofline and roof go to
   different contractors. One flat list meant everybody got everything — so a
   homeowner who priced their whole exterior generated a lead only the window
   firms ever saw, and the render contractors never heard about work they
   would have paid for. */

const T = (id, trades, areas) => ({ id, name: id, url: `https://${id}.test/h`, trades: trades || [], areas: areas || [], headers: {} });
const FLEET = [
  T('anglian', ['windows', 'doors']),
  T('zenith', ['windows', 'doors'], ['SW']),
  T('render-co', ['cladding', 'roofline']),
  T('roofer', ['roof']),
];
const windowsLead = { id: 'LD-W', postcode: 'SW11 4NP', glazing: { price: { total: 9000 } } };
const wholeLead = { ...windowsLead, id: 'LD-A', selections: { cladding: 'Sage Slate', roof: 'Terracotta', trim: 'Cedar' } };

test('a windows lead does not go to the render contractor', () => {
  const { chosen, routing } = chooseRecipients(FLEET, windowsLead, { max: 3 });
  assert.deepStrictEqual(chosen.map(r => r.id).sort(), ['anglian', 'zenith']);
  assert.deepStrictEqual(routing.trades.sort(), ['doors', 'windows']);
  assert.match(routing.skipped.find(s => s.id === 'render-co').reason, /does not do/);
});

test('a render lead reaches the render contractor, which it never used to', () => {
  const { chosen } = chooseRecipients(FLEET, { id: 'LD-R', postcode: 'M1 1AE', selections: { cladding: 'Sage Slate' } }, { max: 3 });
  assert.deepStrictEqual(chosen.map(r => r.id), ['render-co']);
});

test('a whole-exterior lead covers trades before doubling up on one', () => {
  /* Three installers in total, not three per trade — the consent says "up to
     three vetted installers", and three window firms plus three render firms
     would be six companies holding somebody's details on a permission for
     three. So a render contractor beats a second window firm, because the
     second window firm adds a quote the homeowner already has. */
  const { chosen } = chooseRecipients(FLEET, wholeLead, { max: 3 });
  assert.strictEqual(chosen.length, 3, 'the cap is still three companies');
  assert.ok(chosen.some(r => r.id === 'render-co'), 'the render trade should be covered');
  assert.ok(chosen.filter(r => r.trades.includes('windows')).length <= 2);
});

test('the log says whether a trade was covered or squeezed out', () => {
  // Different facts, and the delivery log is what somebody reads when a
  // contractor asks why they never saw a job.
  const { routing } = chooseRecipients(FLEET, wholeLead, { max: 3 });
  const roofer = routing.skipped.find(s => s.id === 'roofer');
  assert.match(roofer.reason, /nobody is covering roof/);
});

test('a recipient with no trades listed still gets everything', () => {
  // Backwards compatible: every recipient configured before this existed.
  const legacy = [T('everything'), T('windows-only', ['windows'])];
  const { chosen } = chooseRecipients(legacy, { id: 'LD-C', postcode: 'SW11 4NP', selections: { cladding: 'X' } }, { max: 3 });
  assert.deepStrictEqual(chosen.map(r => r.id), ['everything']);
});

test('a lead that chose nothing in particular goes to everyone eligible', () => {
  // Somebody who saved a design without picking much. Guessing a trade would
  // be worse than sharing it.
  const { chosen } = chooseRecipients(FLEET, { id: 'LD-N', postcode: 'SW11 4NP' }, { max: 9 });
  assert.strictEqual(chosen.length, 4);
});

test('trades are read from what they chose, never from the request', () => {
  const { tradesIn } = require('../routing');
  assert.deepStrictEqual(tradesIn({ selections: { cladding: 'X' } }), ['cladding']);
  assert.deepStrictEqual(tradesIn({ conservatory: { id: 'lean-to' } }), ['conservatory']);
  assert.deepStrictEqual(tradesIn({}), []);
});

test('an unrecognised trade is reported, not silently ignored', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'oops', url: 'https://o.test/h', trades: ['guttering'] },
  ]));
  assert.deepStrictEqual(recipients[0].trades, [], 'nothing recognised means all trades');
  assert.match(problems[0], /unrecognised trades: guttering/);
});
