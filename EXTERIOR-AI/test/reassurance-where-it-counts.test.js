'use strict';
require('./helpers/data-dir');
/* 0081 (outside review, 4 Oct): say who it is for before the upload, and
   repeat the privacy promises where details are handed over — only what the
   privacy notice already says. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const privacy = fs.readFileSync(path.join(__dirname, '..', 'legal', 'privacy.html'), 'utf8');

test('who it works for, under both upload buttons', () => {
  assert.match(h, /Works best on houses and bungalows &mdash; detached, semi or terraced &mdash; photographed from the front\./);
  assert.match(h, /Works best on houses and bungalows — detached, semi or terraced\. Flats and blocks aren\\u2019t supported yet\./);
});

test('the quotes box says, in one line first, that details go only to the named installers', () => {
  const c = h.slice(h.indexOf('function buildInstallerConsent()'), h.indexOf('function consentBox('));
  assert.match(c, /id: 'quotes-reassurance'/);
  assert.match(c, /named below get your details, and only if you tick the box\. We never sell your details to anyone else or add you to a marketing list\./);
  assert.ok(c.indexOf('quotes-reassurance') < c.indexOf("consentBox('installerQuotes'"), 'before the box, not after');
});

test('the privacy line sits under the submit button, and the notice backs every part of it', () => {
  assert.match(h, /id: 'submit-privacy' \},\s*'Your original photo isn\\u2019t stored \\u00b7 Your details go only where you tick \\u00b7 No marketing emails'/);
  assert.match(privacy, /We do not sell your data to anyone else/);
  assert.match(privacy, /We do not send marketing emails/);
  assert.match(privacy, /never to add you to a marketing list/);
});
