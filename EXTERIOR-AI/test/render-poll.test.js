/* The render must give up before the server hangs up on it.

   Prefer: wait=60 could hold the initial request for a minute, and the poll
   loop then slept forty-five times for two seconds — a hundred and fifty
   seconds against a requestTimeout of a hundred and twenty. The socket was
   closed under the handler, so the 504 written for the homeowner was never
   the thing they saw; they got a dropped connection.

   Three more things went unchecked in that loop. Poll requests had no timeout
   of their own — Node's fetch has none by default — so one hung connection
   held the request open until the socket died. Nothing looked at poll.ok, so a
   429 or a 500 parsed into an object with no status field, matched neither
   branch, and the loop went round again for the full ninety seconds against a
   provider that was refusing us. And 'canceled' is a terminal state that was
   treated as "not finished yet".

   Each of those is a homeowner watching a spinner for a minute and a half and
   then seeing nothing useful. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3126;
const BASE = `http://127.0.0.1:${PORT}`;

/* What Replicate does, decided per test. */
let onPoll = null;
let pollCount = 0;

const renderOutput = require('./helpers/render-output');
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.includes('api.replicate.com') && opts?.method === 'POST') {
    /* Accepted, still running — which is what sends us into the poll loop. */
    return { ok: true, status: 201, json: async () => ({ id: 'pred-test', status: 'processing' }) };
  }
  if (u.includes('api.replicate.com/v1/predictions/')) {
    pollCount++;
    return onPoll(pollCount, opts);
  }
  /* The provider's output URL, serving bytes the way the real one does —
     the render is only a success once we have taken a copy of it. */
  if (renderOutput.isRenderOutput(u)) return renderOutput.response();
  return realFetch(url, opts);
};

process.env.PORT = String(PORT);
process.env.REPLICATE_API_TOKEN = 'r8_test_stub';
process.env.DAILY_RENDER_LIMIT = '500';

require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

function jpeg(width = 640, height = 480) {
  const sof = Buffer.alloc(11);
  sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(8, 2); sof[4] = 8;
  sof.writeUInt16BE(height, 5); sof.writeUInt16BE(width, 7);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), sof, Buffer.alloc(64)]).toString('base64');
}

let seq = 0;
const render = () => realFetch(`${BASE}/api/render`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ image: jpeg(640 + (++seq)), mimeType: 'image/jpeg', claddingName: 'Alabaster' }),
});

test('a cancelled prediction is answered at once, not waited out', async () => {
  pollCount = 0;
  onPoll = async () => ({ ok: true, status: 200, json: async () => ({ id: 'pred-test', status: 'canceled' }) });

  const started = Date.now();
  const res = await render();
  const took = Date.now() - started;

  assert.strictEqual(res.status, 502, 'a cancelled render should be reported, not polled to the deadline');
  assert.ok(took < 20_000, `took ${took}ms — a terminal state was treated as still running`);
  assert.strictEqual(pollCount, 1, `polled ${pollCount} times for a prediction that had already stopped`);
});

test('a provider that keeps refusing is given up on', async () => {
  /* A 429 used to parse into an object with no status field and fall through
     both branches, so the loop rode it out in silence. */
  pollCount = 0;
  onPoll = async () => ({ ok: false, status: 429, json: async () => ({ detail: 'rate limited' }) });

  const started = Date.now();
  const res = await render();
  const took = Date.now() - started;

  assert.strictEqual(res.status, 502);
  assert.ok(took < 30_000, `took ${took}ms — a refusing provider should not be polled to the deadline`);
  assert.ok(pollCount <= 4, `polled ${pollCount} times through a solid wall of 429s`);
});

test('a run of unreachable polls does not become a lost request', async () => {
  pollCount = 0;
  onPoll = async () => { throw new Error('ECONNREFUSED'); };

  const res = await render();
  assert.strictEqual(res.status, 502);
  assert.ok(pollCount <= 4, `retried ${pollCount} times against a connection that was refused`);
});

test('a single hiccup is ridden out rather than failing the render', async () => {
  /* The prediction is still running at the other end, so one bad poll must
     not throw away a render the homeowner is waiting for. */
  pollCount = 0;
  onPoll = async (n) => {
    if (n === 1) throw new Error('ECONNRESET');
    if (n === 2) return { ok: false, status: 502, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ id: 'pred-test', status: 'succeeded', output: 'https://replicate.delivery/x.jpg' }) };
  };

  const res = await render();
  /* Was "200 or 502", which passed whatever happened and would have gone on
     passing if the retry were deleted. The provider's output URL now serves
     bytes, so riding out a hiccup has one correct outcome: the render. */
  assert.strictEqual(res.status, 200, `a single hiccup lost the render: ${res.status}`);
  assert.ok(pollCount >= 3, 'the loop gave up on the first hiccup instead of retrying');
});

test('each poll is given a timeout of its own', () => {
  /* Node's fetch has no default timeout, so a hung connection held the whole
     request open until the socket died. Asserted on the source because a hung
     socket is not something a test can conjure reliably. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const loop = src.slice(src.indexOf('Poll until the deadline'), src.indexOf('Render timed out'));
  assert.match(loop, /AbortController/, 'the poll fetch has no AbortController');
  assert.match(loop, /signal:\s*pollController\.signal/, 'the poll fetch does not pass its abort signal');
  assert.match(loop, /clearTimeout\(pollTimeout\)/, 'the poll timeout is never cleared');
});

test('the render deadline is inside the server timeout, with room to spare', () => {
  /* The two used to disagree by thirty seconds in the wrong direction. */
  const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const deadline = Number(src.match(/RENDER_DEADLINE_MS\s*=\s*([\d_]+)/)[1].replace(/_/g, ''));
  const requestTimeout = Number(src.match(/server\.requestTimeout\s*=\s*([\d_]+)/)[1].replace(/_/g, ''));

  assert.ok(deadline < requestTimeout,
    `the render polls for ${deadline}ms against a requestTimeout of ${requestTimeout}ms — the socket closes first`);
  assert.ok(requestTimeout - deadline >= 15_000,
    'too little headroom left to store the image and answer after the last poll');
});

test('a render we cannot take a copy of is an error, not a provider URL', async () => {
  /* The privacy trade, exercised end to end rather than asserted on the
     source. When the copy fails the homeowner gets an error and a suggestion
     to try again — what they must NOT get is Replicate's own URL, which would
     leave a photorealistic image of an identified home at an unauthenticated
     address we cannot delete, under a notice saying we delete it with the
     lead.

     Driven through the output URL rather than through the store, because that
     is the failure a network has any say over. */
  pollCount = 0;
  onPoll = async () => ({ ok: true, status: 200,
    json: async () => ({ id: 'pred-test', status: 'succeeded', output: 'https://replicate.delivery/gone.jpg' }) });

  const previously = renderOutput.isRenderOutput;
  renderOutput.isRenderOutput = () => false;   // let it fall through to a host that does not resolve
  try {
    const res = await render();
    assert.strictEqual(res.status, 502, 'a render we could not keep was reported as a success');
    const body = await res.json().catch(() => ({}));
    assert.ok(!JSON.stringify(body).includes('replicate.delivery'),
      'the provider URL was handed to the browser');
    assert.match(body.error || '', /try again/i, 'the error does not tell the homeowner what to do');
  } finally {
    renderOutput.isRenderOutput = previously;
  }
});
