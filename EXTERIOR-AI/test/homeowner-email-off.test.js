/* What happens when we cannot email the homeowner.

   The withdrawal link only exists in an email. So if we cannot send email, we
   cannot honour Article 7(3) for anyone who asks for installer quotes — and
   the notice promises "the link in any email from us". Accepting that consent
   anyway would mean passing someone's details to three companies while
   leaving them no way to stop it.

   So the consent is refused rather than taken quietly, and the box is not
   shown. Same instinct as refusing to start live without a database: do not
   accept a promise you cannot keep.

   These configurations are decided when the module loads, so each one gets
   its own process. */

'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');

const boot = (port, env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(port), LEAD_CAPTURE: 'on', DATABASE_URL: '',
           LEAD_RECIPIENTS: JSON.stringify([{ id: 'a', name: 'Anglian', url: 'https://a.test/h' }]), ...env },
  });
  let out = '';
  // The startup banner keeps arriving after the port opens, so hand back a
  // reader rather than a snapshot taken at the moment it was ready.
  const read = (b) => { out += b; if (/running on http/.test(out)) resolve({ child, log: () => out }); };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  child.on('exit', () => reject(new Error('server exited before it was ready:\n' + out)));
  setTimeout(() => reject(new Error('server never started:\n' + out)), 10000).unref();
});

const saveWith = (port, consent) => fetch(`http://127.0.0.1:${port}/api/lead`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Jane', email: 'jane@example.com', postcode: 'SW11 4NP',
    claddingId: 'sage-slate', footprintM2: 100,
    consent: { terms: true, version: 'test', ...consent },
  }),
});

test('with no email configured, installer-quotes consent is refused', async (t) => {
  const port = 3087;
  const { child, log } = await boot(port, { RESEND_API_KEY: '' });
  t.after(() => child.kill('SIGKILL'));

  await new Promise(r => setTimeout(r, 200));   // let the startup banner finish
  assert.match(log(), /Installer quotes: UNAVAILABLE/, 'the operator has to be told at startup');

  const res = await saveWith(port, { installerQuotes: true, emailPack: false });
  const body = await res.json();
  assert.strictEqual(res.status, 503, 'accepting this would share their details with no way back');
  assert.strictEqual(body.reason, 'withdrawal_link_undeliverable');
  assert.match(body.error, /untick/i, 'and tell them what to do about it');

  // The design itself still saves — refusing one consent must not break the
  // rest of the product.
  const ok = await saveWith(port, { installerQuotes: false, emailPack: false });
  assert.strictEqual(ok.status, 200);

  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  assert.strictEqual(cfg.installerQuotes, false, 'the form must not show a box that will be refused');
});

test('switching the design pack off does not switch withdrawal off with it', async (t) => {
  /* These used to be one flag. DESIGN_PACK_EMAIL=off meant no email at all,
     which silently meant no withdrawal link for anyone — including people
     whose details had just gone to three installers. */
  const port = 3088;
  const { child } = await boot(port, {
    RESEND_API_KEY: 'test-key-not-real', LEAD_FROM_EMAIL: 'hello@facetpro.co.uk', DESIGN_PACK_EMAIL: 'off',
  });
  t.after(() => child.kill('SIGKILL'));

  const cfg = await (await fetch(`http://127.0.0.1:${port}/api/config`)).json();
  assert.strictEqual(cfg.designPackEmail, false, 'the pack is off, as asked');
  assert.strictEqual(cfg.installerQuotes, true, 'but we can still reach them, so the consent stands');
});
