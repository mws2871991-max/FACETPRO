const fs = require('fs');
const path = require('path');

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
  `CREATE TABLE IF NOT EXISTS leads (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, action TEXT, name TEXT, email TEXT,
    phone TEXT, postcode TEXT, message TEXT, source TEXT, status TEXT, design JSONB
  )`
];

async function ensureSchema() {
  if (!pool) return;
  for (const ddl of SCHEMA) await pool.query(ddl);
}

const FILE_NAMES = { quotes: 'quotes.jsonl', waitlist: 'waitlist.jsonl', feedback: 'feedback.jsonl', detections: 'detections.jsonl', analytics: 'analytics.jsonl', leads: 'leads.jsonl' };

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
  quotes: `INSERT INTO quotes (ts, name, email, phone, postcode, type, timeline, products, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  waitlist: `INSERT INTO waitlist (ts, email, role) VALUES ($1,$2,$3)`,
  feedback: `INSERT INTO feedback (ts, session_id, rating, element_count, comment) VALUES ($1,$2,$3,$4,$5)`,
  detections: `INSERT INTO detections (ts, session_id, element_count, mime_type) VALUES ($1,$2,$3,$4)`,
  leads: `INSERT INTO leads (ts, action, name, email, phone, postcode, message, source, status, design) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`
};

const INSERT_PARAMS = {
  quotes: o => [o.ts, o.name, o.email, o.phone, o.postcode, o.type, o.timeline, JSON.stringify(o.products || []), o.notes],
  waitlist: o => [o.ts, o.email, o.role],
  feedback: o => [o.ts, o.sessionId, o.rating, o.elementCount, o.comment],
  detections: o => [o.ts, o.sessionId, o.elementCount, o.mimeType],
  leads: o => [o.ts, o.action, o.name, o.email, o.phone, o.postcode, o.message, o.source, o.status, JSON.stringify(o.design||{})]
};

const SELECT_SQL = {
  quotes: `SELECT ts, name, email, phone, postcode, type, timeline, products, notes FROM quotes ORDER BY id ASC`,
  waitlist: `SELECT ts, email, role FROM waitlist ORDER BY id ASC`,
  feedback: `SELECT ts, session_id AS "sessionId", rating, element_count AS "elementCount", comment FROM feedback ORDER BY id ASC`,
  detections: `SELECT ts, session_id AS "sessionId", element_count AS "elementCount", mime_type AS "mimeType" FROM detections ORDER BY id ASC`,
  leads: `SELECT ts, action, name, email, phone, postcode, message, source, status, design FROM leads ORDER BY id ASC`
};

async function append(table, obj) {
  if (pool) {
    await pool.query(INSERT_SQL[table], INSERT_PARAMS[table](obj));
  } else {
    appendLine(FILE_NAMES[table], obj);
  }
}

async function readAll(table) {
  if (pool) {
    const { rows } = await pool.query(SELECT_SQL[table]);
    return rows;
  }
  return readLines(FILE_NAMES[table]);
}

module.exports = { ensureSchema, append, readAll, hasDb: !!pool };
