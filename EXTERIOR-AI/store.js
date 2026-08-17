const fs = require('fs');
const path = require('path');
const tls = require('tls');

const SCHEMA_NAME = (process.env.DB_SCHEMA || 'facetpro_visualiser').replace(/[^a-zA-Z0-9_]/g, '');

/* Waive the hostname check for one specific, pinned case. Exported because it
   decides whether an impostor can answer for the database, and a rule that
   important should be readable and tested rather than buried in a closure —
   the long explanation is at the call site. Returns undefined to accept, or an
   Error to reject, which is the contract Node's TLS stack expects. */
function checkServerIdentity(caPem, host, cert) {
  if (caPem && host.endsWith('.railway.internal') && cert?.subject?.CN === 'localhost') return undefined;
  return tls.checkServerIdentity(host, cert);
}

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

  /* A Postgres with no TLS at all is a real thing — a container on a CI
     runner, a developer's local instance — and passing an ssl object made
     those impossible to connect to. Not a preference: "the server does not
     support SSL connections", every time, which is how the integration suite
     failed the first time it ran.

     libpq spells this sslmode=disable, so that is what we honour, rather than
     inventing a setting. Anywhere else, verification stays on.

     Loud when it is disabled against something that is not local, because
     that combination is either a mistake or somebody routing round the thing
     this connection exists to protect. */
  const dsn = process.env.DATABASE_URL;
  const sslDisabled = /[?&]sslmode=disable(&|$)/.test(dsn) || process.env.PGSSLMODE === 'disable';
  const host = (() => { try { return new URL(dsn).hostname; } catch (_) { return ''; } })();
  const isLocal = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(host);

  if (sslDisabled && !isLocal) {
    console.warn(`TLS is DISABLED on the database connection to ${host}. Every homeowner's name, email, phone number and postcode crosses that link in clear. Remove sslmode=disable unless this is a private network you control.`);
  } else if (!sslDisabled && !caPem) {
    console.warn('No DATABASE_CA_CERT or PGSSLROOTCERT set — verifying the database certificate against the system trust store. If the connection is refused, download your provider\'s CA certificate.');
  }

  /* The one name we will accept that does not match.

     Railway issues every Postgres the same certificate — CN=localhost, with
     localhost as its only subject alternative name — signed by a self-signed
     root-ca it also serves. We reach the database over the project's private
     network, as postgres.railway.internal, so the name in the certificate can
     never match the name we dialled. Verification fails on the hostname check
     long before anything looks at the CA.

     The usual escape is rejectUnauthorized: false, which switches off the
     whole apparatus — chain, signature and name together — and leaves an
     encrypted pipe to whoever answered. That is what used to be here and what
     a reviewer was right to call out; it carries every homeowner's name,
     email, phone number and postcode.

     So: keep the chain check, pin the CA, and waive only the name — and only
     on the private network, only for that exact CN, and only when a CA has
     actually been supplied to check against. An attacker still needs a
     certificate signed by the pinned root. Everywhere else, including the
     public proxy host, gets ordinary verification with no exceptions.

     If Railway rotates that root the connection fails loudly rather than
     falling back to trusting anything, which is the correct direction to
     fail. The current one is valid to October 2028. */
  const acceptPinnedPrivateHost = (host, cert) => checkServerIdentity(caPem, host, cert);

  pool = new Pool({
    connectionString: dsn,
    ssl: sslDisabled ? false : {
      rejectUnauthorized: true,
      ...(caPem ? { ca: caPem, checkServerIdentity: acceptPinnedPrivateHost } : {}),
    },
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
  /* Detections, keyed by the image they came from.

     The model is sampled and `temperature` is deprecated on it, so the same
     photograph does not produce the same answer twice. server.js already holds
     an in-memory map to make one photograph give one price — but it is in
     memory, so a deploy empties it and the number a homeowner was shown
     yesterday is not the number they see today. On a real photograph that was
     seven windows before a deploy and six after: a seventeen per cent move on
     the same house, under a homepage promising the same house gets the same
     number.

     WHAT IS DELIBERATELY NOT IN HERE.

     Not the photograph. legal/privacy.html says "your photograph is used to
     build your visualisation and is then deleted", and that stays true — this
     holds a SHA-256 of the bytes, which cannot reconstruct them.

     Not a person. No session id, no lead id, no IP, nothing to join on. A row
     is a hash and the measurements of a building, and it is not linkable to
     anybody by design rather than by policy — which is the only kind of
     unlinkable worth claiming.

     Rows expire (see DETECTION_CACHE_DAYS in server.js) and the sweep runs on
     write, so the table cannot quietly become a permanent record of every
     house ever photographed. */
  /* How many people reached each step, and nothing else.

     The conversion plan asks to know where every visitor stops — landing,
     upload, design, estimate, quote — because Priority 1 is conversion and
     conversion cannot be improved blind. It does not require knowing WHO
     stopped, and this deliberately cannot answer that.

     A row is a day, a stage, and a number. No session id, no visitor id, no
     IP, no user agent, no path, no referrer. Two people who both upload are
     indistinguishable from one person who uploaded twice, which is the cost of
     building it this way and is worth paying: there is no personal data here,
     so no consent to obtain, no third-party processor, no international
     transfer, and nothing that can leak.

     It answers the questions the plan actually asks — what share of visitors
     upload, what share of uploads reach an estimate — and refuses the ones it
     should not be able to. */
  `CREATE TABLE IF NOT EXISTS funnel (
    day DATE NOT NULL, stage TEXT NOT NULL, hits INT NOT NULL DEFAULT 0,
    PRIMARY KEY (day, stage)
  )`,
  /* What a photograph looked like to the measurer, and what it decided.
     Shape numbers and an outcome — no image, no identifier, nothing that could
     be tied to a person or a property. It exists because three thresholds in
     the measurement path are currently set from a synthetic terrace, and the
     only way to set them properly is to see where real front doors actually
     sit. Every row is one upload's worth of evidence toward that. */
  `CREATE TABLE IF NOT EXISTS measurement_observations (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMPTZ NOT NULL,
    house_type TEXT,
    door_ratio REAL,
    door_height_pct REAL,
    door_boxes INT,
    method TEXT,
    m2 REAL
  )`,

  `CREATE TABLE IF NOT EXISTS detection_cache (
    image_hash TEXT PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, aspect_ratio DOUBLE PRECISION, detections JSONB NOT NULL
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
  /* What a buyer did with a lead they were sent.

     Append-only, one row per decision, rather than a status column on the lead
     — three installers receive the same lead and can disagree about it, so
     "accepted" is a fact about a pair, not about a lead. It is also the
     billing conversation: an installer who passes on a lead they were charged
     for will say so, and this is the record that settles it.

     No personal data: a lead id, an installer id, a decision and a timestamp.
     Erasure therefore leaves these rows alone by design — after the lead is
     redacted the row references a reference and nothing more, and deleting it
     would destroy the delivery and billing history for a lead somebody was
     charged for. */
  `CREATE TABLE IF NOT EXISTS lead_responses (
    id SERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL, lead_id TEXT, installer_id TEXT,
    action TEXT, record JSONB
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

  /* Indexes on the columns we actually join and filter by.

     There was exactly one index in the whole store — the unique key above —
     and everything else was a sequential scan. That is invisible at the
     hundreds of rows this holds today and it is not a performance nicety
     later: the paths that scan are withdrawal, erasure and the retention run,
     which are the ones with a deadline attached. A subject access or erasure
     request has a statutory month, and the work it does grows with every lead
     ever taken.

     lead_id on the four tables that carry it, because erasure correctness is a
     join across all of them — the delivery log says who received somebody's
     details, and that is what has to be found and purged.

     ts on access_log and leads, because retention selects by age and the
     access log is the one table that only ever grows.

     IF NOT EXISTS on every one, so this is safe to run on each boot. Cheap
     against an empty table and a one-off cost against a full one. */
  const indexes = [
    ['deliveries_lead_id_idx', 'deliveries (lead_id)'],
    ['notification_failures_lead_id_idx', 'notification_failures (lead_id)'],
    ['withdrawals_lead_id_idx', 'withdrawals (lead_id)'],
    ['renders_lead_id_idx', 'renders (lead_id)'],
    /* Orphan sweeps select renders by age, and lead_id is null on all of them,
       so that index cannot serve this. Without one it is a sequential scan over
       the table holding every image blob — the largest by bytes, and the one
       that grows on every visualisation whether a lead follows or not. */
    ['renders_ts_idx', 'renders (ts)'],
    ['access_log_ts_idx', 'access_log (ts)'],
    ['leads_ts_idx', 'leads (ts)'],
    /* The detection cache sweeps by age on every write, which was a sequential
       scan over every photograph measured in the last seven days. */
    ['detection_cache_ts_idx', 'detection_cache (ts)'],
    /* Read on every installer portal load, once per lead in the list, to say
       whether this installer has already decided about it. */
    ['lead_responses_lead_id_idx', 'lead_responses (lead_id)'],
  ];
  for (const [name, target] of indexes) {
    try {
      await pool.query(`CREATE INDEX IF NOT EXISTS ${name} ON ${SCHEMA_NAME}.${target}`);
    } catch (err) {
      /* An index is an optimisation, not a correctness guarantee — unlike the
         unique key above, which is why that one is separate. Losing one should
         never stop the service starting. */
      console.error(`Could not create index ${name}:`, err.message);
    }
  }
}

const TABLE_NAMES = { leads: 'leads', leadResponses: 'lead_responses', deliveries: 'deliveries', notificationFailures: 'notification_failures', accessLog: 'access_log', resumes: 'resumes', withdrawals: 'withdrawals', retentionRuns: 'retention_runs', quotes: 'quotes', waitlist: 'waitlist', feedback: 'feedback', detections: 'detections' };

const FILE_NAMES = { quotes: 'quotes.jsonl', waitlist: 'waitlist.jsonl', feedback: 'feedback.jsonl', detections: 'detections.jsonl', leads: 'leads.jsonl', deliveries: 'deliveries.jsonl', notificationFailures: 'notification-failures.jsonl', accessLog: 'access-log.jsonl', resumes: 'resumes.jsonl', withdrawals: 'withdrawals.jsonl', retentionRuns: 'retention-runs.jsonl', leadResponses: 'lead-responses.jsonl' };

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
  notificationFailures: `INSERT INTO ${SCHEMA_NAME}.notification_failures (ts, lead_id, kind, record) VALUES ($1,$2,$3,$4)`,
  leadResponses: `INSERT INTO ${SCHEMA_NAME}.lead_responses (ts, lead_id, installer_id, action, record) VALUES ($1,$2,$3,$4,$5)`
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
  notificationFailures: o => [o.ts, o.leadId || null, o.kind || null, JSON.stringify(o)],
  leadResponses: o => [o.ts, o.leadId || null, o.installerId || null, o.action || null, JSON.stringify(o)]
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
  notificationFailures: `SELECT record FROM ${SCHEMA_NAME}.notification_failures ORDER BY id ASC`,
  leadResponses: `SELECT record FROM ${SCHEMA_NAME}.lead_responses ORDER BY id ASC`
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
  /* Under Postgres the in-process queue is not enough.

     writeAll is DELETE-everything then reinsert. Two processes doing that to
     `leads` at once is not a lost update, it is an empty table: the second
     DELETE removes rows the first has already committed, and its reinsert only
     puts back what it read before the first one started. Every lead in the gap
     is gone, and with it the consent records that are the evidence of the
     lawful basis for everything already done with those people's details.

     One process was the assumption, and railway.json pins numReplicas to 1 to
     hold it — but a rolling deploy runs the old container and the new one at
     the same time by design, which is exactly when a retention run and a
     withdrawal are most likely to overlap. The assumption is not enforceable
     from inside the application.

     So the database arbitrates. An advisory lock keyed on the schema and
     table, taken inside the transaction that does the read and the write, so
     the whole read-modify-write is serialised across every process pointed at
     this database. It releases on commit or rollback without any unlocking
     code to forget, and it is scoped per table so retention on `leads` does
     not block a withdrawal writing to `withdrawals`.

     The JSONL path keeps the in-process queue, which is all a single
     development process needs and all it can have. */
  if (pool) {
    return withWriteLock(async () => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [SCHEMA_NAME, table]);

        const { rows } = await client.query(SELECT_SQL[table]);
        const next = await transform(shapeRows(table, rows));
        if (next === undefined) {
          await client.query('ROLLBACK');
          return null;
        }

        await client.query(`DELETE FROM ${SCHEMA_NAME}.${TABLE_NAMES[table]}`);
        for (const row of next) {
          await client.query(INSERT_SQL[table], INSERT_PARAMS[table](row));
        }
        await client.query('COMMIT');
        return next;
      } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* the connection may already be gone */ }
        throw err;
      } finally {
        client.release();
      }
    });
  }

  return withWriteLock(async () => {
    const rows = await readAll(table);
    const next = await transform(rows);
    if (next === undefined) return null;
    await writeAll(table, next);
    return next;
  });
}

async function replaceAll(table, rows) {
  /* Same reasoning as mutate: a bare replace is the destructive half on its
     own, so it takes the same lock. */
  return withWriteLock(() => writeAll(table, rows));
}

async function writeAll(table, rows) {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // The same cross-process lock mutate() takes — see the comment there.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [SCHEMA_NAME, table]);
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

/* ── THE FUNNEL ──
   Counters only. See the funnel table above for why it cannot identify anyone. */

const MEASUREMENT_FILE = 'measurements.jsonl';
const FUNNEL_FILE = 'funnel.json';
const funnelDay = () => new Date().toISOString().slice(0, 10);

async function countStage(stage) {
  const day = funnelDay();
  if (pool) {
    await pool.query(
      `INSERT INTO ${SCHEMA_NAME}.funnel (day, stage, hits) VALUES ($1,$2,1)
       ON CONFLICT (day, stage) DO UPDATE SET hits = ${SCHEMA_NAME}.funnel.hits + 1`,
      [day, stage]);
    return;
  }
  let all = {};
  try { all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, FUNNEL_FILE), 'utf8')); } catch (_) { /* first write */ }
  all[day] = all[day] || {};
  all[day][stage] = (all[day][stage] || 0) + 1;
  const tmp = path.join(DATA_DIR, FUNNEL_FILE + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, path.join(DATA_DIR, FUNNEL_FILE));
}

/* Totals per stage over a window of days. */
/* One upload's worth of evidence about how a house was measured.

   Deliberately not personal data and deliberately not a photograph: the shape
   of the door box the measurer used, how many it was offered, which method
   won, and the answer. A row cannot be tied to a person, a property or a
   session, which is why it can be kept without a retention period attached to
   somebody.

   In memory it would be useless — eighteen deploys in two days, and each one
   would have wiped it. The thresholds this exists to settle need hundreds of
   real uploads, which takes longer than any process here stays up. */
async function recordMeasurement(row) {
  const at = new Date().toISOString();
  const r = {
    ts: at,
    houseType: row?.houseType ?? null,
    doorRatio: Number.isFinite(row?.doorRatio) ? row.doorRatio : null,
    doorHeightPct: Number.isFinite(row?.doorHeightPct) ? row.doorHeightPct : null,
    doorBoxes: Number.isFinite(row?.doorBoxes) ? row.doorBoxes : 0,
    method: row?.method ?? null,
    m2: Number.isFinite(row?.m2) ? row.m2 : null,
  };
  if (pool) {
    await pool.query(
      `INSERT INTO ${SCHEMA_NAME}.measurement_observations
         (ts, house_type, door_ratio, door_height_pct, door_boxes, method, m2)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [r.ts, r.houseType, r.doorRatio, r.doorHeightPct, r.doorBoxes, r.method, r.m2]);
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.appendFileSync(path.join(DATA_DIR, MEASUREMENT_FILE), JSON.stringify(r) + '\n');
}

async function readMeasurements(limit = 1000) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT ts, house_type AS "houseType", door_ratio AS "doorRatio",
              door_height_pct AS "doorHeightPct", door_boxes AS "doorBoxes", method, m2
         FROM ${SCHEMA_NAME}.measurement_observations
        ORDER BY id DESC LIMIT $1`, [limit]);
    return rows;
  }
  try {
    return fs.readFileSync(path.join(DATA_DIR, MEASUREMENT_FILE), 'utf8')
      .trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-limit).reverse();
  } catch (_) { return []; }
}

async function readFunnel(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  if (pool) {
    const { rows } = await pool.query(
      `SELECT stage, SUM(hits)::int AS hits FROM ${SCHEMA_NAME}.funnel WHERE day >= $1 GROUP BY stage`, [since]);
    return Object.fromEntries(rows.map(r => [r.stage, r.hits]));
  }
  try {
    const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, FUNNEL_FILE), 'utf8'));
    const out = {};
    for (const [day, stages] of Object.entries(all)) {
      if (day < since) continue;
      for (const [stage, n] of Object.entries(stages)) out[stage] = (out[stage] || 0) + n;
    }
    return out;
  } catch (_) { return {}; }
}

/* ── DETECTIONS, KEYED BY THE PHOTOGRAPH ──
   See the detection_cache table for why this exists and what it deliberately
   does not hold. The JSONL path keeps one file, which is all a development
   machine needs and is wiped with the rest of data/ anyway. */

const CACHE_FILE = 'detection-cache.json';

async function getDetectionCache(hash, maxAgeMs) {
  if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) return null;   // a sha-256 or nothing
  const cutoff = Date.now() - maxAgeMs;
  if (pool) {
    const { rows } = await pool.query(
      `SELECT aspect_ratio AS "aspectRatio", detections, ts FROM ${SCHEMA_NAME}.detection_cache WHERE image_hash = $1`, [hash]);
    if (!rows[0]) return null;
    if (new Date(rows[0].ts).getTime() <= cutoff) return null;   // expired: treat as a miss
    return { aspectRatio: rows[0].aspectRatio, detections: rows[0].detections };
  }
  try {
    const all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, CACHE_FILE), 'utf8'));
    const hit = all[hash];
    if (!hit || new Date(hit.ts).getTime() <= cutoff) return null;
    return { aspectRatio: hit.aspectRatio, detections: hit.detections };
  } catch (_) { return null; }
}

async function putDetectionCache(hash, { detections, aspectRatio }, maxAgeMs) {
  if (!/^[a-f0-9]{64}$/.test(String(hash || ''))) return;
  const now = new Date().toISOString();
  const cutoff = new Date(Date.now() - maxAgeMs).toISOString();
  if (pool) {
    /* Swept on write rather than on a timer: no scheduler to forget, and the
       only moment the table grows is the only moment it needs trimming. */
    await pool.query(`DELETE FROM ${SCHEMA_NAME}.detection_cache WHERE ts <= $1`, [cutoff]);
    await pool.query(
      `INSERT INTO ${SCHEMA_NAME}.detection_cache (image_hash, ts, aspect_ratio, detections)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (image_hash) DO UPDATE SET ts = EXCLUDED.ts`,
      [hash, now, aspectRatio ?? null, JSON.stringify(detections)]);
    return;
  }
  let all = {};
  try { all = JSON.parse(fs.readFileSync(path.join(DATA_DIR, CACHE_FILE), 'utf8')); } catch (_) { /* first write */ }
  for (const [k, v] of Object.entries(all)) if (v.ts <= cutoff) delete all[k];
  all[hash] = { ts: now, aspectRatio: aspectRatio ?? null, detections };
  const tmp = path.join(DATA_DIR, CACHE_FILE + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(all));
  fs.renameSync(tmp, path.join(DATA_DIR, CACHE_FILE));
}

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

async function staleRenderIds(beforeIso) {
  if (pool) {
    const { rows } = await pool.query(
      `SELECT id FROM ${SCHEMA_NAME}.renders WHERE ts < $1`, [beforeIso]);
    return rows.map(r => r.id);
  }
  try {
    return fs.readdirSync(RENDER_DIR)
      .filter(f => f.endsWith('.json'))
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(RENDER_DIR, f), 'utf8')); } catch (_) { return null; } })
      .filter(m => m && m.ts && m.ts < beforeIso)
      .map(m => m.id);
  } catch (_) { return []; }
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

/* Leads are stored whole in the `design` JSONB column, so unwrap them —
   callers expect the same shape the JSONL path returns, not a row with a
   nested object. Anything without it falls back to the row itself.

   Its own function because mutate() reads on its own client, inside the
   locked transaction, and the two readers must not disagree about shape. */
function shapeRows(table, rows) {
  if (table === 'leads') return rows.map(r => r.design || r);
  if (table === 'deliveries' || table === 'notificationFailures' || table === 'accessLog' || table === 'retentionRuns' || table === 'withdrawals' || table === 'resumes' || table === 'leadResponses') return rows.map(r => r.record || r);
  return rows;
}

async function readAll(table) {
  if (pool) {
    const { rows } = await pool.query(SELECT_SQL[table]);
    return shapeRows(table, rows);
  }
  return readLines(FILE_NAMES[table]);
}

/* Let the pool go on shutdown, so Postgres isn't left holding sessions from
   a container that has already gone. No-op without a database. */
async function end() {
  if (pool) await pool.end();
}

module.exports = {
  ensureSchema, append, readAll, replaceAll, mutate, end, getResume, DATA_DIR, putRender, getRender, deleteRenders, staleRenderIds, hasDb: !!pool,
  getDetectionCache, putDetectionCache,
  countStage, readFunnel, recordMeasurement, readMeasurements,
  // Exported for tests: scraping these out of the source with a regex broke
  // the moment another table was added after leads.
  _internals: { INSERT_PARAMS, INSERT_SQL, SELECT_SQL, FILE_NAMES, checkServerIdentity },
};
