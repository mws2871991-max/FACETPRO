'use strict';

require('./helpers/data-dir');

/* Every consent version is written down, word for word (29 September), and
   what the box says installers may do is what the privacy notice says. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const log = fs.readFileSync(path.join(root, 'legal', 'CONSENT-VERSIONS.md'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'legal', 'privacy.html'), 'utf8');

const version = html.match(/const CONSENT_VERSION = '([^']+)'/)[1];
const wording = html.match(/installerQuotes: '((?:[^'\\]|\\.)*)'/)[1].replace(/\\u2019/g, "'");

test('the current consent version and its exact wording are in CONSENT-VERSIONS.md', () => {
  assert.ok(log.includes(`## ${version} (current)`), `${version} is not logged as current`);
  assert.ok(log.includes(wording), 'the logged wording differs from the form');
});

test('the privacy notice allows what the box allows, and says who pays', () => {
  if (/text message/.test(wording)) assert.match(privacy, /by email, by telephone and by text message/);
  assert.match(privacy, /within 90 days/);
  assert.match(privacy, /installers pay us when we pass on/i);
  assert.match(html, /How we\\u2019re paid: installers pay us when we pass on an enquiry/);
});
