/* Orphan renders — images stored with lead_id null because putRender never
   receives a leadId, so "past its period and unreferenced" cannot be decided
   by the column. It has to be decided by cross-referencing leads' renderUrl
   against the render's age instead. This checks that cross-reference through
   runRetention itself, not the pure planning function, because the two bugs
   worth catching are both about wiring rather than arithmetic:

   1. A render a live lead still points at must survive even though it is
      just as old as one that gets purged — the naive "lead_id IS NULL"
      query would have deleted both.
   2. The sweep has to run on a day when no lead itself is due for redaction
      or deletion, because runRetention returns early in that case. A sweep
      placed after that guard would never fire in this test, since the fixture
      here has no lead at all.

   Authored directly against the code in this package — not a file that was
   handed over separately. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3211;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);

const store = require('../store');
const { _internals } = require('../server');
const retention = require('../retention');

before(async () => { await require('./helpers/server-ready')(BASE); });

const DAY = 24 * 60 * 60 * 1000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);

/* putRender always stamps ts = now; back-date it afterwards so the fixture can
   claim to be older than orphanRenderDays.

   Both backends, deliberately. An earlier version of this helper returned early
   when store.hasDb, on the assumption that Postgres was covered elsewhere. It
   was not, and the omission was worse than a gap: with no back-dating the
   render stayed fresh, so the two "must survive" tests passed for the wrong
   reason and only the purge test failed. Postgres is the sole backend
   production ever uses — refuseToStartIfStorageContradictsTheNotice requires
   DATABASE_URL on any deployment — so the SQL branch of staleRenderIds is the
   one that has to be proven, not the fallback. */
async function putRenderAged(id, days) {
  await store.putRender(id, bytes, { mime: 'image/png' });

  if (store.hasDb) {
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.DATABASE_URL });
    await c.connect();
    try {
      const schema = (process.env.DB_SCHEMA || 'facetpro_visualiser').replace(/[^a-zA-Z0-9_]/g, '');
      const { rowCount } = await c.query(
        `UPDATE ${schema}.renders SET ts = $1 WHERE id = $2`, [ago(days), id]);
      assert.strictEqual(rowCount, 1, `fixture did not back-date render ${id}`);
    } finally {
      await c.end();
    }
    return;
  }

  const metaPath = path.join(store.DATA_DIR, 'renders', id + '.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.ts = ago(days);
  fs.writeFileSync(metaPath, JSON.stringify(meta));
}

const beyondOrphan = retention.PERIODS.orphanRenderDays + 30;
const withinOrphan = retention.PERIODS.orphanRenderDays - 30;

test('an old render no surviving lead points at is purged', async () => {
  const id = 'orph' + Date.now().toString(16);
  await putRenderAged(id, beyondOrphan);
  await store.replaceAll('leads', []); // no lead at all — the early-return trap

  await _internals.runRetention();

  assert.strictEqual(await store.getRender(id), null,
    'an unreferenced render past orphanRenderDays should have been deleted');
});

test('an old render a live lead still references via renderUrl is kept', async () => {
  const id = 'refd' + Date.now().toString(16);
  await putRenderAged(id, beyondOrphan);
  await store.replaceAll('leads', [{
    id: 'LD-RETREND1',
    ts: ago(1), // recent lead — not itself due for redaction or deletion
    name: 'Jane Smith', email: 'jane@example.com', phone: '07700900000', postcode: 'SW11 4NP',
    status: 'New lead',
    renderUrl: `/r/${id}`,
    consent: { terms: true, installerQuotes: true, at: ago(1) },
  }]);

  await _internals.runRetention();

  const back = await store.getRender(id);
  assert.ok(back, 'a render a live lead still references must survive retention');
});

test('a render still inside its period is kept regardless of references', async () => {
  const id = 'freh' + Date.now().toString(16);
  await putRenderAged(id, withinOrphan);
  await store.replaceAll('leads', []);

  await _internals.runRetention();

  const back = await store.getRender(id);
  assert.ok(back, 'a render inside orphanRenderDays should not be touched');
});
