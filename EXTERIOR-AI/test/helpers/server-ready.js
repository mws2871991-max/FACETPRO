/* Wait until the server is actually accepting connections.

   Every server-based test file used to `require('../server')` and fetch on the
   next line. That worked for months because start() resolves within a tick
   against the JSONL backend — there is nothing to set up. It was never
   correct; it was fast enough not to matter.

   Against Postgres it matters. start() has to ensureSchema() before it
   listens: CREATE SCHEMA, several CREATE TABLE, an ALTER on leads and a unique
   index, over a network connection. The first fetch arrives long before the
   socket exists and fails, and it does so 131 times across the suite, all
   reading `fetch failed` — which looks like a broken server and is really a
   race the tests were winning by luck.

   That is the backend that runs in production. refuseToStartIfStorageContra-
   dictsTheNotice requires DATABASE_URL on any deployment, so every endpoint
   that writes a lead was covered only against a backend nobody deploys.

   Awaiting the exported promise is not sufficient on its own: it resolves when
   start() returns, and what a test needs is a port that answers. So await it
   and then poll — the promise removes almost all the waiting, and the poll
   removes the assumption. */

'use strict';

module.exports = async function serverReady(base, attempts = 200, waitMs = 25) {
  const { ready } = require('../../server');
  // A file that requires the server without this helper still works; the
  // export is only ever a shortcut to the same state the poll would find.
  if (ready) await ready;

  for (let i = 0; i < attempts; i++) {
    try {
      await fetch(base + '/healthz');
      return;
    } catch (_) {
      await new Promise(r => setTimeout(r, waitMs));
    }
  }
  throw new Error(
    `server did not accept a connection on ${base} within ${attempts * waitMs}ms`);
};
