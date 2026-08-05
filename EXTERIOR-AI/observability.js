/* Somewhere for failures to go, and one place to look at them.

   There were thirty-seven console.error sites before this file and no way to
   see any of them without opening a platform log viewer and knowing what to
   search for. That is not a gap in theory. Three bugs this week were invisible
   until somebody read code:

     the Replicate `Prefer: wait=90` header, which refused every render the
     application ever attempted and surfaced as a generic 422;

     a .no-js CSS rule guarded by a class nothing ever set;

     a Postgres CI job that had been red for days.

   The first of those was live for the entire history of the codebase. It was
   found within minutes of somebody watching at the moment it failed, which is
   the whole point: the information existed and nobody was looking.

   What this deliberately is NOT:

     Not a third-party error service. Sending exceptions to a US processor
     would add an Article 28 processor and an international transfer to name
     in a privacy notice that is not finished, to solve a problem one endpoint
     solves. That trade is wrong at this size.

     Not persistent. The live service has no volume, so anything written to
     disk dies with the container. A ring in memory is honest about what it
     is; pretending otherwise would be another claim with nothing behind it.
     When a volume or DATABASE_URL exists, persist it and say so.

   What it is: a bounded ring of recent failures, counters that survive the
   ring filling up, and a summary an operator can read in one request. */

'use strict';

const MAX_EVENTS = 200;

/* Field names that carry a person rather than a fault. A stack trace can
   contain a query string, an error message can contain an email somebody
   typed, and neither belongs in an operational log that exists to be read
   casually. Belt and braces over the scrubber below. */
const PERSONAL = /\b(name|email|phone|postcode|address|token|password|authorization|dsn|key)\b/i;

const started = Date.now();
const events = [];
const counts = Object.create(null);
const firstSeen = Object.create(null);
const lastSeen = Object.create(null);

/* An email address or a UK postcode appearing in free text — an error message
   is written by whoever threw it, and some of them interpolate the input. */
const scrubText = (s) => String(s == null ? '' : s)
  .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '[email]')
  .replace(/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/gi, '[postcode]')
  .replace(/\b(?:\+?44|0)\s?7\d{3}\s?\d{6}\b/g, '[phone]')
  .replace(/\b(sk-[A-Za-z0-9_-]{8,}|r8_[A-Za-z0-9]{8,}|re_[A-Za-z0-9_]{8,})/g, '[secret]');

function scrubDetail(detail) {
  if (!detail || typeof detail !== 'object') return undefined;
  const out = {};
  for (const [k, v] of Object.entries(detail)) {
    if (PERSONAL.test(k)) { out[k] = '[redacted]'; continue; }
    if (v == null) continue;
    if (typeof v === 'object') continue;              // no nesting: keep these flat and readable
    out[k] = typeof v === 'string' ? scrubText(v).slice(0, 200) : v;
  }
  return Object.keys(out).length ? out : undefined;
}

/* kind is the thing you would group by when deciding what to fix first:
   'render', 'detect', 'delivery', 'storage', 'request', 'crash'. */
function record(kind, message, detail) {
  const k = String(kind || 'unknown');
  counts[k] = (counts[k] || 0) + 1;
  const at = new Date().toISOString();
  lastSeen[k] = at;
  if (!firstSeen[k]) firstSeen[k] = at;

  events.push({ at, kind: k, message: scrubText(message).slice(0, 300), detail: scrubDetail(detail) });
  /* Oldest out. Two hundred is enough to see a pattern and small enough that
     a crash loop cannot exhaust memory before the platform restarts us. */
  while (events.length > MAX_EVENTS) events.shift();
}

/* Everything an operator wants in one place, and nothing that identifies a
   homeowner. Newest first, because that is what you came to see. */
function summary({ limit = 50 } = {}) {
  const byKind = Object.keys(counts).sort((a, b) => counts[b] - counts[a]).map(k => ({
    kind: k, count: counts[k], firstSeen: firstSeen[k], lastSeen: lastSeen[k],
  }));
  return {
    uptimeSeconds: Math.round((Date.now() - started) / 1000),
    startedAt: new Date(started).toISOString(),
    totalRecorded: Object.values(counts).reduce((a, b) => a + b, 0),
    /* Said out loud, because a summary that looks complete and is not is
       worse than none: this is what the running process has seen since it
       started, not a history. A deploy resets it. */
    retention: 'in memory only; the last ' + MAX_EVENTS + ' events since this process started',
    byKind,
    recent: events.slice(-limit).reverse(),
  };
}

const reset = () => { events.length = 0; for (const k of Object.keys(counts)) { delete counts[k]; delete firstSeen[k]; delete lastSeen[k]; } };

module.exports = { record, summary, reset, MAX_EVENTS, _internals: { scrubText, scrubDetail } };
