/* How a tool on a laptop connects to the database over TLS.

   This was written inside backup-and-verify.js and is now shared, because a
   second tool needed exactly the same rules and the alternative was two copies
   of a security decision — the kind of duplication where the copies drift and
   the weaker one wins.

   The link this governs carries every homeowner's name, email address, phone
   number and postcode at once.

   Same rule as store.js: supply the provider's CA if you have it, otherwise
   fall back to the system trust store — never to no verification. If that
   fails the connection fails, and a refused connection is a better outcome
   than one taken over a link nobody authenticated. sslmode=disable is honoured
   for a local container, because those genuinely have no TLS. */
'use strict';
const fs = require('fs');

function tlsFor(dsn) {
  const caPem = process.env.DATABASE_CA_CERT
    || (process.env.PGSSLROOTCERT && fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'));
  const disabled = /[?&]sslmode=disable(&|$)/.test(dsn) || process.env.PGSSLMODE === 'disable';
  const host = (() => { try { return new URL(dsn).hostname; } catch (_) { return ''; } })();
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(host);

  if (disabled && !isLocal) {
    console.warn(`  TLS is DISABLED against ${host}. Every row crossing this connection, including homeowner contact details, goes in clear.`);
  } else if (!disabled && !caPem) {
    console.warn('  No DATABASE_CA_CERT or PGSSLROOTCERT — verifying against the system trust store. If the connection is refused, download your provider\'s CA.');
  }
  /* Railway issues every Postgres a certificate for CN=localhost, so no
     hostname we can dial will ever match it — not the private name and not
     the public proxy. These tools run from a laptop, so the public proxy is
     the only way in, and that link crosses the internet rather than staying
     inside the project.

     Same shape as store.js and one step weaker by circumstance: keep the
     chain check, pin the CA, waive only the name, and only for a host we
     recognise as Railway's with a CA actually supplied. An attacker still
     needs a certificate signed by that pinned root. If you want the stronger
     position, run these inside Railway against the private host instead. */
  const railwayHost = /\.proxy\.rlwy\.net$|\.railway\.internal$/.test(host);
  const waive = caPem && railwayHost;
  if (waive) {
    console.log(`  TLS: chain verified against the pinned CA; hostname check waived for ${host} (Railway issues CN=localhost).`);
  }

  return disabled ? false : {
    rejectUnauthorized: true,
    ...(caPem ? { ca: caPem } : {}),
    ...(waive ? { checkServerIdentity: () => undefined } : {}),
  };
}

module.exports = { tlsFor };
