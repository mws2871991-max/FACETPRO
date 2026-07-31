#!/usr/bin/env node
/* Rewrite the canonical domain across every file that hard-codes it.
   Run: npm run set-domain -- https://www.facetpro.co.uk

   There is no build step here by design, so the domain appears literally in
   the HTML, sitemap and robots.txt. Missing one of them means a canonical tag
   or an Open Graph URL silently pointing at the wrong host, which is the kind
   of SEO fault nobody notices for months. This makes it one command.

   Pass --check to verify consistency without writing anything. */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILES = [
  'index.html',
  'guided-demo.html',
  'legal/privacy.html',
  'legal/terms.html',
  'robots.txt',
  'sitemap.xml',
  'README.md',
];

// Matches the scheme+host of any facetpro-style absolute URL we've written.
const URL_RE = /https?:\/\/[a-z0-9.-]*facetpro\.co\.uk/gi;

const args = process.argv.slice(2);
const checkOnly = args.includes('--check');
const target = args.find(a => !a.startsWith('--'));

function normalise(input) {
  let url = input.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
      throw new Error('give a bare origin, not a path');
    }
    return parsed.origin;
  } catch (err) {
    console.error(`"${input}" is not a usable origin: ${err.message}`);
    console.error('Example: npm run set-domain -- https://www.facetpro.co.uk');
    process.exit(1);
  }
}

const found = new Map();   // origin -> [files]
for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const text = fs.readFileSync(file, 'utf8');
  for (const match of text.match(URL_RE) || []) {
    const origin = match.toLowerCase();
    if (!found.has(origin)) found.set(origin, []);
    if (!found.get(origin).includes(rel)) found.get(origin).push(rel);
  }
}

if (checkOnly || !target) {
  if (!found.size) {
    console.log('No absolute facetpro URLs found.');
    process.exit(0);
  }
  console.log('Canonical domain currently used:\n');
  for (const [origin, files] of found) {
    console.log(`  ${origin}`);
    for (const f of files) console.log(`      ${f}`);
  }
  if (found.size > 1) {
    console.log('\n⚠  More than one origin in use — these should all agree.');
    console.log('   Fix with: npm run set-domain -- <the right one>');
    process.exit(1);
  }
  if (!target) {
    console.log('\nTo change it: npm run set-domain -- https://www.example.co.uk');
  }
  process.exit(0);
}

const origin = normalise(target);
let changed = 0;

for (const rel of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) continue;
  const before = fs.readFileSync(file, 'utf8');
  const after = before.replace(URL_RE, origin);
  if (after !== before) {
    fs.writeFileSync(file, after);
    const count = (before.match(URL_RE) || []).length;
    console.log(`  ${rel.padEnd(20)} ${count} occurrence${count === 1 ? '' : 's'}`);
    changed++;
  }
}

console.log(changed
  ? `\nCanonical domain set to ${origin} across ${changed} file${changed === 1 ? '' : 's'}.`
  : `\nAlready set to ${origin} everywhere — nothing to do.`);
