'use strict';
require('./helpers/data-dir');
/* 0089: the "window replacement calculator" search, answered with Facet Pro's
   argument — your house, not an average — and an honest reference table. */
const { test } = require('node:test');
const assert = require('node:assert');
const landing = require('../landing');
const OPTS = { catalogue: require('../catalogue.json'), siteUrl: 'https://example.test', siteMode: 'beta' };

test('the calculator page exists, is in the sitemap and leads with the argument', () => {
  assert.ok(landing.allPaths().includes('/cost/window-replacement-calculator'));
  const html = landing.renderCostPage('window-replacement-calculator', OPTS);
  assert.match(html, /Why estimate someone else&#39;s house\? Upload a photo of yours\./);
  assert.match(html, /Price my house, not an average/);
  assert.match(html, /not a quotation/);
});
