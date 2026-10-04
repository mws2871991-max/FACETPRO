'use strict';
require('./helpers/data-dir');
/* 0080: the primary button stands out from the page on every viewport —
   WCAG 1.4.11 (3:1 for a control's edge) and 1.4.3 (4.5:1 for its text). */
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const h = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

const lum = (hex) => {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const v = (name) => (h.match(new RegExp(`--${name}:(#[0-9A-Fa-f]{6})`)) || [])[1];

test('the button gold clears 3:1 against every background it sits on', () => {
  const gold = v('brand-gold-cta');
  assert.ok(gold, 'no --brand-gold-cta');
  for (const [name, bg] of [['cream page', v('brand-cream')], ['white card', v('brand-card')], ['navy band', v('brand-navy')]]) {
    assert.ok(ratio(gold, bg) >= 3, `${name}: ${ratio(gold, bg).toFixed(2)}:1`);
  }
});

test('the text on it clears 4.5:1, resting and on hover', () => {
  for (const name of ['brand-gold-cta', 'brand-gold-cta-hover']) {
    assert.ok(ratio(v(name), '#111111') >= 4.5, `${name}: ${ratio(v(name), '#111111').toFixed(2)}:1`);
  }
});

test('.cta uses the button gold and has a visible focus ring', () => {
  assert.match(h, /\.cta\{background-color:var\(--brand-gold-cta\) !important/);
  assert.match(h, /\.cta:focus-visible\{outline:3px solid #0D1B2A/);
});
