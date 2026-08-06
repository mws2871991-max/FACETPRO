/* Accounts, one per installer.

   There was one INSTALLER_PASSWORD shared by everybody and one view of every
   consented lead, while legal/privacy.html told homeowners that installers
   have individual accounts and see only their own enquiries. Neither was
   true; the notice has since been corrected to describe what the system does,
   and this is the work that lets the stronger wording go back.

   Two things are being protected. That a credential is expensive to guess and
   never stored in a form anybody can read back. And that an installer signed
   in as themselves cannot see another installer's leads — which is a
   disclosure of personal data to a party the homeowner did not consent to, not
   a permissions bug. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');

const PORT = 3108;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = 'test-token-secret';

const I = require('../installers');
const { parseRecipients } = require('../delivery');

/* ── passwords ── */

test('a password verifies against its own hash and nothing else', () => {
  const h = I.makePasswordHash('correct horse battery staple');
  assert.ok(I.verifyPassword('correct horse battery staple', h));
  assert.ok(!I.verifyPassword('correct horse battery stapl', h), 'a near miss was accepted');
  assert.ok(!I.verifyPassword('', h));
});

test('two installers with the same password get different hashes', () => {
  /* Salted, so the environment variable cannot show that two installers chose
     the same password — and a rainbow table is no use against either. */
  const a = I.makePasswordHash('same password');
  const b = I.makePasswordHash('same password');
  assert.notStrictEqual(a, b);
  assert.ok(I.verifyPassword('same password', a) && I.verifyPassword('same password', b));
});

test('a malformed or absent hash refuses rather than throws', () => {
  for (const bad of ['', null, undefined, 'notahash', 'scrypt$onlytwo', 'md5$x$y']) {
    assert.strictEqual(I.verifyPassword('anything', bad), false, `accepted against: ${bad}`);
  }
});

/* ── tokens ── */

test('a token round-trips and names the installer who holds it', () => {
  const t = I.issueToken('anglian', SECRET);
  assert.strictEqual(I.readToken(t, SECRET).id, 'anglian');
});

test('a token signed with another secret is refused', () => {
  const t = I.issueToken('anglian', SECRET);
  assert.strictEqual(I.readToken(t, 'a different secret'), null);
});

test('an expired token is refused', () => {
  const t = I.issueToken('anglian', SECRET, { ttlMs: 1000, now: Date.now() - 60_000 });
  assert.strictEqual(I.readToken(t, SECRET), null, 'an hour-old one-second token still worked');
});

test('a tampered token is refused', () => {
  /* The installer id is in the signed body, so editing it to somebody else's
     has to break the signature. This is the whole security of the scheme. */
  const t = I.issueToken('zenith', SECRET);
  const [body, sig] = t.split('.');
  const forged = Buffer.from(Buffer.from(body, 'base64url').toString('utf8').replace('zenith', 'anglian')).toString('base64url');
  assert.strictEqual(I.readToken(`${forged}.${sig}`, SECRET), null, 'an installer could rename themselves');
});

test('rubbish in the token position is refused rather than crashing', () => {
  for (const bad of ['', 'x', 'a.b', null, undefined, 'not.base64url.at.all']) {
    assert.strictEqual(I.readToken(bad, SECRET), null);
  }
});

/* ── configuration ── */

test('a plaintext password in the config is refused and said out loud', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'oops', url: 'https://o.test/h', password: 'in the clear' },
  ]));
  assert.strictEqual(recipients[0].passwordHash, null, 'a plaintext password became an account');
  assert.match(problems.join(' '), /plaintext/, 'nothing was said about it');
});

test('a recipient with no account is allowed — not every recipient is a person', () => {
  const { recipients, problems } = parseRecipients(JSON.stringify([
    { id: 'crm', url: 'https://c.test/h' },
  ]));
  assert.strictEqual(recipients[0].passwordHash, null);
  assert.strictEqual(problems.length, 0);
});

test('verification evidence is stored, and a lapsed insurance is visible', () => {
  /* legal/terms.html has a placeholder asking us to list the checks we make.
     These are the fields that answer it, and storing the expiry means the
     answer can go stale loudly rather than quietly. */
  const { recipients } = parseRecipients(JSON.stringify([
    { id: 'a', url: 'https://a.test/h', companyNumber: '01234567', insuranceProvider: 'Aviva',
      insuranceExpiresOn: '2020-01-01', tradeBody: 'TrustMark', parentCompany: 'Group plc' },
  ]));
  const v = recipients[0].verification;
  assert.strictEqual(v.verified, true);
  assert.strictEqual(v.fields.companyNumber, '01234567');
  assert.strictEqual(v.fields.parentCompany, 'Group plc',
    'parentCompany was dropped — a cap of three means nothing if two are one group');
  assert.strictEqual(v.insuranceExpired, true, 'an expired policy was not flagged');
});

/* ── the endpoint ── */

const HASH = I.makePasswordHash('anglian-password-1234');
process.env.PORT = String(PORT);
process.env.INSTALLER_TOKEN_SECRET = SECRET;
process.env.INSTALLER_PASSWORD = 'shared-legacy-password';
process.env.LEAD_RECIPIENTS = JSON.stringify([
  { id: 'anglian', name: 'Anglian', url: 'https://a.test/h', leadPrice: 130, passwordHash: HASH },
  { id: 'zenith', name: 'Zenith', url: 'https://z.test/h', leadPrice: 100 },
]);

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const login = (body) => fetch(`${BASE}/api/installer/login`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('signing in with the right password returns a token', async () => {
  const res = await login({ id: 'anglian', password: 'anglian-password-1234' });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.ok(body.token, 'no token issued');
  assert.strictEqual(I.readToken(body.token, SECRET).id, 'anglian');
  assert.ok(!JSON.stringify(body).includes('anglian-password-1234'), 'the password came back in the response');
});

test('a wrong password, and an installer who has no account, are refused alike', async () => {
  assert.strictEqual((await login({ id: 'anglian', password: 'wrong' })).status, 401);
  assert.strictEqual((await login({ id: 'zenith', password: 'anything' })).status, 401,
    'an installer with no passwordHash was let in');
  assert.strictEqual((await login({ id: 'nobody', password: 'x' })).status, 401);
});

test('the leads endpoint refuses an unsigned request', async () => {
  assert.strictEqual((await fetch(`${BASE}/api/leads`)).status, 401);
});

test('a token gets in, and the response says whose view it is', async () => {
  const { token } = await (await login({ id: 'anglian', password: 'anglian-password-1234' })).json();
  const res = await fetch(`${BASE}/api/leads`, { headers: { authorization: `Bearer ${token}` } });
  assert.strictEqual(res.status, 200);
  const body = await res.json();
  assert.strictEqual(body.scope, 'installer');
  assert.strictEqual(body.installer, 'anglian');
});

test('the shared password still works, and is honest that it sees everything', async () => {
  /* Kept so a deployment configured before accounts existed keeps working.
     It is not pretended to be one installer. */
  const res = await fetch(`${BASE}/api/leads`, { headers: { authorization: 'Bearer shared-legacy-password' } });
  assert.strictEqual(res.status, 200);
  assert.strictEqual((await res.json()).scope, 'all');
});

test('one installer cannot see another installer\'s leads', async () => {
  /* The assertion this whole file exists for. Showing installer A a lead that
     went to installer B is a disclosure of a homeowner's name, email, phone
     and postcode to a company they never consented to — not a permissions
     bug, a data breach.

     Both leads consented to installer contact, so the only thing separating
     them is who the delivery log says received each one. */
  const store = require('../store');
  await store.replaceAll('leads', [
    { id: 'LD-FORANGLIAN', ts: new Date().toISOString(), name: 'A', email: 'a@example.com',
      consent: { terms: true, installerQuotes: true } },
    { id: 'LD-FORZENITH', ts: new Date().toISOString(), name: 'Z', email: 'z@example.com',
      consent: { terms: true, installerQuotes: true } },
  ]);
  await store.replaceAll('deliveries', [
    { ts: new Date().toISOString(), leadId: 'LD-FORANGLIAN', results: [{ id: 'anglian', ok: true }] },
    { ts: new Date().toISOString(), leadId: 'LD-FORZENITH', results: [{ id: 'zenith', ok: true }] },
  ]);

  const { token } = await (await login({ id: 'anglian', password: 'anglian-password-1234' })).json();
  const { leads } = await (await fetch(`${BASE}/api/leads`, { headers: { authorization: `Bearer ${token}` } })).json();

  const ids = leads.map(l => l.id);
  assert.ok(ids.includes('LD-FORANGLIAN'), 'an installer could not see their own lead');
  assert.ok(!ids.includes('LD-FORZENITH'), 'an installer could see a lead delivered to somebody else');
});

test('a failed delivery does not entitle an installer to the lead', async () => {
  /* They were never sent it. A delivery that errored is not a disclosure that
     happened, and it is not one they paid for either. */
  const store = require('../store');
  await store.replaceAll('leads', [
    { id: 'LD-FAILED', ts: new Date().toISOString(), name: 'F', email: 'f@example.com',
      consent: { terms: true, installerQuotes: true } },
  ]);
  await store.replaceAll('deliveries', [
    { ts: new Date().toISOString(), leadId: 'LD-FAILED', results: [{ id: 'anglian', ok: false, status: 500 }] },
  ]);
  const { token } = await (await login({ id: 'anglian', password: 'anglian-password-1234' })).json();
  const { leads } = await (await fetch(`${BASE}/api/leads`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.ok(!leads.some(l => l.id === 'LD-FAILED'), 'a lead that never arrived was shown anyway');
});
