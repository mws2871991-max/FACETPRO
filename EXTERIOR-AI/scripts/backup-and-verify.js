/* A restore test, because the privacy notice promises one.

     "Enquiries are backed up, and we test that we can restore them."

   Railway snapshots the volume, so the first half is true. Nobody has ever
   restored one, so the second half is a sentence with nothing behind it.

   What this does, in order:

     1. Reads every table in `public` and writes the rows to a file. That file
        is a backup held off Railway, which is itself something they did not
        have — a snapshot on the same platform as the thing it protects is one
        outage away from being no backup at all.

     2. Builds a scratch schema and restores into it, copying each table's
        structure with CREATE TABLE (LIKE ... INCLUDING ALL) so constraints,
        defaults and indexes come too rather than being approximated.

     3. Compares every table row for row, and compares a checksum of the
        contents rather than just the count — a restore that produces the
        right number of wrong rows should not pass.

     4. Drops the scratch schema.

   What it does NOT prove: that Railway's own volume snapshot restores. That
   is a dashboard operation and has to be done there. This proves the data can
   be got out whole and put back whole, which is the half that was untested
   and the half a logical backup depends on. */

const fs = require('fs');
const path = require('path');
const { Client, types } = require('pg');

/* Verify the far end of the connection.

   This was ssl: { rejectUnauthorized: false }, which encrypts the link
   without authenticating who is on the other side of it — the shape a
   man-in-the-middle needs. store.js had exactly the same line once and it was
   fixed there; the script that reads the WHOLE database in one go kept it,
   which is the wrong way round. A backup pulls every homeowner's name, email,
   phone number and postcode across that connection at once.

   Same rule as store.js: supply the provider's CA if you have it, otherwise
   fall back to the system trust store — never to no verification. If that
   fails the connection fails, and a refused backup is a better outcome than
   one taken over a link nobody authenticated. sslmode=disable is honoured for
   a local container, because those genuinely have no TLS. */
function tlsFor(dsn) {
  const caPem = process.env.DATABASE_CA_CERT
    || (process.env.PGSSLROOTCERT && fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'));
  const disabled = /[?&]sslmode=disable(&|$)/.test(dsn) || process.env.PGSSLMODE === 'disable';
  const host = (() => { try { return new URL(dsn).hostname; } catch (_) { return ''; } })();
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(host);

  if (disabled && !isLocal) {
    console.warn(`  TLS is DISABLED against ${host}. Every row of this backup, including homeowner contact details, crosses that link in clear.`);
  } else if (!disabled && !caPem) {
    console.warn('  No DATABASE_CA_CERT or PGSSLROOTCERT — verifying against the system trust store. If the connection is refused, download your provider\'s CA.');
  }
  /* Railway issues every Postgres a certificate for CN=localhost, so no
     hostname we can dial will ever match it — not the private name and not
     the public proxy. This tool runs from a laptop, so the public proxy is
     the only way in, and that link crosses the internet rather than staying
     inside the project.

     Same shape as store.js and one step weaker by circumstance: keep the
     chain check, pin the CA, waive only the name, and only for a host we
     recognise as Railway's with a CA actually supplied. An attacker still
     needs a certificate signed by that pinned root. If you want the stronger
     position, run this inside Railway against the private host instead. */
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

/* Take every value as the text Postgres sent, and send it back unchanged.

   The first version of this let node-postgres parse values into JavaScript
   types, and the round trip corrupted them twice over:

     live      2026-07-17 21:59:26.124145
     restored  2026-07-18 04:59:26.124

   A JS Date has no timezone of its own, so a "timestamp without time zone"
   came back as local time and went in as UTC — every timestamp in the
   database shifted by the machine's offset. And a Date holds milliseconds,
   so the microseconds were simply gone.

   Both survive a row count. That is the whole argument for checksumming the
   contents rather than counting them, and for testing a restore at all: this
   backup would have looked perfect and been wrong in every row.

   Text in, text out. Postgres parses its own output exactly. */
const RAW = (v) => v;
for (const oid of [
  1082, // date
  1114, // timestamp without time zone
  1184, // timestamptz
  1083, 1266, // time, timetz
  114, 3802, // json, jsonb
  1700, // numeric
  700, 701, // real, double precision
]) types.setTypeParser(oid, RAW);

const VARS = process.argv[2];
const OUT = process.argv[3];
const SCRATCH = 'restore_test_' + process.argv[4];

/* The schema the application actually writes to.

   This script read table_schema='public' while store.js has always written to
   facetpro_visualiser. The database is shared with the FastAPI backend, whose
   tables ARE in public and whose names collide with seven of ours — so the
   backup faithfully exported the other product's data, restored it, compared
   it to itself and printed PASSED. Nothing it protected was ours, and the
   privacy notice says we test that we can restore.

   Read from the same variable store.js reads, so the two cannot drift. */
const SCHEMA = (process.env.DB_SCHEMA || 'facetpro_visualiser').replace(/[^a-zA-Z0-9_]/g, '');

(async () => {
  const v = JSON.parse(fs.readFileSync(VARS, 'utf8'));
  const dsn = v.DATABASE_PUBLIC_URL;
  const c = new Client({ connectionString: dsn, ssl: tlsFor(dsn) });
  await c.connect();

  const tables = (await c.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema=$1 AND table_type='BASE TABLE' ORDER BY table_name`, [SCHEMA])).rows.map(r => r.table_name);

  console.log(`  schema: ${SCHEMA}`);
  console.log('  tables to back up: ' + tables.length);

  /* A backup of nothing must never report success. Comparing an empty set to
     an empty set passes every check there is, which is exactly how this said
     PASSED while protecting the wrong schema. */
  if (!tables.length) {
    console.error(`\n  FAILED — no tables found in schema "${SCHEMA}".`);
    console.error('  Nothing was backed up. Check DB_SCHEMA and that the app has started at least once.');
    await c.end();
    process.exit(1);
  }

  /* ── 1. export ── */
  const dump = { takenAt: new Date().toISOString(), server: (await c.query('select version()')).rows[0].version, tables: {} };
  let rows = 0;
  for (const t of tables) {
    const q = await c.query(`SELECT * FROM ${SCHEMA}."${t}"`);
    dump.tables[t] = q.rows;
    rows += q.rows.length;
  }
  fs.writeFileSync(OUT, JSON.stringify(dump, null, 1));
  const mb = (fs.statSync(OUT).size / 1024 / 1024).toFixed(2);
  console.log(`  exported ${rows} rows to a ${mb} MB file`);

  /* ── 2. restore into a scratch schema ── */
  await c.query(`DROP SCHEMA IF EXISTS ${SCRATCH} CASCADE`);
  await c.query(`CREATE SCHEMA ${SCRATCH}`);
  console.log('  scratch schema created: ' + SCRATCH);

  let restored = 0;
  for (const t of tables) {
    await c.query(`CREATE TABLE ${SCRATCH}."${t}" (LIKE ${SCHEMA}."${t}" INCLUDING ALL)`);
    const data = dump.tables[t];
    if (!data.length) continue;
    const cols = Object.keys(data[0]);
    const quoted = cols.map(x => `"${x}"`).join(',');
    for (const row of data) {
      const params = cols.map(x => row[x]);
      const ph = cols.map((_, i) => '$' + (i + 1)).join(',');
      await c.query(`INSERT INTO ${SCRATCH}."${t}" (${quoted}) VALUES (${ph})`, params);
      restored++;
    }
  }
  console.log('  restored ' + restored + ' rows from the file');

  /* ── 3. compare ── */
  let mismatches = 0;
  let withRows = 0;
  for (const t of tables) {
    const a = await c.query(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '' ORDER BY x::text), '')) h FROM ${SCHEMA}."${t}" x`);
    const b = await c.query(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '' ORDER BY x::text), '')) h FROM ${SCRATCH}."${t}" x`);
    const ok = a.rows[0].n === b.rows[0].n && a.rows[0].h === b.rows[0].h;
    if (!ok) {
      mismatches++;
      console.log(`   MISMATCH  ${t}: live ${a.rows[0].n} rows / restored ${b.rows[0].n} rows, contents ${a.rows[0].h === b.rows[0].h ? 'match' : 'DIFFER'}`);
    } else if (a.rows[0].n > 0) {
      withRows++;
      console.log(`   ok        ${t.padEnd(22)} ${String(a.rows[0].n).padStart(4)} rows, checksum matches`);
    }
  }

  /* ── 4. clean up ── */
  await c.query(`DROP SCHEMA ${SCRATCH} CASCADE`);
  console.log('  scratch schema dropped');

  await c.end();
  /* Say how much was actually exercised. Every empty table also passes — 0
     rows against 0 rows with matching checksums is a true comparison and a
     weak one, and this script has already once reported PASSED while looking
     at the wrong schema entirely. A reader should be able to see at a glance
     whether the run proved anything. */
  if (mismatches) {
    console.log(`\n  FAILED — ${mismatches} table(s) did not round-trip`);
  } else if (withRows === 0) {
    console.log(`\n  PASSED, but every one of the ${tables.length} tables in ${SCHEMA} was empty.`);
    console.log('  Nothing with data in it was exercised. This proves the plumbing, not the backup.');
  } else {
    console.log(`\n  PASSED — ${tables.length} tables restored identically, ${withRows} of them holding ${rows} rows between them`);
  }
  process.exit(mismatches ? 1 : 0);
})().catch(e => { console.log('  ERROR: ' + e.message); process.exit(1); });
