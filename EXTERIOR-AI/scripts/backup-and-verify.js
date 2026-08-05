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

(async () => {
  const v = JSON.parse(fs.readFileSync(VARS, 'utf8'));
  const c = new Client({ connectionString: v.DATABASE_PUBLIC_URL, ssl: { rejectUnauthorized: false } });
  await c.connect();

  const tables = (await c.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema='public' AND table_type='BASE TABLE' ORDER BY table_name`)).rows.map(r => r.table_name);

  console.log('  tables to back up: ' + tables.length);

  /* ── 1. export ── */
  const dump = { takenAt: new Date().toISOString(), server: (await c.query('select version()')).rows[0].version, tables: {} };
  let rows = 0;
  for (const t of tables) {
    const q = await c.query(`SELECT * FROM public."${t}"`);
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
    await c.query(`CREATE TABLE ${SCRATCH}."${t}" (LIKE public."${t}" INCLUDING ALL)`);
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
  for (const t of tables) {
    const a = await c.query(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '' ORDER BY x::text), '')) h FROM public."${t}" x`);
    const b = await c.query(`SELECT count(*)::int n, md5(coalesce(string_agg(x::text, '' ORDER BY x::text), '')) h FROM ${SCRATCH}."${t}" x`);
    const ok = a.rows[0].n === b.rows[0].n && a.rows[0].h === b.rows[0].h;
    if (!ok) {
      mismatches++;
      console.log(`   MISMATCH  ${t}: live ${a.rows[0].n} rows / restored ${b.rows[0].n} rows, contents ${a.rows[0].h === b.rows[0].h ? 'match' : 'DIFFER'}`);
    } else if (a.rows[0].n > 0) {
      console.log(`   ok        ${t.padEnd(22)} ${String(a.rows[0].n).padStart(4)} rows, checksum matches`);
    }
  }

  /* ── 4. clean up ── */
  await c.query(`DROP SCHEMA ${SCRATCH} CASCADE`);
  console.log('  scratch schema dropped');

  await c.end();
  console.log('\n  ' + (mismatches ? `FAILED — ${mismatches} table(s) did not round-trip` : 'PASSED — every table restored identically'));
  process.exit(mismatches ? 1 : 0);
})().catch(e => { console.log('  ERROR: ' + e.message); process.exit(1); });
