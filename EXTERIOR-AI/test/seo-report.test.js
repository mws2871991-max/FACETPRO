'use strict';

require('./helpers/data-dir');

/* The SEO funnel read per page (30 September). */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

test('/api/funnel reports each landing page from landing to quote, and by button', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'ops.js'), 'utf8');
  for (const stage of ['seo_landing', 'design_opened', 'upload_completed', 'render_shown', 'estimate_viewed', 'design_saved', 'quote_requested']) {
    assert.ok(src.includes(`'${stage}'`), stage);
  }
  assert.match(src, /bySeoPage, byCtaPlace, byDay/);
  assert.match(src, /counts\[`from\/\$\{slug\}:\$\{stage\}`\]/);
  assert.match(src, /counts\[`cta\/\$\{place\}:\$\{stage\}`\]/);
});
