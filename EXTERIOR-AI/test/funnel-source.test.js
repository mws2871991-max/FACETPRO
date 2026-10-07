'use strict';
/* Traffic source and the render failure events (handoff 7 Oct §17; the
   reviewer's summary asked for failure events). */
require('./helpers/data-dir');
const { test, before } = require('node:test');
const assert = require('node:assert');
const store = require('../store');

const PORT = 3171;
const BASE = `http://127.0.0.1:${PORT}`;
process.env.PORT = String(PORT);
process.env.INSTALLER_PASSWORD = 'the-installer-password';
const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const post = (body) => realFetch(`${BASE}/api/funnel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const settle = () => new Promise(r => setTimeout(r, 150));

test('a known source is counted under its name, anything else as "other"', async () => {
  await post({ stage: 'landing', src: 'facebook' });
  await post({ stage: 'upload_completed', src: 'Facebook' });
  await post({ stage: 'landing', src: '<script>' });
  await settle();
  const c = await store.readFunnel(30);
  assert.ok(c['src/facebook:landing'] >= 1);
  assert.ok(c['src/facebook:upload_completed'] >= 1);
  assert.ok(c['src/other:landing'] >= 1);
  assert.ok(!Object.keys(c).some(k => k.includes('<script>')), 'free text reached the counter table');
});

test('/api/funnel reports a row per source, and the render failures as branches', async () => {
  for (const stage of ['render_failed', 'render_capped']) assert.strictEqual((await post({ stage })).status, 204);
  await settle();
  const body = await (await realFetch(`${BASE}/api/funnel`, { headers: { Authorization: 'Bearer the-installer-password' } })).json();
  const fb = body.bySource.find(r => r.source === 'facebook');
  assert.ok(fb && fb.landings >= 1 && fb.uploaded >= 1);
  const branches = Object.fromEntries(body.branches.map(b => [b.stage, b]));
  assert.strictEqual(branches.render_failed.of, 'render_started');
  assert.strictEqual(branches.render_capped.of, 'render_started');
});

test('the pages send it', () => {
  const fs = require('fs'), path = require('path');
  const home = fs.readFileSync(path.join(__dirname, '..', 'home.html'), 'utf8');
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(home, /src:src\}/);
  assert.match(index, /src: readUtm\(\)\.utm_source/);
  assert.match(index, /reachedStage\(state\.renderUnavailable \? 'render_capped' : 'render_failed'\)/);
});
