/* What personal data is actually in the database, and where it is.

     npm run count-personal-data

   Written after a question nobody could answer from the code: LEAD_CAPTURE was
   off, so the assumption was that the database held nothing personal. It held
   an AI render of somebody's house, half a megabyte of it, and had done for
   ten days. server.js calls putRender unconditionally on every completed
   render — no leadId, no reference to the capture switch — so renders arrive
   without anybody turning anything on.

   The lesson is not about renders. It is that "is there personal data in
   there?" was answerable only by writing a throwaway script against
   production, which means in practice it was not answerable at all. So this
   is the non-throwaway version.

   It prints counts and never contents. Nobody should have to read a
   homeowner's details to find out how many of them there are, and a tool that
   prints rows is one that gets run with the output pasted somewhere.

   Reads DATABASE_PUBLIC_URL, or DATABASE_URL when run inside Railway where the
   private host resolves. TLS rules are shared with backup-and-verify.js. */
'use strict';
const { Client } = require('pg');
const { tlsFor } = require('./db-tls');

/* Read from the same variable store.js reads, so the two cannot drift. The
   database is shared with the FastAPI backend, whose tables are in public and
   whose names collide with several of ours — counting the wrong schema would
   report another product's data as ours. */
const SCHEMA = (process.env.DB_SCHEMA || 'facetpro_visualiser').replace(/[^a-zA-Z0-9_]/g, '');

/* Grouped by what a row actually is, because the counts mean different things.

   `holds` is what one row contains. It is written out rather than inferred so
   that adding a column to a table without revisiting this line is visibly
   wrong rather than quietly wrong. */
const TABLES = [
  { name: 'leads', personal: true, holds: 'name, email, phone, postcode — the whole enquiry' },
  { name: 'renders', personal: true, holds: 'image bytes of an identifiable home', bytes: 'bytes' },
  { name: 'deliveries', personal: true, holds: 'which installer received which lead' },
  { name: 'lead_responses', personal: true, holds: 'an installer\'s response to a lead' },
  { name: 'withdrawals', personal: true, holds: 'a lead id and what was withdrawn' },
  { name: 'notification_failures', personal: true, holds: 'a lead whose email did not send' },
  { name: 'quotes', personal: true, holds: 'a quote, joined to a lead' },
  { name: 'waitlist', personal: true, holds: 'an email address' },
  { name: 'feedback', personal: true, holds: 'a session id and a free-text comment' },
  { name: 'access_log', personal: true, holds: 'who read the installer area and when' },
  { name: 'resumes', personal: false, holds: 'design choices only; expires in a day' },
  { name: 'detections', personal: false, holds: 'a session id, a count and a mime type — no image' },
  { name: 'detection_cache', personal: false, holds: 'a SHA-256 of the photograph, never the photograph' },
  { name: 'measurement_observations', personal: false, holds: 'shape numbers, unlinkable by construction' },
  { name: 'funnel', personal: false, holds: 'a day, a stage and a number' },
  { name: 'retention_runs', personal: false, holds: 'what the retention sweep did' },
];

(async () => {
  const dsn = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  if (!dsn) {
    console.error('Set DATABASE_PUBLIC_URL (from a laptop) or DATABASE_URL (inside Railway).');
    console.error('Railway: railway variables --service Postgres --kv | grep DATABASE_PUBLIC_URL');
    process.exit(1);
  }

  const c = new Client({ connectionString: dsn, ssl: tlsFor(dsn) });
  await c.connect();

  const present = (await c.query(`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema=$1 AND table_type='BASE TABLE'`, [SCHEMA])).rows.map(r => r.table_name);

  /* Counting nothing must never look like counting zero. An empty schema and
     a wrong schema produce the same row of zeros, and the second is the one
     that misleads — it is exactly how the backup script once reported PASSED
     while protecting another product's tables. */
  if (!present.length) {
    console.error(`\n  FAILED — no tables in schema "${SCHEMA}".`);
    console.error('  Check DB_SCHEMA, and that the app has started at least once.');
    await c.end();
    process.exit(1);
  }

  console.log(`\n  schema: ${SCHEMA}\n`);

  let personalRows = 0;
  const lines = [];
  for (const t of TABLES) {
    if (!present.includes(t.name)) continue;
    const { rows } = await c.query(`SELECT count(*)::int AS n FROM ${SCHEMA}.${t.name}`);
    const n = rows[0].n;
    if (t.personal) personalRows += n;

    let extra = '';
    if (t.bytes && n) {
      const { rows: b } = await c.query(
        `SELECT COALESCE(sum(octet_length(${t.bytes})),0)::bigint AS n,
                min(ts)::text AS oldest FROM ${SCHEMA}.${t.name}`);
      extra = `  (${Math.round(Number(b[0].n) / 1024)} KB, oldest ${b[0].oldest})`;
    }
    lines.push(`  ${t.personal ? '●' : '·'} ${t.name.padEnd(26)} ${String(n).padStart(6)}${extra}`);
  }
  console.log(lines.join('\n'));

  const unlisted = present.filter(p => !TABLES.some(t => t.name === p));
  if (unlisted.length) {
    console.log(`\n  NOT COUNTED — tables this script has never been told about:`);
    console.log(`    ${unlisted.join(', ')}`);
    console.log('  Add them to TABLES with what a row holds. Until then this total is a floor, not a total.');
  }

  console.log(`\n  ● personal: ${personalRows} row(s). · not personal by construction.`);
  if (personalRows) {
    console.log('  Moving region is a migration while this is above zero, not a config change.');
  }
  console.log('');

  await c.end();
})().catch(err => {
  console.error('  Failed: ' + err.message);
  process.exit(1);
});
