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
  // The operator needs to be told what to do, not just what is wrong — and
  // told something that works. This used to require SITE_MODE=beta, which
  // pinned advice that had stopped having any effect.
  assert.match(out, /LEAD_CAPTURE=off/);
  assert.match(out, /DATABASE_URL/);
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

test('every remedy the refusal suggests actually lets it start', async () => {
  /* The refusal used to list `SITE_MODE=beta`, left over from when the guards
     keyed off the mode. Since they key off whether this is a deployment, that
     line did nothing: an operator would set it, redeploy, get the identical
     message and learn nothing. Wrong instructions in an error message are
     worse than none, so this reads the remedies out of the message itself and
     checks each one works. */
  const { out } = await run({ ...DEPLOYED, LEAD_CAPTURE: 'on' });
  // Only the ones stated as NAME=value can be checked mechanically; the
  // others (set DATABASE_URL) need something this test cannot conjure.
  const suggested = [...out.matchAll(/set ([A-Z_]+)=(\S+)/g)].map(m => [m[1], m[2]]);
  assert.ok(suggested.length >= 1, `no remedies found in:\n${out}`);

  for (const [name, value] of suggested) {
    if (name === 'DATABASE_URL') continue;   // needs a real database to prove
    const attempt = await run({ ...DEPLOYED, LEAD_CAPTURE: 'on', [name]: value });
    assert.notStrictEqual(attempt.code, 1,
      `the message tells you to set ${name}=${value}, and it still refuses`);
  }
});

/* ── the deployment configuration block ──

   From the August 2026 code audit: "create a production startup validation
   function that fails deployment if required live-mode variables are missing".

   It reports rather than refusing, and the test below is why. The first
   version did fail the deployment when INSTALLER_TOKEN_SECRET was missing,
   and immediately broke "the same deployment with lead capture off is fine" —
   correctly, because a missing token secret signs installers out while
   refusing to start denies every homeowner the site. Reporting is the
   proportionate half of that recommendation; the two refusals above are the
   cases where there is no safe half-measure. */

test('a deployment missing configuration says so, in one block, and still serves', async () => {
  const { code, out } = await run({
    ...DEPLOYED,
    LEAD_CAPTURE: 'off',
    INSTALLER_TOKEN_SECRET: '',
    INSTALLER_PASSWORD: '',
  });
  assert.strictEqual(code, 'started', `it must still serve homeowners:\n${out.slice(0, 400)}`);
  assert.match(out, /CONFIGURATION: \d+ thing\(s\) missing/,
    'one block, because a line lost among two hundred is a line nobody reads');
  assert.match(out, /INSTALLER_TOKEN_SECRET/);
  assert.match(out, /INSTALLER_PASSWORD/);
});

test('the configuration block never prints a value', async () => {
  /* These logs are readable by anyone with dashboard access. Naming what is
     missing is the whole job; echoing what is present is a leak. */
  const secret = 'sk-thismustneverappearinalog';
  const { out } = await run({
    ...DEPLOYED,
    LEAD_CAPTURE: 'off',
    INSTALLER_TOKEN_SECRET: secret,
    INSTALLER_PASSWORD: secret,
  });
  assert.ok(!out.includes(secret), 'a configured value reached the log');
  assert.match(out, /Config: deployment checks passed/);
});

test('nothing is reported on a laptop — the guard is about deployments', async () => {
  const { out } = await run({ LEAD_CAPTURE: 'off', INSTALLER_TOKEN_SECRET: '', INSTALLER_PASSWORD: '' });
  assert.ok(!/CONFIGURATION: /.test(out),
    'a developer with no platform secrets is not misconfigured');
});
