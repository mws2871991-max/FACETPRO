/* Who is allowed to answer for the database.

   Railway issues every Postgres the same certificate — CN=localhost, with
   localhost as its only subject alternative name — signed by a self-signed
   root-ca. We reach it over the project's private network, as
   postgres.railway.internal, so the name in the certificate can never match
   the name we dialled and ordinary verification fails on the hostname check.

   The usual escape is `rejectUnauthorized: false`, which switches off chain,
   signature and name together and leaves an encrypted pipe to whoever
   answered. That is what used to be in store.js, a reviewer was right to call
   it out, and it carries every homeowner's name, email, phone number and
   postcode.

   What replaced it waives the hostname check and nothing else — on the private
   network, for that exact CN, and only when a CA has been supplied to check
   the chain against. This file is the boundary of that exception. Every test
   below is a way somebody might try to widen it. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const { checkServerIdentity } = require('../store')._internals;

const CA = '-----BEGIN CERTIFICATE-----\nnot a real certificate, only a marker that one was supplied\n-----END CERTIFICATE-----';
const localhostCert = { subject: { CN: 'localhost' }, subjectaltname: 'DNS:localhost' };

/* undefined means "accept". Returning an Error is a rejection, and so is
   throwing one — Node's TLS stack fails the handshake either way, and a
   malformed certificate makes the underlying check throw rather than return. */
const accepted = (...args) => {
  try { return checkServerIdentity(...args) === undefined; }
  catch (_) { return false; }
};

test('the pinned private host is accepted', () => {
  assert.ok(accepted(CA, 'postgres.railway.internal', localhostCert));
});

test('without a pinned CA there is no exception at all', () => {
  /* The waiver is only defensible because the chain is still checked against
     a CA we supplied. With no CA, this is the plain "trust anyone" case. */
  for (const ca of [undefined, null, '']) {
    assert.ok(!accepted(ca, 'postgres.railway.internal', localhostCert),
      'the hostname check was waived with no CA pinned to check the chain against');
  }
});

test('the public proxy host gets ordinary verification', () => {
  /* The same database is reachable at a public hostname. That route crosses
     the internet, so it gets no exception — if somebody switches DATABASE_URL
     to the public URL, this must start failing rather than quietly passing. */
  assert.ok(!accepted(CA, 'tokaido.proxy.rlwy.net', localhostCert));
});

test('a lookalike hostname does not slip through', () => {
  for (const host of [
    'railway.internal.example.com',
    'postgres.railway.internal.evil.net',
    'notrailway.internal',            // endsWith would pass on a bare suffix
    'postgres.railway.internal.',     // trailing dot
    'POSTGRES.RAILWAY.INTERNAL',      // case
  ]) {
    assert.ok(!accepted(CA, host, localhostCert), `${host} was accepted`);
  }
});

test('any other subject on the private host is rejected', () => {
  /* The exception is for the certificate Railway actually issues. A different
     CN signed by the same CA is a different machine. */
  for (const cn of ['evil', 'postgres', 'localhost.evil.com', '', undefined]) {
    assert.ok(!accepted(CA, 'postgres.railway.internal', { subject: { CN: cn } }),
      `CN=${JSON.stringify(cn)} was accepted on the private host`);
  }
  assert.ok(!accepted(CA, 'postgres.railway.internal', {}), 'a certificate with no subject was accepted');
  assert.ok(!accepted(CA, 'postgres.railway.internal', null), 'a missing certificate was accepted');
});

test('verification is never simply switched off', () => {
  /* The specific line that used to be here. If it comes back, so does the
     problem, and it will come back the next time a connection is refused and
     somebody is in a hurry. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  /* Comments stripped first — the explanation of why it was removed names the
     thing it removed, and matching that would make this permanently red. */
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.ok(!/rejectUnauthorized:\s*false/.test(code),
    'rejectUnauthorized: false is back in store.js');
  assert.match(src, /rejectUnauthorized:\s*true/,
    'the database connection must verify the certificate');
});
