'use strict';
require('./helpers/data-dir');
/* 0070: the price on the picture follows the panel. 4 Oct: the stepper moved
   the estimate and the chip on the picture kept the old number. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const src = h.slice(h.indexOf('function pictureTotal()'), h.indexOf('var picturePriceSyncQueued'));

function page(panelText) {
  const num = { textContent: '£4,000 – £7,000' };
  const chip = { style: { display: '' }, querySelector: () => num };
  const panel = { textContent: panelText };
  const document = { getElementById: id => (id === 'picture-price' ? chip : id === 'estimate-total' ? panel : null) };
  const fns = new Function('document', src + '; return { syncPicturePrice };')(document);
  return { chip, num, panel, sync: fns.syncPicturePrice };
}

test('a new figure in the panel reaches the picture', () => {
  const p = page('£5,200 – £9,400');
  p.sync();
  assert.strictEqual(p.num.textContent, '£5,200 – £9,400');
  p.panel.textContent = '£6,500 – £11,900';
  p.sync();
  assert.strictEqual(p.num.textContent, '£6,500 – £11,900');
});

test('no figure in the panel, no figure on the picture', () => {
  const p = page('');
  p.sync();
  assert.strictEqual(p.chip.style.display, 'none');
  p.panel.textContent = '£5,200 – £9,400';
  p.sync();
  assert.strictEqual(p.chip.style.display, '');
});

test('it is kept in step on every page change, not by each render function', () => {
  assert.match(h, /new MutationObserver\(\(\) => \{[\s\S]{0,200}syncPicturePrice\(\);/);
  assert.match(h, /observe\(document\.documentElement, \{ childList: true, subtree: true, characterData: true \}\)/);
});
