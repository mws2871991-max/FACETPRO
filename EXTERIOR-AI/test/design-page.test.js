/* The tool has its own page.

   `/` argues, `/design` is the tool, `/installers` is the staff door. They
   were one page, and the September reviews measured what that cost: 30 screens
   on a phone, four unrelated prices in front of a windows customer, a trade
   chooser that moved the page by 341px out of 21,807, and the save step ten
   screens below the price.

   What is asserted here is the part a refactor can silently undo: the routes
   exist and serve the app, neither is offered to search, the sitemap does not
   grow a thin page, links written before the split still work, and the
   markup's own division between home and tool stays honest — because the
   moment a section is added without a data-page it appears on every route,
   which is the bug this whole change exists to remove. */

'use strict';

require('./helpers/data-dir');

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const PORT = 3138;
const BASE = `http://127.0.0.1:${PORT}`;

process.env.PORT = String(PORT);

const realFetch = globalThis.fetch;
require('../server');
before(async () => { await require('./helpers/server-ready')(BASE); });

const indexHtml = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('/design and /installers serve the app', async () => {
  for (const route of ['/design', '/installers']) {
    const res = await realFetch(BASE + route);
    assert.strictEqual(res.status, 200, `${route} did not serve — is it below the /:slug catch-all?`);
    const html = await res.text();
    assert.match(html, /<main id="main"/, `${route} served something other than the app`);
  }
});

test('neither is offered to search', async () => {
  for (const route of ['/design', '/installers']) {
    const res = await realFetch(BASE + route);
    assert.match(res.headers.get('x-robots-tag') || '', /noindex/,
      `${route} is indexable — a thin copy of the homepage will end up in the results`);
    /* follow, not nofollow: the links out of these are the real pages. */
    assert.match(res.headers.get('x-robots-tag') || '', /follow/);
  }
});

test('the homepage is still indexed, and the sitemap has not grown a tool page', async () => {
  const home = await realFetch(BASE + '/');
  assert.strictEqual(home.status, 200);
  assert.doesNotMatch(home.headers.get('x-robots-tag') || '', /noindex/,
    'the homepage carries the rankings and must stay indexable');

  const map = await (await realFetch(BASE + '/sitemap.xml')).text();
  assert.match(map, /<loc>[^<]*\/<\/loc>/, 'the homepage fell out of the sitemap');
  assert.doesNotMatch(map, /\/design</, '/design is in the sitemap');
  assert.doesNotMatch(map, /\/installers</, '/installers is in the sitemap');
});

test('links written before the split still work', async () => {
  /* A resume code lasts 24 hours. A text message somebody sent themselves, or
     a bookmark, does not expire — so these have to keep landing on the tool. */
  const code = await realFetch(`${BASE}/?code=ABC123`, { redirect: 'manual' });
  assert.strictEqual(code.status, 301);
  assert.strictEqual(code.headers.get('location'), '/design?code=ABC123');

  const journey = await realFetch(`${BASE}/?journey=windows&from=new-windows-cost-uk`, { redirect: 'manual' });
  assert.strictEqual(journey.status, 301);
  assert.strictEqual(journey.headers.get('location'), '/design?journey=windows&from=new-windows-cost-uk');

  /* The bare homepage is still the homepage. */
  const plain = await realFetch(BASE + '/', { redirect: 'manual' });
  assert.strictEqual(plain.status, 200);
});

test('the cost pages send people to the tool, not to the argument', () => {
  const landing = require('../landing');
  const html = landing.renderCostPage('new-windows-cost-uk', {
    catalogue: require('../catalogue.json'),
    siteUrl: 'https://example.test',
    siteMode: 'live',
    recipients: [],
  });
  assert.match(html, /https:\/\/example\.test\/design\?journey=windows/,
    'a cost page still points at the homepage with an anchor');
  assert.doesNotMatch(html, /example\.test\/\?journey=/, 'the old form of the link is still being written');
});

test('every top-level section says which page it belongs to', () => {
  /* The division lives in the markup. A section added without a data-page
     shows up on all three routes, which is precisely the failure this change
     exists to remove — and it would look fine in review. */
  const main = indexHtml.slice(indexHtml.indexOf('<main id="main"'), indexHtml.indexOf('</main>'));
  const children = [...main.matchAll(/^  <(section|div|aside|details)\b([^>]*)>/gm)];
  assert.ok(children.length > 15, 'the markup shape changed — this test is reading the wrong thing');

  const unmarked = children
    .map(m => m[2])
    .filter(attrs => !/data-page=/.test(attrs))
    /* The beta notice is deliberately on every page: it is a statement about
       the product, not about one page of it. */
    .filter(attrs => !/id="beta-notice"/.test(attrs));

  assert.deepStrictEqual(unmarked, [],
    'a top-level block carries no data-page, so it will appear on the homepage, the tool and the installer page at once');
});

test('the tool and the argument do not overlap', () => {
  const marked = [...indexHtml.matchAll(/data-page="([a-z]+)"/g)].map(m => m[1]);
  assert.ok(marked.includes('home'), 'nothing is marked as the argument');
  assert.ok(marked.includes('design'), 'nothing is marked as the tool');
  assert.ok(marked.includes('installers'), 'the staff door is not marked');
  // 'pricing' since 24 September: /how-we-price, the explainers moved off the homepage.
  assert.deepStrictEqual([...new Set(marked)].sort(), ['design', 'home', 'installers', 'pricing'],
    'a data-page value nobody routes has appeared — it would hide that section everywhere');
  const pages = require('fs').readFileSync(require('path').join(__dirname, '..', 'routes', 'pages.js'), 'utf8');
  assert.match(pages, /router\.get\('\/how-we-price'/, "'pricing' is marked but /how-we-price is not routed");
  assert.match(indexHtml, /if \(path === '\/how-we-price'\) return 'pricing';/);
});

test('the tool and the installer door get their own tab titles', () => {
  /* One document, three routes, one <title> — so /design was titled with the
     homepage's headline. Two identical tabs, and a bookmark of the tool that
     reads as a bookmark of the homepage.

     Honest to do from script only because both routes are noindex: no crawler
     is shown one title and a reader another. */
  assert.match(indexHtml, /const PAGE_TITLE = \{/, 'PAGE_TITLE has gone');
  assert.match(indexHtml, /design: 'Design your home/);
  assert.match(indexHtml, /installers: 'For installers/);
  assert.match(indexHtml, /if \(PAGE_TITLE\[PAGE\]\) document\.title = PAGE_TITLE\[PAGE\]/,
    'applyPage no longer sets the title');

  /* The homepage title stays in the served HTML, because it is the one that
     is indexed. A `home` key here would move it into script. */
  const map = indexHtml.slice(indexHtml.indexOf('const PAGE_TITLE = {'));
  assert.doesNotMatch(map.slice(0, 260), /\bhome:/,
    'the indexed homepage title must come from the markup, not from script');
});
