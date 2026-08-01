const fs = require('fs');
const path = require('path');

const SCHEMA_NAME = (process.env.DB_SCHEMA || 'facetpro_visualiser').replace(/[^a-zA-Z0-9_]/g, '');

let pool = null;
if (process.env.DATABASE_URL) {
  // `pg` is not a dependency — the JSONL fallback covers local use, and most
  // deployments never set DATABASE_URL. Setting it without installing pg used
  // to fail with a bare MODULE_NOT_FOUND at require time; say what to do.
  let Pool;
  try {
    ({ Pool } = require('pg'));
  } catch (err) {
    throw new Error(
      'DATABASE_URL is set but the "pg" package is not installed. ' +
      'Run `npm install pg` to use Postgres, or unset DATABASE_URL to store data ' +
      'as JSONL files under data/.'
    );
  }
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  /* Our tables live in their own schema, never in public.

     The obvious database to point this at already belongs to the FastAPI
     backend, and seven of our table names — leads, deliveries, detections,
     quotes, waitlist, feedback, notification_failures — already exist there
     with entirely different columns. CREATE TABLE IF NOT EXISTS silently does
     nothing against those, and the first insert then fails on a missing
     column. Sharing a database is fine; sharing a namespace is not.

     Every statement is schema-qualified explicitly rather than relying on
     search_path — setting it on connect races with the first query on a
     pooled connection, and pg warns about exactly that.

     Override with DB_SCHEMA if you want it elsewhere. */
}

const DATA_DIR = path.join(__dirname, 'data');
if (!pool && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS quotes (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, name TEXT, email TEXT, phone TEXT,
    postcode TEXT, type TEXT, timeline TEXT, products JSONB, notes TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS waitlist (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, email TEXT, role TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS feedback (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, session_id TEXT, rating TEXT, element_count INT, comment TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS detections (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, session_id TEXT, element_count INT, mime_type TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS retention_runs (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, record JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS access_log (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, endpoint TEXT, ip_hash TEXT, record JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS deliveries (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, lead_id TEXT, delivered INT, failed INT, record JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS notification_failures (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, lead_id TEXT, kind TEXT, record JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, action TEXT, name TEXT, email TEXT,
    phone TEXT, postcode TEXT, message TEXT, source TEXT, status TEXT, design JSONB
  )`
];

async function ensureSchema() {
  if (!pool) return;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_NAME}`);
  // Qualify explicitly rather than relying on search_path: this runs on a
  // pooled connection and an unqualified CREATE would be a coin toss.
  for (const ddl of SCHEMA) {
    await pool.query(ddl.replace(/CREATE TABLE IF NOT EXISTS (\w+)/, `CREATE TABLE IF NOT EXISTS ${SCHEMA_NAME}.$1`));
  }
}

const TABLE_NAMES = { leads: 'leads', deliveries: 'deliveries', notificationFailures: 'notification_failures', accessLog: 'access_log', retentionRuns: 'retention_runs', quotes: 'quotes', waitlist: 'waitlist', feedback: 'feedback', detections: 'detections', analytics: 'analytics' };

const FILE_NAMES = { quotes: 'quotes.jsonl', waitlist: 'waitlist.jsonl', feedback: 'feedback.jsonl', detections: 'detections.jsonl', analytics: 'analytics.jsonl', leads: 'leads.jsonl', deliveries: 'deliveries.jsonl', notificationFailures: 'notification-failures.jsonl', accessLog: 'access-log.jsonl', retentionRuns: 'retention-runs.jsonl' };

function appendLine(file, obj) {
  fs.appendFileSync(path.join(DATA_DIR, file), JSON.stringify(obj) + '\n');
}
function readLines(file) {
  const fp = path.join(DATA_DIR, file);
  if (!fs.existsSync(fp)) return [];
  return fs.readFileSync(fp, 'utf8').trim().split('\n').filter(Boolean).map(l => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const INSERT_SQL = {
  quotes: `INSERT INTO ${SCHEMA_NAME}.quotes (ts, name, email, phone, postcode, type, timeline, products, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  waitlist: `INSERT INTO ${SCHEMA_NAME}.waitlist (ts, email, role) VALUES ($1,$2,$3)`,
  feedback: `INSERT INTO ${SCHEMA_NAME}.feedback (ts, session_id, rating, element_count, comment) VALUES ($1,$2,$3,$4,$5)`,
  detections: `INSERT INTO ${SCHEMA_NAME}.detections (ts, session_id, element_count, mime_type) VALUES ($1,$2,$3,$4)`,
  leads: `INSERT INTO ${SCHEMA_NAME}.leads (ts, action, name, email, phone, postcode, message, source, status, design) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
  retentionRuns: `INSERT INTO ${SCHEMA_NAME}.retention_runs (ts, record) VALUES ($1,$2)`,
  accessLog: `INSERT INTO ${SCHEMA_NAME}.access_log (ts, endpoint, ip_hash, record) VALUES ($1,$2,$3,$4)`,
  deliveries: `INSERT INTO ${SCHEMA_NAME}.deliveries (ts, lead_id, delivered, failed, record) VALUES ($1,$2,$3,$4,$5)`,
  notificationFailures: `INSERT INTO ${SCHEMA_NAME}.notification_failures (ts, lead_id, kind, record) VALUES ($1,$2,$3,$4)`
};

const INSERT_PARAMS = {
  quotes: o => [o.ts, o.name, o.email, o.phone, o.postcode, o.type, o.timeline, JSON.stringify(o.products || []), o.notes],
  waitlist: o => [o.ts, o.email, o.role],
  feedback: o => [o.ts, o.sessionId, o.rating, o.elementCount, o.comment],
  detections: o => [o.ts, o.sessionId, o.elementCount, o.mimeType],
  /* The scalar columns are for querying; `design` carries the WHOLE lead.
     This used to pass o.design, which no lead has ever had — so with
     DATABASE_URL set, thirteen fields were dropped on every insert: the id,
     the price and its breakdown, the selections, the measurement, the
     conservatory and preference choices, the render URL, and the consent
     record.

     The consent record is the one that matters most. It holds the exact
     wording the homeowner agreed to and when, which is the evidence of
     lawful basis under UK GDPR — losing it silently is worse than not
     having a database at all. `action`, `message` and `source` are legacy
     columns from an older shape and are simply not part of a lead. */
  leads: o => [o.ts, null, o.name, o.email, o.phone, o.postcode, null, null, o.status, JSON.stringify(o)],
  // Same rule as leads: the scalar columns are for querying, the JSONB holds
  // the whole record so nothing is silently dropped.
  retentionRuns: o => [o.ts, JSON.stringify(o)],
  accessLog: o => [o.ts, o.endpoint || null, o.ipHash || null, JSON.stringify(o)],
  deliveries: o => [o.ts, o.leadId || null, o.delivered | 0, o.failed | 0, JSON.stringify(o)],
  notificationFailures: o => [o.ts, o.leadId || null, o.kind || null, JSON.stringify(o)]
};

const SELECT_SQL = {
  quotes: `SELECT ts, name, email, phone, postcode, type, timeline, products, notes FROM ${SCHEMA_NAME}.quotes ORDER BY id ASC`,
  waitlist: `SELECT ts, email, role FROM ${SCHEMA_NAME}.waitlist ORDER BY id ASC`,
  feedback: `SELECT ts, session_id AS "sessionId", rating, element_count AS "elementCount", comment FROM ${SCHEMA_NAME}.feedback ORDER BY id ASC`,
  detections: `SELECT ts, session_id AS "sessionId", element_count AS "elementCount", mime_type AS "mimeType" FROM ${SCHEMA_NAME}.detections ORDER BY id ASC`,
  // `design` holds the full lead, so read it back rather than reassembling a
  // partial one from the scalar columns.
  leads: `SELECT design FROM ${SCHEMA_NAME}.leads ORDER BY id ASC`,
  retentionRuns: `SELECT record FROM ${SCHEMA_NAME}.retention_runs ORDER BY id ASC`,
  accessLog: `SELECT record FROM ${SCHEMA_NAME}.access_log ORDER BY id ASC`,
  deliveries: `SELECT record FROM ${SCHEMA_NAME}.deliveries ORDER BY id ASC`,
  notificationFailures: `SELECT record FROM ${SCHEMA_NAME}.notification_failures ORDER BY id ASC`
};

async function append(table, obj) {
  if (pool) {
    await pool.query(INSERT_SQL[table], INSERT_PARAMS[table](obj));
  } else {
    appendLine(FILE_NAMES[table], obj);
  }
}

/* Rewrite a whole table. Only retention needs this — everything else appends.
   Kept deliberately narrow: a full replace is a destructive operation and
   should be hard to reach by accident. */
async function replaceAll(table, rows) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${SCHEMA_NAME}.${TABLE_NAMES[table]}`);
      for (const row of rows) {
        await client.query(INSERT_SQL[table], INSERT_PARAMS[table](row));
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return;
  }
  // Write to a temp file and rename, so an interrupted run cannot leave a
  // half-written store behind.
  const file = path.join(DATA_DIR, FILE_NAMES[table]);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, rows.map(r => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  fs.renameSync(tmp, file);
}

async function readAll(table) {
  if (pool) {
    const { rows } = await pool.query(SELECT_SQL[table]);
    // Leads are stored whole in the `design` JSONB column, so unwrap them —
    // callers expect the same shape the JSONL path returns, not a row with a
    // nested object. Anything without it falls back to the row itself.
    if (table === 'leads') return rows.map(r => r.design || r);
    if (table === 'deliveries' || table === 'notificationFailures' || table === 'accessLog' || table === 'retentionRuns') return rows.map(r => r.record || r);
    return rows;
  }
  return readLines(FILE_NAMES[table]);
}

module.exports = {
  ensureSchema, append, readAll, replaceAll, hasDb: !!pool,
  // Exported for tests: scraping these out of the source with a regex broke
  // the moment another table was added after leads.
  _internals: { INSERT_PARAMS, INSERT_SQL, SELECT_SQL, FILE_NAMES },
};
