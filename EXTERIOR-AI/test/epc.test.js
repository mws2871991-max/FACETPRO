/* EPC sizing (epc.js, routes/epc.js): off until switched on, sized from the
   certificate's own fields, never from an area the browser sends, and never
   touching the register's address fields. The register and the address
   lookup are stubbed; their shapes follow their published documentation. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');

const PORT = 3320;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const epc = require('../epc');
const measure = require('../measure');

/* A semi of 120 m² (bigger than the 97 m² survey mean), room height 2.5 m. */
const CERT = {
  data: {
    uprn: 999999999901, address_line_1: '1 Example Street', postcode: 'LS1 4AP',
    registration_date: '2022-03-01', total_floor_area: 120, built_form: 'Semi-Detached',
    property_type: 'House', floor_height: 2.5,
  },
};
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  const json = (status, body) => ({ ok: status < 400, status, json: async () => body });
  if (u.includes('api.get-energy-performance-data')) {
    calls.push({ u, auth: opts?.headers?.Authorization });
    if (u.includes('/api/domestic/search')) {
      if (u.includes('uprn=000000000404')) return json(200, { data: [] });
      return json(200, { data: [
        { certificateNumber: '0000-0000-0000-0000-0001', registrationDate: '2015-01-01' },
        { certificateNumber: '0000-0000-0000-0000-0002', registrationDate: '2022-03-01' },
      ] });
    }
    if (u.includes('/api/certificate')) {
      if (u.includes('0002')) return json(200, CERT);
      return json(200, { data: { ...CERT.data, total_floor_area: 60 } });   // the old one must not be used
    }
  }
  if (u.includes('api.ideal-postcodes.co.uk')) {
    return json(200, { result: [
      { line_1: '1 Example Street', post_town: 'Leeds', postcode: 'LS1 4AP', uprn: '999999999901' },
      { line_1: '3 Example Street', post_town: 'Leeds', postcode: 'LS1 4AP', uprn: '' },
    ] });
  }
  return realFetch(url, opts);
};

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const post = async (path, body) => {
  const r = await realFetch(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const get = async (path) => { const r = await realFetch(BASE + path); return { status: r.status, body: await r.json() }; };
const on = () => { process.env.EPC_SIZING = 'on'; process.env.EPC_TOKEN = 'test-token'; process.env.ADDRESS_LOOKUP_KEY = 'ak_test'; };
const off = () => { delete process.env.EPC_SIZING; delete process.env.EPC_TOKEN; delete process.env.ADDRESS_LOOKUP_KEY; };

test('switched off, nothing answers and the page is not told to offer it', async () => {
  off();
  assert.strictEqual((await get('/api/epc/addresses?postcode=LS14AP')).status, 404);
  assert.strictEqual((await post('/api/epc', { uprn: '999999999901' })).status, 404);
  assert.strictEqual((await get('/api/config')).body.epcSizing, false);
  process.env.EPC_SIZING = 'on';   // on, but no token or lookup key: still off
  assert.strictEqual((await get('/api/config')).body.epcSizing, false);
  off();
});

test('a house of the survey-mean floor area comes out at the surveyed average', () => {
  for (const [type, plan] of Object.entries(measure.PLAN_GEOMETRY)) {
    const cert = { floorAreaM2: plan.floorAreaM2, builtForm: type === 'bungalow' ? 'detached' : type, propertyKind: type === 'bungalow' ? 'bungalow' : 'house', floorHeightM: 2.4 };
    const r = epc.sizeFromEpc(cert);
    assert.ok(Math.abs(r.m2 - measure.HOUSE_TYPE_PRIORS[type].wallM2) <= 1, `${type}: ${r.m2}`);
    assert.ok(r.low < r.m2 && r.high > r.m2);
  }
});

test('more floor, more wall; taller rooms, more wall; flats are not sized', () => {
  const base = { floorAreaM2: 97, builtForm: 'semi', propertyKind: 'house', floorHeightM: 2.4 };
  const m = (c) => epc.sizeFromEpc({ ...base, ...c }).m2;
  assert.ok(m({ floorAreaM2: 140 }) > m({}));
  assert.ok(m({ floorHeightM: 2.8 }) > m({}));
  assert.ok(m({ builtForm: 'detached' }) > m({}), 'an extra exposed side');
  assert.strictEqual(epc.sizeFromEpc({ ...base, propertyKind: 'flat' }), null);
  assert.strictEqual(epc.sizeFromEpc({ ...base, builtForm: null }), null);
  assert.strictEqual(epc.sizeFromEpc({ ...base, floorAreaM2: null }), null);
});

test('a measured frontage narrows the range', () => {
  const c = { floorAreaM2: 97, builtForm: 'semi', propertyKind: 'house', floorHeightM: 2.4 };
  const typical = epc.sizeFromEpc(c), photo = epc.sizeFromEpc(c, { frontageM: 6.8 });
  assert.ok((photo.high - photo.low) < (typical.high - typical.low));
});

test('certificates are read whatever their layout', () => {
  const flat = epc.readCertificate({ total_floor_area: '88', built_form: 'Mid-Terrace', property_type: 'House', floor_height: '2.45' });
  assert.deepStrictEqual([flat.floorAreaM2, flat.builtForm, flat.propertyKind, flat.floorHeightM], [88, 'terrace', 'house', 2.45]);
  const upper = epc.readCertificate({ TOTAL_FLOOR_AREA: 150, BUILT_FORM: 'Detached', PROPERTY_TYPE: 'Bungalow' });
  assert.deepStrictEqual([upper.floorAreaM2, upper.builtForm, upper.propertyKind], [150, 'detached', 'bungalow']);
  const nested = epc.readCertificate({ property_summary: { total_floor_area: 101 }, dwelling: { built_form: 2, storeys: [{ floor_height: 2.4 }, { floor_height: 2.6 }] } });
  assert.deepStrictEqual([nested.floorAreaM2, nested.builtForm, nested.floorHeightM], [101, 'semi', 2.5]);
});

test('end to end: postcode, address, certificate, and the quote sized by it', async () => {
  on();
  try {
    assert.strictEqual((await get('/api/config')).body.epcSizing, true);
    const a = await get('/api/epc/addresses?postcode=LS1%204AP');
    assert.strictEqual(a.status, 200);
    assert.deepStrictEqual(a.body.addresses, [{ label: '1 Example Street, Leeds', uprn: '999999999901' }], 'an address without a UPRN cannot be sized, so it is not offered');

    calls.length = 0;
    const e = await post('/api/epc', { uprn: '999999999901' });
    assert.strictEqual(e.status, 200);
    assert.ok(e.body.epcId);
    assert.strictEqual(e.body.method, 'epc');
    assert.strictEqual(e.body.epc.floorAreaM2, 120, 'the newest certificate, not the 2015 one');
    assert.ok(calls.every(c => c.auth === 'Bearer test-token'));
    assert.ok(calls[0].u.includes('uprn=999999999901'));
    // Nothing from the register's address fields comes back or is kept.
    assert.ok(!JSON.stringify(e.body).includes('Example Street'));
    assert.ok(!JSON.stringify(e.body).includes('999999999901'));

    const q = await post('/api/quote', { claddingId: 'alabaster', trimId: 'none', roofId: 'none', epcId: e.body.epcId });
    assert.strictEqual(q.body.footprintSource, 'epc');
    assert.strictEqual(q.body.footprintM2, e.body.m2);

    // An id that was never issued is no different from none.
    const bogus = await post('/api/quote', { claddingId: 'alabaster', trimId: 'none', roofId: 'none', epcId: 'made-up', houseType: 'semi' });
    assert.notStrictEqual(bogus.body.footprintSource, 'epc');

    // A manual figure the visitor typed still comes first.
    const told = await post('/api/quote', { claddingId: 'alabaster', trimId: 'none', roofId: 'none', epcId: e.body.epcId, footprintM2: 100 });
    assert.strictEqual(told.body.footprintSource, 'manual_entry');
  } finally { off(); }
});

test('no certificate, a bad UPRN, a bad postcode: plain answers, photo estimate stands', async () => {
  on();
  try {
    const none = await post('/api/epc', { uprn: '404' });
    assert.strictEqual(none.status, 404);
    assert.match(none.body.error, /photo estimate still stands/);
    assert.strictEqual((await post('/api/epc', { uprn: 'abc' })).status, 400);
    assert.strictEqual((await get('/api/epc/addresses?postcode=nonsense')).status, 400);
  } finally { off(); }
});

test('switching it off again stops a live id being used', async () => {
  on();
  const e = await post('/api/epc', { uprn: '999999999901' });
  off();
  const q = await post('/api/quote', { claddingId: 'alabaster', trimId: 'none', roofId: 'none', epcId: e.body.epcId, houseType: 'semi' });
  assert.notStrictEqual(q.body.footprintSource, 'epc');
});
