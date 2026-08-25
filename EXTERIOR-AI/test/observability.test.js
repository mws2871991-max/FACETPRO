/* Knowing when something has broken.

   Before this there were thirty-seven console.error sites and no way to read
   any of them without a platform log viewer. That is not hypothetical: the
   Replicate `Prefer: wait=90` header refused every render the application
   ever attempted, and it surfaced only because somebody happened to be
   watching a log at the moment it failed. The information existed. Nobody was
   looking.

   Two things are tested here, and the second matters more than it looks.

   That failures are recorded at all — an operator can ask "is anything
   broken" and get an answer.

   And that the answer contains no personal data. An operational log is read
   casually, pasted into messages, and left open on screens. Error messages
   interpolate the input that caused them, so a homeowner's email address ends
   up inside a string somebody throws. If this endpoint leaks one, it is worse
   than not having it — a place personal data goes that the privacy notice
   never mentions and retention never reaches. */

'use strict';

require('./helpers/data-dir');

const { test, beforeEach } = require('node:test');
const assert = require('node:assert');
const obs = require('../observability');

beforeEach(() => obs.reset());

test('a failure is recorded and comes back in the summary', () => {
  obs.record('render', 'Replicate refused the render', { status: 422 });
  const s = obs.summary();
  assert.strictEqual(s.totalRecorded, 1);
  assert.strictEqual(s.byKind[0].kind, 'render');
  assert.strictEqual(s.recent[0].detail.status, 422);
});

test('counts survive the ring filling up', () => {
  /* The ring is bounded so a crash loop cannot exhaust memory. The counts
     must not be bounded with it, or "this has happened 4,000 times" becomes
     "this has happened 200 times" and the thing looks less urgent than it
     is. */
  for (let i = 0; i < obs.MAX_EVENTS + 50; i++) obs.record('detect', 'failure ' + i);
  const s = obs.summary({ limit: obs.MAX_EVENTS });
  assert.strictEqual(s.recent.length, obs.MAX_EVENTS, 'the ring grew past its bound');
  assert.strictEqual(s.byKind[0].count, obs.MAX_EVENTS + 50, 'the count was truncated with the ring');
});

test('newest first, because that is what you came to see', () => {
  obs.record('a', 'older');
  obs.record('b', 'newer');
  assert.strictEqual(obs.summary().recent[0].message, 'newer');
});

test('an email address in an error message is scrubbed', () => {
  obs.record('request', 'could not send to jane.smith@example.com — bounced');
  const m = obs.summary().recent[0].message;
  assert.ok(!/jane\.smith@example\.com/.test(m), 'an email address reached the ops log: ' + m);
  assert.match(m, /\[email\]/);
});

test('a postcode and a phone number are scrubbed', () => {
  obs.record('request', 'no coverage for SW11 4NP, tried 07700900000');
  const m = obs.summary().recent[0].message;
  assert.ok(!/SW11\s*4NP/i.test(m), 'a postcode reached the ops log: ' + m);
  assert.ok(!/07700900000/.test(m), 'a phone number reached the ops log: ' + m);
});

test('an API key pasted into an error is scrubbed', () => {
  /* Upstream clients put the request in the message often enough that this is
     worth having — and a key in an operational log outlives the log. */
  for (const secret of ['sk-ant-abcd1234efgh', 'r8_ABCDEFGH1234', 're_test_abcdef123']) {
    obs.reset();
    obs.record('detect', 'auth failed using ' + secret);
    const m = obs.summary().recent[0].message;
    assert.ok(!m.includes(secret), 'a credential reached the ops log: ' + m);
  }
});

test('personal fields in the detail object are redacted by name', () => {
  obs.record('delivery', 'webhook rejected the lead', {
    status: 500, recipientId: 'anglian', email: 'jane@example.com', postcode: 'SW11 4NP', name: 'Jane',
  });
  const d = obs.summary().recent[0].detail;
  assert.strictEqual(d.status, 500, 'the useful field was dropped');
  assert.strictEqual(d.recipientId, 'anglian', 'a non-personal field was redacted');
  for (const k of ['email', 'postcode', 'name']) {
    assert.strictEqual(d[k], '[redacted]', `${k} was not redacted`);
  }
});

test('the summary says out loud that it does not survive a restart', () => {
  /* The live service has no volume, so this is memory only. A summary that
     looks like a history and is not would be another claim with nothing
     behind it — which is the failure this whole file exists to catch. */
  assert.match(obs.summary().retention, /in memory only/i);
});

/* "The ops endpoint is behind the installer password" used to be asserted here
   by reading server.js and matching a regex against its source. It is gone, not
   moved, and the property is not less covered for it.

   It broke the moment /api/ops was extracted to routes/ops.js — the route was
   still guarded, still refused, still rate limited, and the test failed anyway,
   because what it actually asserted was which file a string lives in. This
   codebase already knows the pattern; store.js says of the same trick that
   "scraping these out of the source with a regex broke the moment another table
   was added".

   test/ops-endpoint.test.js asserts the same property the way it is worth
   asserting: against a running server, with a wrong password, with no password,
   and sixty times in a row to prove the limiter bites. A 401 from a real
   request cannot be satisfied by a file that merely looks right. */

test('a render that could not be kept is recorded, not just logged', () => {
  /* Both halves of it. The fetch failing is the provider or the network; the
     store failing is our database. Counting them as one number cannot tell an
     operator which of the two to go and fix, and they are fixed in different
     places. */
  const fs = require('fs');
  const path = require('path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /obs\.record\('render',\s*'could not fetch the render from the provider'/,
    'a failed fetch from the provider is logged but not counted');
  assert.match(server, /obs\.record\('render',\s*'fetched the render but could not store it'/,
    'a failed store is logged but not counted');
});

test('a render we could not keep is never handed back as a provider URL', () => {
  /* The privacy consequence, pinned in a test because it is the kind of thing
     that gets put back to spare a homeowner an error.

     Handing over Replicate's URL leaves a photorealistic image of an
     identified person's home at an unauthenticated address we cannot delete,
     while the notice says the generated image goes when the lead does. The
     CSP allowance existed only to display it, so it goes too — and if either
     ever comes back, this fails. */
  const fs = require('fs');
  const path = require('path');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

  const keep = server.slice(server.indexOf('async function keepRender'), server.indexOf('async function respondWithRender'));
  assert.ok(keep.length > 0, 'keepRender has moved — this test is checking nothing');
  assert.ok(!/return\s*{\s*url:\s*replicateUrl/.test(keep),
    'keepRender hands the provider URL back to the browser when it cannot take a copy');
  assert.match(keep, /throw new RenderNotKept/, 'keepRender no longer fails loudly');

  const csp = server.slice(server.indexOf('const CSP_APP'), server.indexOf('const CSP_LEGAL'));
  assert.ok(!/replicate\.delivery/.test(csp),
    'the CSP still lets the page load images straight from the provider');
});

test('timings report the tail, not just the middle', () => {
  /* The homepage said "<60s photo to itemised estimate" and nothing measured
     it. A mean would have hidden the tail, and the tail is what somebody
     waiting on a spinner actually experiences — so median, p90 and slowest. */
  obs.reset && obs.reset();
  [820, 940, 1100, 1500, 3200].forEach(ms => obs.time('detect_request', ms));
  const t = obs.timingSummary().detect_request;
  assert.strictEqual(t.samples, 5);
  assert.strictEqual(t.medianMs, 1100);
  assert.strictEqual(t.slowestMs, 3200);
});

test('a timing that is not a number is ignored rather than recorded as one', () => {
  obs.reset && obs.reset();
  ['', null, undefined, NaN, -1, 'soon'].forEach(v => obs.time('detect_request', v));
  assert.deepStrictEqual(obs.timingSummary(), {},
    'a bad sample must not become a plausible-looking figure');
});

test('nothing measured means nothing reported', () => {
  /* Not defaulted to zero or to a placeholder: the point of the block this
     replaces is that a number there has been observed. */
  obs.reset && obs.reset();
  assert.deepStrictEqual(obs.summary({ limit: 1 }).timings, {});
});
