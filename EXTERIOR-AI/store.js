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
  /* Verification stays on.

     This was `rejectUnauthorized: false`, which encrypts the connection
     without authenticating the other end — precisely the shape a
     man-in-the-middle needs, on the connection that carries every homeowner's
     name, email, phone number, postcode and consent record. It is the usual
     copy-paste for managed Postgres, goes in to get something working, and
     never comes out.

     Managed providers use their own CA rather than a public root, so supply
     it: DATABASE_CA_CERT for the PEM inline (easiest in a platform env var)
     or PGSSLROOTCERT for a path. Every provider publishes one.

     Without a CA we fall back to the platform's trust store rather than to no
     verification at all. If that fails, the connection fails, and a refused
     connection is a better outcome than an unauthenticated one. */
  const caPem = process.env.DATABASE_CA_CERT
    || (process.env.PGSSLROOTCERT && fs.readFileSync(process.env.PGSSLROOTCERT, 'utf8'));
  if (!caPem) {
    console.warn('No DATABASE_CA_CERT or PGSSLROOTCERT set — verifying the database certificate against the system trust store. If the connection is refused, download your provider\'s CA certificate.');
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true, ...(caPem ? { ca: caPem } : {}) },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
  });

  /* Without this, a network blip on an idle pooled client emits 'error' on
     the Pool with nothing listening — and an unhandled 'error' event in Node
     takes the whole process down. The database going wobbly should not take
     the website with it. */
  pool.on('error', (err) => {
    console.error('Postgres pool error on an idle client:', err.message);
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

/* Where the JSONL files live.

   Overridable because `npm test` wrote here — to the same directory a
   deployment mounts its volume on. Running the suite on a box with that
   volume attached would have written test leads into real storage and deleted
   the live spend counter. Nothing else in this codebase can damage anything
   outside the app; this could.

   The variable is read once, at load, so a test sets it before requiring
   anything and every consumer agrees. */
const DATA_DIR = process.env.FACETPRO_DATA_DIR
  ? path.resolve(process.env.FACETPRO_DATA_DIR)
  : path.join(__dirname, 'data');
if (!pool && !fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

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
  `CREATE TABLE IF NOT EXISTS renders (
    id TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, lead_id TEXT, mime TEXT, bytes BYTEA
  )`,
  /* A design carried from one device to another. Choices only — no photograph
     and nothing identifying — so this holds no personal data and expires in a
     day rather than belonging to a retention class. */
  `CREATE TABLE IF NOT EXISTS resumes (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, code TEXT UNIQUE, expires_at TIMESTAMPTZ, record JSONB
  )`,
  `CREATE TABLE IF NOT EXISTS withdrawals (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, lead_id TEXT, scope TEXT, record JSONB
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

  /* The lead reference, and the database's own refusal to hold it twice.

     The application generates 60 bits of entropy per reference, so a
     duplicate should never arrive — but "should never" is exactly the class
     of assumption worth having the database enforce, because lead.id is the
     join key for withdrawal, retention and erasure. A unique index turns a
     silent overwrite of somebody else's record into a failed insert.

     Added separately from the CREATE TABLE because that only runs on a fresh
     database, and the tables this needs to reach already exist. */
  await pool.query(`ALTER TABLE ${SCHEMA_NAME}.leads ADD COLUMN IF NOT EXISTS lead_id TEXT`);
  try {
    await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS leads_lead_id_key ON ${SCHEMA_NAME}.leads (lead_id)`);
  } catch (err) {
    /* Duplicates already in the table. Refusing to start would be worse than
       running without the backstop — the data is already there either way —
       but this has to be loud, because those records need reconciling by hand
       and one of them may be somebody's consent evidence. */
    console.error('COULD NOT ADD THE UNIQUE INDEX ON leads.lead_id:', err.message);
    console.error('There are duplicate lead references in the database. Run: node scripts/check-lead-ids.js');
  }
}

const TABLE_NAMES = { leads: 'leads', deliveries: 'deliveries', notificationFailures: 'notification_failures', accessLog: 'access_log', resumes: 'resumes', withdrawals: 'withdrawals', retentionRuns: 'retention_runs', quotes: 'quotes', waitlist: 'waitlist', feedback: 'feedback', detections: 'detections', analytics: 'analytics' };

const FILE_NAMES = { quotes: 'quotes.jsonl', waitlist: 'waitlist.jsonl', feedback: 'feedback.jsonl', detections: 'detections.jsonl', analytics: 'analytics.jsonl', leads: 'leads.jsonl', deliveries: 'deliveries.jsonl', notificationFailures: 'notification-failures.jsonl', accessLog: 'access-log.jsonl', resumes: 'resumes.jsonl', withdrawals: 'withdrawals.jsonl', retentionRuns: 'retention-runs.jsonl' };

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
  leads: `INSERT INTO ${SCHEMA_NAME}.leads (ts, action, name, email, phone, postcode, message, source, status, design, lead_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
  resumes: `INSERT INTO ${SCHEMA_NAME}.resumes (ts, code, expires_at, record) VALUES ($1,$2,$3,$4)`,
  withdrawals: `INSERT INTO ${SCHEMA_NAME}.withdrawals (ts, lead_id, scope, record) VALUES ($1,$2,$3,$4)`,
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
  leads: o => [o.ts, null, o.name, o.email, o.phone, o.postcode, null, null, o.status, JSON.stringify(o), o.id || null],
  // Same rule as leads: the scalar columns are for querying, the JSONB holds
  // the whole record so nothing is silently dropped.
  resumes: o => [o.ts, o.code, o.expiresAt || null, JSON.stringify(o)],
  withdrawals: o => [o.ts, o.leadId || null, o.scope || null, JSON.stringify(o)],
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
  resumes: `SELECT record FROM ${SCHEMA_NAME}.resumes ORDER BY id ASC`,
  withdrawals: `SELECT record FROM ${SCHEMA_NAME}.withdrawals ORDER BY id ASC`,
  retentionRuns: `SELECT record FROM ${SCHEMA_NAME}.retention_runs ORDER BY id ASC`,
  accessLog: `SELECT record FROM ${SCHEMA_NAME}.access_log ORDER BY id ASC`,
  deliveries: `SELECT record FROM ${SCHEMA_NAME}.deliveries ORDER BY id ASC`,
  notificationFailures: `SELECT record FROM ${SCHEMA_NAME}.notification_failures ORDER BY id ASC`
};

async function append(table, obj) {
  return withWriteLock(() => appendNow(table, obj));
}

async function appendNow(table, obj) {
  if (pool) {
    await pool.query(INSERT_SQL[table], INSERT_PARAMS[table](obj));
  } else {
    appendLine(FILE_NAMES[table], obj);
  }
}

/* Rewrite a whole table. Only retention needs this — everything else appends.
   Kept deliberately narrow: a full replace is a destructive operation and
   should be hard to reach by accident. */
/* ── ONE WRITER AT A TIME ──

   replaceAll is read-all, write-temp, rename. Every caller that uses it does a
   read-modify-write: read the leads, change one, write them all back. A lead
   saved between the read and the rename is silently lost, and so is a second
   withdrawal arriving at the same moment as the first.

   That is not an ordinary integrity bug. Losing a consent record destroys the
   evidence of the lawful basis for everything already done with that person's
   details; losing a withdrawal means processing carries on after someone
   asked us to stop.

   The window only closes if the read and the write are inside the same lock,
   which is why callers get mutate() rather than being trusted to hold one.
   Serialised through a promise chain — cheap, and this is not a hot path.

   In-process only. Two instances sharing a data directory would still race,
   which is one more reason JSONL is for development and Postgres is what runs
   live (see refuseToStartIfStorageContradictsTheNotice in server.js). */
let writeQueue = Promise.resolve();

function withWriteLock(fn) {
  const result = writeQueue.then(fn, fn);
  writeQueue = result.then(() => {}, () => {});   // a failure must not wedge the queue
  return result;
}

/* Read, change, write — all inside the lock.

   The transform receives the rows as they are at that moment, so it must find
   what it is changing itself rather than relying on anything read earlier.
   Returning undefined means "nothing to do", and nothing is written. */
async function mutate(table, transform) {
  return withWriteLock(async () => {
    const rows = await readAll(table);
    const next = await transform(rows);
    if (next === undefined) return null;
    await writeAll(table, next);
    return next;
  });
}

async function replaceAll(table, rows) {
  return withWriteLock(() => writeAll(table, rows));
}

async function writeAll(table, rows) {
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

/* Renders are binary and don't belong in an append-only JSONL row, so they get
   their own path: a bytea column under Postgres, a file under data/renders
   otherwise. Stored by us rather than linked from Replicate, whose delivery
   URLs are public and expire within the hour. */
const RENDER_DIR = path.join(DATA_DIR, 'renders');

async function putRender(id, buffer, { mime = 'image/jpeg', leadId = null } = {}) {
  if (pool) {
    await pool.query(
      `INSERT INTO ${SCHEMA_NAME}.renders (id, ts, lead_id, mime, bytes) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO NOTHING`,
      [id, new Date().toISOString(), leadId, mime, buffer]);
    return;
  }
  fs.mkdirSync(RENDER_DIR, { recursive: true });
  fs.writeFileSync(path.join(RENDER_DIR, id + '.bin'), buffer);
  fs.writeFileSync(path.join(RENDER_DIR, id + '.json'), JSON.stringify({ id, ts: new Date().toISOString(), leadId, mime }));
}

async function getRender(id) {
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(String(id || ''))) return null;   // never touch the filesystem with an unvetted id
  if (pool) {
    const { rows } = await pool.query(`SELECT mime, bytes FROM ${SCHEMA_NAME}.renders WHERE id = $1`, [id]);
    return rows[0] ? { mime: rows[0].mime, bytes: rows[0].bytes } : null;
  }
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(RENDER_DIR, id + '.json'), 'utf8'));
    return { mime: meta.mime, bytes: fs.readFileSync(path.join(RENDER_DIR, id + '.bin')) };
  } catch (_) { return null; }
}

async function deleteRenders(ids) {
  if (!ids.length) return 0;
  if (pool) {
    const { rowCount } = await pool.query(`DELETE FROM ${SCHEMA_NAME}.renders WHERE id = ANY($1)`, [ids]);
    return rowCount;
  }
  /* Renders removed, not files removed. Each one is a .bin and a .json, so
     this counted two for every image — and the number goes into the retention
     record, which is the evidence for "we delete on schedule". A count that
     doubles is worse than no count, and it made the two backends disagree:
     Postgres returns rows. */
  let n = 0;
  for (const id of ids) {
    let removed = false;
    for (const ext of ['.bin', '.json']) {
      try { fs.unlinkSync(path.join(RENDER_DIR, id + ext)); removed = true; } catch (_) { /* already gone */ }
    }
    if (removed) n++;
  }
  return n;
}

/* One code, by its own unique index.

   Redemption used to read and deserialise every live code to find one row —
   an O(1) lookup written as O(n) with the index already declared and never
   used. Returns undefined when there is no index to use (the JSONL backend),
   so the caller falls back rather than being told there is nothing there. */
async function getResume(code) {
  if (!pool) return undefined;
  const { rows } = await pool.query(
    `SELECT record FROM ${SCHEMA_NAME}.resumes WHERE code = $1 ORDER BY id DESC LIMIT 1`, [code]);
  return rows[0]?.record || null;
}

async function readAll(table) {
  if (pool) {
    const { rows } = await pool.query(SELECT_SQL[table]);
    // Leads are stored whole in the `design` JSONB column, so unwrap them —
    // callers expect the same shape the JSONL path returns, not a row with a
    // nested object. Anything without it falls back to the row itself.
    if (table === 'leads') return rows.map(r => r.design || r);
    if (table === 'deliveries' || table === 'notificationFailures' || table === 'accessLog' || table === 'retentionRuns' || table === 'withdrawals' || table === 'resumes') return rows.map(r => r.record || r);
    return rows;
  }
  return readLines(FILE_NAMES[table]);
}

/* Let the pool go on shutdown, so Postgres isn't left holding sessions from
   a container that has already gone. No-op without a database. */
async function end() {
  if (pool) await pool.end();
}

module.exports = {
  ensureSchema, append, readAll, replaceAll, mutate, end, getResume, DATA_DIR, putRender, getRender, deleteRenders, hasDb: !!pool,
  // Exported for tests: scraping these out of the source with a regex broke
  // the moment another table was added after leads.
  _internals: { INSERT_PARAMS, INSERT_SQL, SELECT_SQL, FILE_NAMES },
};
