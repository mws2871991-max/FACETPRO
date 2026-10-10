'use strict';
/* The live-site review of 7 Oct: links that landed nowhere, a training claim
   ahead of the privacy notice, and FAQ markup on a page nobody indexes. */
require('./helpers/data-dir');
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const home = read('home.html'), index = read('index.html');

test('every /#anchor on the design pages exists on the homepage', () => {
  for (const [, id] of index.matchAll(/href="\/#([\w-]+)"/g)) assert.ok(home.includes(`id="${id}"`), `/#${id}`);
});

test('the homepage carries FAQPage markup that matches its visible questions', () => {
  const ld = JSON.parse(home.match(/<script type="application\/ld\+json" id="faq-ld">([\s\S]*?)<\/script>/)[1]);
  const shown = [...home.slice(home.indexOf('<section id="faq"')).matchAll(/<details[^>]*><summary>(.*?)<\/summary>/g)].map(m => m[1].replace(/&rsquo;/g, '’'));
  assert.deepStrictEqual(ld.mainEntity.map(q => q.name), shown);
});

test('no page claims more about AI training than the privacy notice does', () => {
  for (const html of [home, index]) assert.doesNotMatch(html, /train anybody/);
});

test('/cookies lands on the cookie section of the privacy notice', () => {
  const pages = read('routes/pages.js'), privacy = read('legal/privacy.html');
  assert.match(pages, /router\.get\('\/cookies', \(req, res\) => res\.redirect\(301, '\/privacy#cookies'\)\)/);
  assert.match(privacy, /<h2 id="cookies">Cookies and similar technologies<\/h2>/);
});

test('guide tables hold only a price on one line, never a sentence (9 Oct)', () => {
  const css = read('assets/landing.css'), landing = read('landing.js');
  assert.doesNotMatch(css, /^\s*td:last-child\{white-space:nowrap\}/m, 'a sentence in the last column pushed a page to 907px');
  assert.match(css, /td\.price:last-child\{white-space:nowrap\}/);
  assert.match(landing, /class="price"/);
});

test('one address: /index.html and the raw Railway host go to the real pages, /healthz never redirects', () => {
  const server = read('server.js');
  assert.match(server, /if \(req\.path === '\/healthz'\) return next\(\);\s*if \(\/\\\.up\\\.railway\\\.app\$\/i\.test/);
  assert.match(server, /if \(req\.path === '\/index\.html'\) \{/);
});

test('journey test 2 (9 Oct): period-house note, white-on-white note, and why a front can cost more than a typical house', () => {
  const page = read('index.html');
  assert.match(page, /\['sliding-sash', 'bay'\]\.includes\(state\.prefs\.windowStyleId\)/);
  assert.match(page, /Period house\? If it’s listed or in a conservation area/);
  assert.match(page, /If your windows are white now, the picture will look much like your house today/);
  assert.match(page, /if \(spread\.high > was\.high\) \{/);
  assert.match(page, /That figure assumes average-sized windows and no bays/);
});

test('no photo to hand: the example house is offered from the homepage and the design page (Gemini funnel note, 9 Oct)', () => {
  const home = read('home.html'), page = read('index.html');
  assert.match(home, /<a class="trysample" href="#demo-example">No photo to hand\? Try our example house/);
  assert.match(home, /<a class="ownhouse" href="\/design\?journey=windows">Now try it on your own house/);
  assert.match(home, /id="demo-example"/);
  assert.match(page, /href: '\/#demo-example'[\s\S]{0,300}Or try our example house first/);
});
