'use strict';

require('./helpers/data-dir');

/* One way of saying where the prices come from (29 September).

   The site had four: "real UK supplier and labour rates", "what these jobs
   really sell for", "typical material, labour, scaffolding and waste costs"
   and "24 years of selling these jobs". None was quite wrong and together
   they left the homeowner to work out the method. Worse, "supplier rates"
   is not true of windows and doors: those are settled selling prices, not a
   supplier rate card (catalogue.glazing.source). So there is one hierarchy,
   word for word wherever the method is stated. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const landing = fs.readFileSync(path.join(root, 'landing.js'), 'utf8');
const visible = (s) => s.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const WINDOWS = 'what these jobs actually sell for, from 24 years of selling them, checked against current UK prices.';
const WALLS = 'UK material and labour rates, with scaffolding, waste and VAT.';
const EVERY = 'a planning estimate, shown as a range, confirmed by your installer&rsquo;s survey.';

test('the full hierarchy is on /how-we-price and in the windows FAQ, word for word', () => {
  const count = (needle) => html.split(needle).length - 1;
  for (const line of [WINDOWS, WALLS, EVERY]) {
    assert.ok(count(line) >= 2, `"${line.slice(0, 40)}…" should appear in both places`);
  }
});

test('the cost pages state the same hierarchy', () => {
  const caveat = landing.match(/const CAVEAT = '([^']+)'/)[1];
  assert.ok(caveat.includes('Windows and doors: ' + WINDOWS));
  assert.ok(caveat.includes('Walls, roof and roofline: ' + WALLS));
});

test('no wording claims supplier rates for everything', () => {
  for (const [name, src] of [['index.html', visible(html)], ['landing.js', visible(landing)]]) {
    assert.ok(!/supplier and labour rates/i.test(src), `${name} still says "supplier and labour rates"`);
    assert.ok(!/typical material, labour, scaffolding and waste/i.test(src), `${name} still says "typical material, labour…"`);
    assert.ok(!/supplier catalogue/i.test(src), `${name} still says "supplier catalogue"`);
  }
});
