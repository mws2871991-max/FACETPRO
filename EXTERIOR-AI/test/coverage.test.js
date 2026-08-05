/* "Do you have installers near me?"

   Asked and answered before anyone is invited to hand over a photograph or a
   phone number. The postcode box in the refine panel used to collect a
   postcode and do nothing with it; now that routing decides who receives a
   lead, the site can answer honestly — including when the answer is no.

   Two things this must not do: promise coverage the delivery would not
   honour, and publish which companies buy leads where. So it runs the real
   routing, and it returns a count rather than names. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const {test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3081;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
/* One national buyer and one regional, which is the real shape: Anglian
   everywhere, Zenith across London, Hertfordshire, Essex and Kent. */
process.env.LEAD_RECIPIENTS = JSON.stringify([
  { id: 'national', name: 'National Co', url: 'https://n.test/h' },
  { id: 'regional', name: 'Regional Co', url: 'https://r.test/h',
    areas: ['E', 'EC', 'N', 'NW', 'SE', 'SW', 'W', 'WC', 'BR', 'CR', 'DA', 'EN', 'HA', 'IG',
            'KT', 'RM', 'SM', 'TW', 'UB', 'AL', 'SG', 'WD', 'HP', 'CM', 'CO', 'SS', 'CT', 'ME', 'TN'] },
]);
delete process.env.RESEND_API_KEY;

const realFetch = globalThis.fetch;
require('../server');

/* The server listens asynchronously. Against JSONL that is a tick; against
   Postgres it is a schema, and a fetch issued before the socket exists fails
   with "fetch failed". See test/helpers/server-ready.js. */
before(async () => { await require('./helpers/server-ready')(BASE); });

const check = async (postcode) => {
  const res = await realFetch(`${BASE}/api/coverage`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ postcode }),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

test('inside the regional buyer\'s patch, both cover it', async () => {
  for (const postcode of ['SW11 4NP', 'CM1 1AA', 'TN1 1AA', 'SG1 1AA']) {
    const { status, body } = await check(postcode);
    assert.strictEqual(status, 200, postcode);
    assert.strictEqual(body.installers, 2, `${postcode} should reach both buyers`);
  }
});

test('outside it, only the national buyer', async () => {
  for (const postcode of ['M1 1AE', 'EH1 1YZ', 'BS1 4DJ']) {
    const { body } = await check(postcode);
    assert.strictEqual(body.installers, 1, `${postcode} should reach one buyer`);
  }
});

test('it never names the buyers', async () => {
  /* Which companies buy leads in which areas is theirs. A homeowner is told
     exactly who received their details at the point that happens, which is
     the moment it matters. */
  const { body } = await check('SW11 4NP');
  const serialised = JSON.stringify(body);
  assert.ok(!/National Co|Regional Co|national|regional/.test(serialised), serialised);
  assert.deepStrictEqual(Object.keys(body).sort(), ['cap', 'installers', 'outward']);
});

test('it answers about the area, not the house', async () => {
  // The full postcode is not needed to answer this, and not kept.
  const { body } = await check('sw11 4np');
  assert.strictEqual(body.outward, 'SW11');
});

test('a postcode we cannot read is refused, not guessed at', async () => {
  for (const bad of ['banana', '', 'SW11', '12345', null]) {
    const { status, body } = await check(bad);
    assert.strictEqual(status, 400, JSON.stringify(bad));
    assert.strictEqual(body.reason, 'unreadable_postcode');
  }
});

test('it agrees with what delivery would actually do', async () => {
  /* The failure worth preventing: a page that says "2 installers cover you"
     and a delivery that reaches one. Both run routing.chooseRecipients with
     the same cap, so this asserts they cannot drift. */
  const routing = require('../routing');
  const recipients = JSON.parse(process.env.LEAD_RECIPIENTS)
    .map(r => ({ ...r, areas: routing.normaliseAreas(r.areas).areas }));
  for (const postcode of ['SW11 4NP', 'M1 1AE']) {
    const { body } = await check(postcode);
    const { chosen } = routing.chooseRecipients(recipients, { id: 'x', postcode }, { max: 3 });
    assert.strictEqual(body.installers, chosen.length, postcode);
  }
});
