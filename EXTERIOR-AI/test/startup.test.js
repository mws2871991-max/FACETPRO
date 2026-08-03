/* Refusing to start.

   Without DATABASE_URL, leads land in plain JSONL files on the container:
   unencrypted, and gone on the next deploy unless a volume is mounted. The
   privacy notice tells people their enquiry is stored encrypted and backed up.

   A startup warning does not stop a deployment, and nobody reads a warning in
   a log they only open once something has already gone wrong. So a live
   deployment that is taking personal data and cannot store it as promised has
   to be a failure rather than a caution. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('path');

/* Started for real, in its own process — the refusal is a process.exit, which
   cannot be tested any other way. A server that does start is killed as soon
   as it says so, rather than waiting out a timeout. */
const run = (env) => new Promise((resolve) => {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, DATABASE_URL: '', PORT: '3098', ...env },
  });
  let out = '';
  const settle = (code) => resolve({ code, out });
  const read = (buf) => {
    out += buf;
    if (/running on http/.test(out)) { child.kill('SIGKILL'); settle('started'); }
  };
  child.stdout.on('data', read);
  child.stderr.on('data', read);
  child.on('exit', (code) => settle(code));
  setTimeout(() => { child.kill('SIGKILL'); settle('timed out'); }, 10000).unref();
});

/* What tells the server it is deployed rather than on somebody's laptop. The
   platform sets one of these; the guards key off that rather than off
   SITE_MODE, because what actually went wrong went wrong in beta. */
const DEPLOYED = { RAILWAY_ENVIRONMENT: 'production' };

test('a deployment taking leads with nowhere safe to put them refuses to start', async () => {
  const { code, out } = await run({ ...DEPLOYED, SITE_MODE: 'live', LEAD_CAPTURE: 'on' });
  assert.strictEqual(code, 1, 'must exit non-zero so the platform reports a failed deploy');
  assert.match(out, /REFUSING TO START/);
  assert.match(out, /DATABASE_URL/);
  // The operator needs to be told what to do, not just what is wrong.
  assert.match(out, /LEAD_CAPTURE=off/);
  assert.match(out, /SITE_MODE=beta/);
});

test('the same deployment with lead capture off is fine — no personal data is handled', async () => {
  const { code, out } = await run({ ...DEPLOYED, SITE_MODE: 'live', LEAD_CAPTURE: 'off' });
  assert.notStrictEqual(code, 1, out.slice(0, 400));
});

test('beta is not an excuse — the guard covers every mode', async () => {
  /* This is where it actually went wrong. The live Railway service was in
     beta with LEAD_CAPTURE unset, so a public URL took names, emails and
     postcodes behind a notice full of placeholders, into storage a deploy
     erases. The guards only fired under SITE_MODE=live, and beta is exactly
     the mode a site is in while it is unfinished and pointed at a real
     address. */
  const { code, out } = await run({ ...DEPLOYED, SITE_MODE: 'beta', LEAD_CAPTURE: 'on' });
  assert.strictEqual(code, 1, out.slice(0, 400));
  assert.match(out, /REFUSING TO START/);
});

test('but a laptop is warned, not stopped', async () => {
  /* A guard that stops people working gets switched off, and then it is not
     a guard. No platform variable means nobody but the developer can reach
     this, so it says what it would refuse and carries on. */
  const { code, out } = await run({ SITE_MODE: 'beta', LEAD_CAPTURE: 'on' });
  assert.notStrictEqual(code, 1, out.slice(0, 300));
  assert.match(out, /fine locally, refused on a deployment/);
});

test('and the default is off, so nobody has to remember', async () => {
  /* It defaulted to on. Nobody set it wrongly on the live service — nobody
     set it at all, and the default decided. A lost lead costs a hundred
     pounds and you find out; quietly collecting personal data you cannot
     lawfully explain is not recoverable. */
  const { code, out } = await run({ ...DEPLOYED, SITE_MODE: 'beta', LEAD_CAPTURE: '' });
  assert.notStrictEqual(code, 1, 'unset must be safe, not refused: ' + out.slice(0, 200));
  assert.match(out, /running on http/);
});
