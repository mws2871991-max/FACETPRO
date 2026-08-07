/* The storage path that will actually run.

   Every other integration test here talks to the JSONL backend. But
   refuseToStartIfStorageContradictsTheNotice requires DATABASE_URL on any
   deployment, so **Postgres is the only backend that will ever run in
   production, and it was the only one with no coverage at all**. Several
   hundred green tests proving a code path nobody will execute.

   What differs between the two backends is not incidental:

     mutate()      a real transaction, with a real ROLLBACK
     leads         stored whole in a JSONB column and unwrapped on read
     lead_id       a unique index added by ALTER against a live table
     getResume     an indexed lookup that returns undefined on JSONL
     renders       bytea rather than a pair of files
     deleteRenders rowCount rather than a count we keep ourselves

   Skipped, loudly, when DATABASE_URL is unset — so a developer without a
   database sees why rather than a false green. CI supplies one.

   These tests DELETE. replaceAll truncates a table by design, which is fine
   against a throwaway container and catastrophic against anything else, so
   there is a guard below that refuses to touch a database that does not
   announce itself as disposable. */

'use strict';

require('./helpers/data-dir');

const { test, before, after } = require('node:test');
const assert = require('node:assert');

const url = process.env.DATABASE_URL;

/* Would you be happy if this table were emptied? The suite only proceeds when
   the answer is obviously yes: a database named for testing, on localhost, or
   an explicit opt-in. Nothing here should ever be able to run against the
   Railway database that also holds the FastAPI backend's tables. */
function looksDisposable(connection) {
  if (process.env.FACETPRO_ALLOW_DESTRUCTIVE_DB_TESTS === 'yes') return true;
  let parsed;
  try { parsed = new URL(connection); } catch (_) { return false; }
  const localhost = ['localhost', '127.0.0.1', '::1', 'postgres'].includes(parsed.hostname);
  const named = /test/i.test(parsed.pathname);
  return localhost && named;
}

const skip = !url
  ? 'DATABASE_URL is not set — run the suite with a Postgres to cover the backend that runs live'
  : !looksDisposable(url)
    ? 'DATABASE_URL does not look disposable — these tests DELETE, so they refuse anything but a local database named for testing'
    : false;

if (skip) console.warn(`\n  Postgres integration tests SKIPPED: ${skip}\n`);

const store = skip ? null : require('../store');
const opts = { skip };

before(async () => { if (!skip) await store.ensureSchema(); });
after(async () => { if (!skip) await store.end(); });

const lead = (id, extra = {}) => ({
  ts: new Date().toISOString(), id, name: 'Jane', email: 'jane@example.com',
  phone: '07700900000', postcode: 'SW11 4NP', status: 'New lead',
  consent: { terms: true, installerQuotes: true, at: new Date().toISOString(), wording: { terms: 'I agree…' } },
  ...extra,
});

test('the schema builds, including the parts added by ALTER', opts, async () => {
  /* ensureSchema runs CREATE TABLE IF NOT EXISTS and then ALTERs leads to add
     lead_id and its unique index — because the tables it needs to reach
     already exist on any database that has been used. That path only executes
     against Postgres and had never been run by a test. */
  await store.ensureSchema();          // twice: it has to be idempotent
  const rows = await store.readAll('leads');
  assert.ok(Array.isArray(rows));
});

test('a lead survives the round trip whole', opts, async () => {
  /* The scalar columns are for querying; the whole lead lives in a JSONB
     column and is unwrapped on read. This used to pass o.design — a key no
     lead has ever had — silently dropping thirteen fields including the
     consent record, which is the evidence of lawful basis. */
  await store.replaceAll('leads', []);
  const original = lead('LD-ROUNDTRIP');
  await store.append('leads', original);
  const [back] = await store.readAll('leads');
  assert.deepStrictEqual(back, original, 'a field was lost between here and the database');
  assert.strictEqual(back.consent.wording.terms, 'I agree…');
});

test('mutate is a transaction, and a failure rolls all of it back', opts, async () => {
  /* The JSONL backend writes to a temp file and renames, so a half-written
     store is impossible there. Postgres gets a DELETE and a loop of INSERTs,
     which is only safe because it is wrapped in BEGIN/COMMIT — and nothing
     had ever proved the ROLLBACK. */
  await store.replaceAll('leads', [lead('LD-KEEP1'), lead('LD-KEEP2')]);

  await assert.rejects(
    store.mutate('leads', () => { throw new Error('boom'); }),
    /boom/);

  const after = await store.readAll('leads');
  assert.deepStrictEqual(after.map(l => l.id).sort(), ['LD-KEEP1', 'LD-KEEP2'],
    'the table was emptied by a mutation that threw');
});

test('a mutation that fails midway leaves nothing half-applied', opts, async () => {
  await store.replaceAll('leads', [lead('LD-A'), lead('LD-B')]);
  await assert.rejects(store.mutate('leads', (rows) => {
    // A row the insert cannot serialise: the DELETE has already run by the
    // time this fails, so only a real transaction saves the table.
    const bad = { ...rows[0], id: 'LD-C' };
    bad.self = bad;                     // circular — JSON.stringify throws
    return [...rows, bad];
  }));
  const after = await store.readAll('leads');
  assert.strictEqual(after.length, 2, 'the DELETE stood while the INSERTs failed');
});

test('the database refuses two leads with one reference', opts, async () => {
  /* The application generates 60 bits of entropy per reference, so this
     should never fire. That is exactly the class of assumption worth having
     the database enforce: lead.id is the join key for withdrawal, retention
     and erasure, and a duplicate means one homeowner's erasure takes
     another's record with it. */
  await store.replaceAll('leads', []);
  await store.append('leads', lead('LD-UNIQUE'));
  await assert.rejects(store.append('leads', lead('LD-UNIQUE')),
    (err) => /duplicate key|unique/i.test(err.message),
    'the unique index on lead_id is not doing anything');
});

test('a resume code is found by its index, not by reading every row', opts, async () => {
  // getResume returns undefined on JSONL, which has no index, so the caller
  // falls back. Against Postgres it must actually return the row.
  await store.replaceAll('resumes', []);
  const record = {
    ts: new Date().toISOString(), code: 'ABC123',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    design: { claddingId: 'sage-slate', windowCount: 9 },
  };
  await store.append('resumes', record);

  const found = await store.getResume('ABC123');
  assert.ok(found, 'the indexed lookup found nothing');
  assert.deepStrictEqual(found.design, record.design);
  assert.strictEqual(await store.getResume('ZZZZZZ'), null, 'a miss should be null, not undefined');
});

test('renders are bytes in a column, and come back as the same bytes', opts, async () => {
  const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8, 255, 0, 128]);
  await store.putRender('pgtest01', bytes, { mime: 'image/png' });
  const back = await store.getRender('pgtest01');
  assert.ok(back, 'nothing came back');
  assert.strictEqual(back.mime, 'image/png');
  assert.ok(Buffer.from(back.bytes).equals(bytes), 'bytea round trip changed the image');
});

test('deleting renders counts renders, the same as the file backend does', opts, async () => {
  /* The two backends disagreed here once: the file path counted a .bin and a
     .json as two, Postgres returns rows. The number goes into the retention
     record, which is the evidence for "we delete on schedule". */
  await store.putRender('pgtest02', Buffer.from([1, 2, 3]), { mime: 'image/png' });
  await store.putRender('pgtest03', Buffer.from([4, 5, 6]), { mime: 'image/png' });
  assert.strictEqual(await store.deleteRenders(['pgtest02', 'pgtest03']), 2);
  assert.strictEqual(await store.deleteRenders(['pgtest02']), 0, 'gone means gone');
});

test('our tables live in their own schema, never in public', opts, async () => {
  /* The obvious database to point this at already belongs to the FastAPI
     backend, and seven of these table names exist there with entirely
     different columns. */
  const { _internals } = store;
  for (const sql of Object.values(_internals.INSERT_SQL)) {
    assert.match(sql, /INSERT INTO [a-z_]+\.[a-z_]+/, `unqualified table name: ${sql.slice(0, 60)}`);
  }
  assert.ok(!/INSERT INTO public\./.test(Object.values(_internals.INSERT_SQL).join(' ')));
});

test('the indexes the deadline-bound paths depend on exist', opts, async () => {
  /* There was one index in the whole store — the unique key on leads.lead_id —
     and everything else was a sequential scan. Invisible at hundreds of rows,
     and not a performance nicety later: the paths that scan are withdrawal,
     erasure and the retention run, which are the ones with a statutory month
     attached and which grow with every lead ever taken. */
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  await c.connect();
  const { rows } = await c.query(
    `SELECT indexname FROM pg_indexes WHERE schemaname = current_setting('search_path') OR schemaname = $1`,
    [process.env.DB_SCHEMA || 'facetpro_visualiser']);
  await c.end();

  const have = new Set(rows.map(r => r.indexname));
  for (const name of [
    'deliveries_lead_id_idx',
    'notification_failures_lead_id_idx',
    'withdrawals_lead_id_idx',
    'renders_lead_id_idx',
    'access_log_ts_idx',
    'leads_ts_idx',
  ]) {
    assert.ok(have.has(name), `missing index ${name} — erasure joins across these tables`);
  }
});

test('two processes rewriting the same table cannot erase each other', opts, async () => {
  /* writeAll is DELETE-everything then reinsert. Two processes doing that to
     leads at once is not a lost update, it is an empty table: the second
     DELETE removes rows the first has committed, and its reinsert only puts
     back what it read before the first one started.

     numReplicas is 1 to prevent that, but a rolling deploy runs the old
     container and the new one at the same time by design — which is exactly
     when a retention run and a withdrawal overlap. So the database arbitrates,
     with an advisory lock held across the read and the write.

     One store module cannot be two processes, but it can be two connections
     racing through the same code path, which is what the lock has to
     serialise. Without it the two interleave and one set of rows is lost. */
  await store.replaceAll('leads', []);
  await store.append('leads', lead('BASE-1'));

  await Promise.all([
    store.mutate('leads', async (rows) => {
      await new Promise(r => setTimeout(r, 60));      // widen the window
      return [...rows, lead('FROM-A')];
    }),
    store.mutate('leads', async (rows) => {
      await new Promise(r => setTimeout(r, 10));
      return [...rows, lead('FROM-B')];
    }),
  ]);

  const ids = (await store.readAll('leads')).map(r => r.id).sort();
  assert.deepStrictEqual(ids, ['BASE-1', 'FROM-A', 'FROM-B'],
    'one of the two rewrites overwrote the other — a lost lead is a lost consent record');
});

test('the read and the write happen under one lock, not two', () => {
  /* Taking the lock inside writeAll alone would still leave the read outside
     it, which is the whole race. Asserted on the source because the ordering
     is the point and a passing concurrency test does not prove it. */
  const fs = require('fs');
  const path = require('path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'store.js'), 'utf8');
  const mutateBody = src.slice(src.indexOf('async function mutate'), src.indexOf('async function replaceAll'));

  const lockAt = mutateBody.indexOf('pg_advisory_xact_lock');
  const readAt = mutateBody.indexOf('SELECT_SQL[table]');
  const writeAt = mutateBody.indexOf('DELETE FROM');

  assert.ok(lockAt > -1, 'mutate does not take the advisory lock');
  assert.ok(readAt > lockAt, 'mutate reads before taking the lock — the race is still open');
  assert.ok(writeAt > readAt, 'mutate writes before it reads');
});
