'use strict';
require('./helpers/data-dir');
/* Per person over an hour and a day (security handoff, 9 Oct): one visitor
   cannot spend most of the site's daily AI allowance. Read from the source,
   like the other limiter tests, because the suite raises the budgets. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');

test('uploads are limited per hour and renders per day, per person', () => {
  assert.match(src, /windowMs: 60 \* 60 \* 1000,\s*max: Math\.max\(envLimit\('DETECT_HOURLY_LIMIT', 10\)/);
  assert.match(src, /windowMs: 24 \* 60 \* 60 \* 1000,\s*max: Math\.max\(envLimit\('RENDER_DAILY_PER_IP', 30\)/);
  assert.match(src, /app\.post\('\/api\/detect', detectLimiter, detectHourLimiter,/);
  assert.match(src, /app\.post\('\/api\/render', renderLimiter, renderDayLimiter,/);
});

test('the refusals are plain words the page shows as they are', () => {
  assert.match(src, /lot of photos in the last hour/);
  assert.match(src, /most pictures we can draw for you today[^}]*plain: true/);
});
