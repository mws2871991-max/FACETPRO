'use strict';

require('./helpers/data-dir');

/* The homepage before/after (29 September) is an AI illustration Mike chose,
   not a real job and not a Facet Pro render. Mike's rule: if it's an
   illustration, it says so. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('the homepage pair is labelled an illustration, in the caption and the alt text', () => {
  const at = html.indexOf('id="choose-heading"');
  const fig = html.slice(html.indexOf('<figure', at), html.indexOf('</figure>', at));
  const imgs = [...fig.matchAll(/<img src="([^"]+)"[^>]*alt="([^"]+)"/g)];
  assert.strictEqual(imgs.length, 2);
  for (const [, src, alt] of imgs) {
    assert.match(src, /home-22-(before|after)-sm\.jpg$/);
    assert.ok(fs.existsSync(path.join(root, src)), `${src} is missing`);
    assert.match(alt, /^Illustration:/);
  }
  assert.match(fig, /<figcaption[^>]*>Illustration:/);
  assert.ok(!/Facet Pro made/.test(fig), 'an illustration must not be called a Facet Pro render');
});

test('the pair says the driveway and plants are not part of the estimate', () => {
  const at = html.indexOf('id="choose-heading"');
  const fig = html.slice(html.indexOf('<figure', at), html.indexOf('</figure>', at));
  assert.match(fig, /driveway and plants are part of the illustration, not the estimate/);
});
