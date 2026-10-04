'use strict';
require('./helpers/data-dir');
/* 0070: the price on the picture follows the panel. 4 Oct: the stepper moved
   the estimate and the chip on the picture kept the old number.
   0076: with two trades in the picture it shows both, as the bar does. */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const src = h.slice(h.indexOf('function pictureTotal()'), h.indexOf('var picturePriceSyncQueued'));

function page(panelText, bar) {
  const box = { children: [{ textContent: '£4,000 – £7,000' }], replaceChildren(...k) { this.children = k; } };
  const chip = { style: { display: '' }, querySelector: () => box };
  const panel = { textContent: panelText };
  const document = { getElementById: id => (id === 'picture-price' ? chip : id === 'estimate-total' ? panel : null) };
  const hh = (tag, props, text) => ({ textContent: text });
  const fns = new Function('document', 'h', src + '; return { syncPicturePrice, setBar: (b) => { lastBarFigures = b; } };')(document, hh);
  if (bar) fns.setBar(bar);
  return { chip, box, panel, sync: fns.syncPicturePrice, setBar: fns.setBar };
}
const shown = (p) => p.box.children.map(c => c.textContent);

test('a new figure in the panel reaches the picture', () => {
  const p = page('£5,200 – £9,400');
  p.sync();
  assert.deepStrictEqual(shown(p), ['£5,200 – £9,400']);
  p.panel.textContent = '£6,500 – £11,900';
  p.sync();
  assert.deepStrictEqual(shown(p), ['£6,500 – £11,900']);
});

test('no figure in the panel, no figure on the picture', () => {
  const p = page('');
  p.sync();
  assert.strictEqual(p.chip.style.display, 'none');
  p.panel.textContent = '£5,200 – £9,400';
  p.sync();
  assert.strictEqual(p.chip.style.display, '');
});

test('two trades in the picture: both figures, labelled, as on the bar', () => {
  /* Live, 4 Oct: cream windows + Ink Trim; the panel said £4,500 – £6,500. */
  const p = page('£4,500 – £6,500', ['£4,500 – £6,500 trim', '£7,076–£12,866 windows']);
  p.sync();
  assert.deepStrictEqual(shown(p), ['£4,500 – £6,500 trim', '£7,076–£12,866 windows']);
});

test('the bar records its figures for the chip', () => {
  assert.match(h, /lastBarFigures = \[cladding \? `\$\{cladding\} \$\{cladLabel\}` : null, glazing \? `\$\{glazing\} \$\{glazLabel\}` : null\]\.filter\(Boolean\);/);
});

test('it is kept in step on every page change, not by each render function', () => {
  assert.match(h, /new MutationObserver\(\(\) => \{[\s\S]{0,200}syncPicturePrice\(\);/);
  assert.match(h, /observe\(document\.documentElement, \{ childList: true, subtree: true, characterData: true \}\)/);
});
