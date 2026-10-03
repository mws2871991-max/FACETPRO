'use strict';
require('./helpers/data-dir');
/* 0056: the driveway keep mask is waited for, and a render it did not hold is
   declined, never shown. Before this, the hold raced a six-second grace and a
   late mask was a quiet skip, so a render could show a garden wall knocked
   down whenever Replicate was cold — and a pass told us nothing about whether
   the mask had arrived. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const s = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('the keep mask is not raced against the window-mask grace', () => {
  assert.doesNotMatch(s, /maskWithinGrace\(keepPromise\)/, 'default GRACE_MS would bring the race back');
  assert.match(s, /maskWithinGrace\(keepPromise, keepWaitMs\)/);
  assert.match(s, /const keepWaitMs = Math\.max\(0, deadlineAt - Date\.now\(\)\)/);
});

test('a keep mask that never arrived declines the render', () => {
  const i = s.indexOf('const keep = driveway ? await maskWithinGrace');
  assert.ok(i > 0);
  const after = s.slice(i, i + 600);
  assert.match(after, /if \(driveway && !keep\) \{[\s\S]*?return res\.status\(503\)\.json\(\{ error: DRIVEWAY_NOT_HELD_MESSAGE, reason: 'driveway_not_held'/);
});

test('a keep mask that arrived but could not be applied declines the render too', () => {
  const k = s.slice(s.indexOf('async function keepRender('), s.indexOf('async function respondWithRender('));
  assert.match(k, /if \(restore\.requireKeep\) \{[\s\S]*?throw new DrivewayNotHeld/, 'no detection record must not be a quiet pass');
  assert.match(k, /restoreInsideMask\(\{ render: bytes[\s\S]*?\} else \{[\s\S]*?throw new DrivewayNotHeld\(kept\.reason\)/);
  assert.doesNotMatch(k, /'walls, bins and railings not held'/, 'the old quiet-skip line is gone');
  assert.match(s, /keepMask: keep\.buffer, keepMaskMime: keep\.mime, requireKeep: true/);
});

test('a declined driveway render is a plain 503 the page shows as written', () => {
  const r = s.slice(s.indexOf('async function respondWithRender('), s.indexOf('async function respondWithRender(') + 800);
  assert.match(r, /err instanceof DrivewayNotHeld[\s\S]*?status\(503\)[\s\S]*?plain: true/);
  assert.match(s, /const DRIVEWAY_NOT_HELD_MESSAGE = '[^']*wall, fence, railings and bins[^']*estimate hasn’t changed\.'/);
});

test('a held render says so, so a test can see the mask arrived', () => {
  assert.match(s, /drivewayHeld = \{ share:/);
  assert.match(s, /\.\.\.\(drivewayHeld \? \{ drivewayHeld \} : \{\}\)/);
});

test('the keep mask is started at upload wherever the window mask is', () => {
  const win = (s.match(/prepareWindowMask\((?!record)/g) || []).length;
  const keep = (s.match(/prepareKeepMask\((?!record)/g) || []).length;
  assert.ok(win >= 3);
  assert.strictEqual(keep, win);
  const fn = s.slice(s.indexOf('const prepareKeepMask = '), s.indexOf('const prepareKeepMask = ') + 900);
  assert.match(fn, /driveways\.enabled\(\{ body: req\.body \}\)/, 'only for the trial');
  assert.match(fn, /prompt: driveways\.KEEP_PROMPT/);
  assert.match(fn, /else record\.keepPromise = null/, 'a failed mask is asked for again, not inherited');
});

test('the render reuses the upload mask and asks again if it failed', () => {
  assert.match(s, /keepRecord\?\.keepMask \? Promise\.resolve\(keepRecord\.keepMask\)/);
  assert.match(s, /keepRecord\?\.keepPromise \? keepRecord\.keepPromise\.then\(m => m \|\| freshKeep\(\)\)/);
});

test('the page asks for the keep mask at upload on a driveway trial page', () => {
  assert.match(html, /fetch\('\/api\/detect', \{[\s\S]{0,400}experiments: \/\[\?&\]exp=driveway\\b\/\.test\(location\.search\) \? \['driveway'\] : undefined/);
});
