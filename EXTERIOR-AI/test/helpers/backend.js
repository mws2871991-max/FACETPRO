/* Seeding and clearing, on whichever backend the suite is running against.

   Three tests wrote fixtures straight into data/funnel.json and read them back
   through the store. On the JSONL backend that is the same file; on Postgres
   the store reads the funnel table and never sees the fixture — so CI's
   Postgres job failed them ("yesterday is missing") while the local run
   passed. countStage only ever writes today, so a two-day fixture cannot go
   through the public path; this writes it where the store will look.

   And every file shares one Postgres database, where each gets its own JSONL
   directory. A test that counts rows has to start from an empty table on
   Postgres, or it counts the other files' rows too. */

'use strict';

const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./data-dir');   // before store, which reads the path at load
const store = require('../../store');

const { SCHEMA_NAME } = store._internals;

/* Replace the whole funnel with { 'YYYY-MM-DD': { stage: hits } }, as the
   tests did by overwriting the file. */
async function seedFunnel(days) {
  const pool = store._internals.pool;
  if (pool) {
    await pool.query(`DELETE FROM ${SCHEMA_NAME}.funnel`);
    for (const [day, stages] of Object.entries(days)) {
      for (const [stage, hits] of Object.entries(stages)) {
        await pool.query(`INSERT INTO ${SCHEMA_NAME}.funnel (day, stage, hits) VALUES ($1,$2,$3)`, [day, stage, hits]);
      }
    }
    return;
  }
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(path.join(DATA_DIR, 'funnel.json'), JSON.stringify(days));
}

/* Empty the measurement observations. A no-op on JSONL, where each test file
   already starts with its own empty directory. */
async function clearMeasurements() {
  const pool = store._internals.pool;
  if (pool) await pool.query(`DELETE FROM ${SCHEMA_NAME}.measurement_observations`);
}

module.exports = { seedFunnel, clearMeasurements };
