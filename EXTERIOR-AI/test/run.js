#!/usr/bin/env node
/* The test runner, which exists so isolation is not a thing each file has to
   remember.

   Every test file requiring a helper is belt-only: a thirty-second file that
   forgets writes to the real data directory, and nothing says so — the suite
   reports success while a lead sits in data/leads.jsonl. That was verified
   against this repo, not theorised: a file without the require produced
   LD-RBTG1Z28181H, name "Ghost", in real storage, green.

   So the environment is set here, once, before any test file is loaded. Node
   spawns each file as its own process and children inherit it. Inline
   assignment in the npm script would have done the same on a Mac and nothing
   at all on Windows.

   And then it checks. Setting a variable protects the code that reads it; the
   check catches anything that bypasses DATA_DIR entirely, which is the failure
   nobody would otherwise see. */

'use strict';

const { spawnSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const realData = path.join(root, 'data');

/* What the real data directory looks like now, so we can tell whether the run
   touched it. Content, not mtime — a rewrite with identical bytes is still a
   rewrite of somebody's leads, and a read is not a write. */
const fingerprint = () => {
  if (!fs.existsSync(realData)) return 'absent';
  const hash = crypto.createHash('sha256');
  for (const name of fs.readdirSync(realData).sort()) {
    const full = path.join(realData, name);
    const stat = fs.statSync(full);
    hash.update(name).update(String(stat.isDirectory() ? 'dir' : stat.size));
    if (stat.isFile() && stat.size < 2 * 1024 * 1024) hash.update(fs.readFileSync(full));
  }
  return hash.digest('hex');
};

const before = fingerprint();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'facetpro-test-'));
const result = spawnSync(
  process.execPath,
  ['--test', '--test-force-exit', '--test-concurrency=1', 'test/*.test.js'],
  { cwd: root, stdio: 'inherit', env: { ...process.env, FACETPRO_DATA_DIR: tmp } },
);

const after = fingerprint();
if (before !== after) {
  console.error([
    '',
    'THE TEST RUN WROTE TO THE REAL DATA DIRECTORY.',
    '',
    `  ${realData}`,
    '',
    'On a host with the production volume mounted that is customer data — test',
    'leads in real storage, and the daily spend counter reset.',
    '',
    'Most likely one of:',
    '  · a test builds a path from __dirname instead of FACETPRO_DATA_DIR',
    '  · something in the app writes outside store.DATA_DIR',
    '',
    `The run used ${tmp}; anything outside it is the bug.`,
    '',
  ].join('\n'));
  process.exit(1);
}

process.exit(result.status ?? 1);
