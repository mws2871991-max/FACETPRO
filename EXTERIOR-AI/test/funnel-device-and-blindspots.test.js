/* The four things the 20 September journey walk could not answer.

   Walking the post-upload journey on a phone raised seven questions. Three of
   them had no data behind them at all:

     - the resume code is the only save that works while lead capture is off,
       and design_saved fires on lead submission, so nothing recorded it
     - cross-selling has no "add another trade" control, so a second trade
       arrives by swatch and was never counted as a decision
     - the window count corrector is the page's own answer to a wrong count,
       and how often it is taken says whether the count is believed

   And none of the seven could be split by device, on a journey made of
   photograph, upload, image and pricing choices.

   This covers the recording side: the stages exist, they are accepted, the
   device key is allowlisted and reported, and a client cannot write anything
   else into the counter table. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const store = require('../store');

const PORT = 3137;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'the-installer-password';

const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const post = (body) => realFetch(`${BASE}/api/funnel`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const counts = () => store.readFunnel(30);
const settle = () => new Promise(r => setTimeout(r, 150));   // the write follows the 204

test('the three blind-spot stages are accepted and counted', async () => {
  for (const stage of ['code_saved', 'trade_added', 'count_corrected']) {
    const res = await post({ stage });
    assert.strictEqual(res.status, 204, `${stage} was refused by the allowlist`);
  }
  await settle();
  const c = await counts();
  for (const stage of ['code_saved', 'trade_added', 'count_corrected']) {
    assert.ok((c[stage] || 0) >= 1, `${stage} was accepted and then not recorded`);
  }
});

test('each of them is reported against a step it can honestly be compared with', async () => {
  const res = await realFetch(`${BASE}/api/funnel`, { headers: { Authorization: 'Bearer the-installer-password' } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  const byStage = Object.fromEntries(body.branches.map(b => [b.stage, b]));

  /* Not inside the funnel chain: /api/funnel divides every step by the one
     before, so a branch in the sequence would hand its own small count to the
     next real step as a denominator. */
  assert.ok(!body.funnel.some(r => r.stage === 'code_saved'),
    'a branch stage has been put in the main chain, which breaks every conversion below it');

  assert.strictEqual(byStage.code_saved?.of, 'visualisation_started');
  assert.strictEqual(byStage.trade_added?.of, 'estimate_viewed');
  assert.strictEqual(byStage.count_corrected?.of, 'upload_completed');
});

test('a stage can be split by device', async () => {
  const c0 = await counts();
  const before = Number(c0['device/mobile:landing'] || 0);

  await post({ stage: 'landing', device: 'mobile' });
  await settle();

  const c1 = await counts();
  assert.strictEqual(Number(c1['device/mobile:landing'] || 0), before + 1);
  /* The untagged total still counts everybody — the device key is a second
     counter, not a filter on the first. */
  assert.strictEqual(Number(c1.landing || 0), Number(c0.landing || 0) + 1);
});

test('and only by a device it recognises', async () => {
  const before = await counts();
  await post({ stage: 'landing', device: 'iphone; drop table funnel' });
  await settle();
  const after = await counts();

  const junk = Object.keys(after).filter(k => /drop table|iphone/i.test(k));
  assert.deepStrictEqual(junk, [],
    'an unrecognised device was written into the counter table, which turns a tally into free-text storage');
  /* The stage itself is still counted: an odd device is not a reason to lose
     the visit. */
  assert.strictEqual(Number(after.landing || 0), Number(before.landing || 0) + 1);
});

test('the operator view reports the device split beside the journey one', async () => {
  await post({ stage: 'upload_completed', device: 'desktop' });
  await settle();
  const res = await realFetch(`${BASE}/api/funnel`, { headers: { Authorization: 'Bearer the-installer-password' } });
  const body = await res.json();

  assert.ok(body.byDevice, 'byDevice is missing entirely');
  assert.ok(body.byDevice.desktop, 'a device with traffic is not reported');
  const row = body.byDevice.desktop.find(r => r.stage === 'upload_completed');
  assert.ok(row && row.count >= 1);
  /* Same shape as byJourney, so the two can be read side by side. */
  assert.deepStrictEqual(Object.keys(row).sort(), ['count', 'ofPreviousPct', 'stage']);
});
