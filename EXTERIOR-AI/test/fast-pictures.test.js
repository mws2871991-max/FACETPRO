'use strict';

require('./helpers/data-dir');

/* First-visit speed on the homepage (29 September). The first screen used to
   fetch about 1 MB of pictures before the cards filled in. These keep the
   fixes in place: smaller versions for every card, the before/after first,
   and nothing loaded eagerly that the homepage does not show. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const at = html.indexOf('id="choose-heading"');
const home = html.slice(html.lastIndexOf('<section', at), html.indexOf('</section>', at));

test('every card and the before/after offer smaller versions that exist', () => {
  const imgs = [...home.matchAll(/<img [^>]*>/g)].map(m => m[0]);
  assert.strictEqual(imgs.length, 7);
  for (const img of imgs) {
    const srcset = (img.match(/srcset="([^"]+)"/) || [])[1];
    assert.ok(srcset, `no srcset: ${img.slice(0, 80)}`);
    const files = srcset.split(',').map(s => s.trim().split(' ')[0]);
    assert.ok(files.length >= 3, 'three sizes');
    for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), `${f} is missing`);
    assert.match(img, /bg-zinc-100/, 'a grey tile while it loads');
  }
  const small = [...home.matchAll(/srcset="([^"]+)"/g)].map(m => m[1].split(',')[0].trim().split(' ')[0]);
  for (const f of small) assert.ok(fs.statSync(path.join(root, f)).size < 40 * 1024, `${f} should be under 40 KB`);
});

test('the feature picture asks to load first', () => {
  const pair = [...home.matchAll(/<img [^>]*home-feature[^>]*>/g)].map(m => m[0]);
  assert.strictEqual(pair.length, 1);
  for (const img of pair) assert.match(img, /fetchpriority="high"/);
});

test('pictures on sections the homepage hides are not loaded eagerly', () => {
  for (const m of html.matchAll(/<section data-page="pricing"[\s\S]*?<\/section>/g)) {
    assert.ok(!/<img [^>]*loading="eager"/.test(m[0]), 'a /how-we-price picture loads on the homepage');
  }
});
