'use strict';

require('./helpers/data-dir');

/* SEO sprint 1 (29 September): the brief's requirements, one test each. */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const landing = require('../landing');
const glazing = require('../glazing');
const catalogue = require('../catalogue.json');

const OPTS = { catalogue, siteUrl: 'https://www.facetpro.co.uk', siteMode: 'live' };
const render = (slug) => landing.renderCostPage(slug, OPTS);
const schemaOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);

const SPRINT = {
  'new-windows-cost-uk': ['New Windows Cost UK 2026 | Prices & Fitted Estimates', 'How Much Do New Windows Cost in the UK?', 'Upload photo & see price →'],
  'window-replacement-cost-uk': ['Window Replacement Cost UK 2026 | How Much to Replace Windows', 'What Does Window Replacement Cost in the UK?', 'Upload photo & see price →'],
  '10-window-replacement-cost': ['10 Window Replacement Cost UK 2026 | Fitted Prices', 'How Much Does It Cost to Replace 10 Windows?', 'Upload photo & see price →'],
  '12-window-replacement-cost': ['12 Window Replacement Cost UK 2026 | Fitted Prices', 'How Much Does It Cost to Replace 12 Windows?', 'Upload photo & see price →'],
  'upvc-window-prices': ['uPVC Window Prices UK 2026 | Supply & Fitted Costs', 'uPVC Window Prices: How Much Do They Cost Fitted?', 'Upload photo & see price →'],
  'aluminium-window-prices': ['Aluminium Window Prices UK 2026 | Fitted Cost Guide', 'How Much Do Aluminium Windows Cost?', 'Upload photo & see price →'],
  'front-door-replacement-cost': ['Front Door Replacement Cost UK 2026 | Fitted Prices', 'How Much Does a New Front Door Cost?', 'Upload photo & see price →'],
  'composite-door-cost': ['Composite Door Cost UK 2026 | Fitted Prices & Guide', 'How Much Does a Composite Door Cost?', 'Upload photo & see price →'],
  'house-rendering-cost': ['House Rendering Cost UK 2026 | Cost Per m² & Per House', 'How Much Does It Cost to Render a House?', 'Upload photo & see price →'],
  'house-exterior-renovation-cost': ['House Exterior Renovation Cost UK 2026 | Complete Guide', 'How Much Does It Cost to Renovate the Outside of a House?', 'Upload photo & see price →'],
};
const esc = (t) => t.replace(/&/g, '&amp;');

/* Button words: one for every page since 6 Oct (Mike: standardise all CTAs). */
test('the ten sprint pages have the brief\'s title, h1 and button words', () => {
  for (const [slug, [title, h1, cta]] of Object.entries(SPRINT)) {
    const html = render(slug);
    assert.ok(html, `${slug} does not exist`);
    assert.ok(html.includes(`<title>${esc(title)}</title>`), `${slug} title`);
    assert.strictEqual((html.match(/<h1>/g) || []).length, 1, `${slug} has one h1`);
    assert.ok(html.includes(`<h1>${esc(h1)}</h1>`), `${slug} h1`);
    assert.ok(html.includes(`>${esc(cta)}</a>`), `${slug} button says "${cta}"`);
  }
});

test('titles and descriptions are unique across every guide', () => {
  const t = new Set(); const d = new Set();
  for (const p of landing.COST_PAGES) {
    assert.ok(!t.has(p.title), `duplicate title ${p.title}`); t.add(p.title);
    assert.ok(!d.has(p.description), `duplicate description on ${p.slug}`); d.add(p.description);
  }
});

test('every guide: canonical, indexable, Open Graph, Twitter, breadcrumb visible and in schema', () => {
  for (const p of landing.COST_PAGES) {
    const html = render(p.slug);
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www.facetpro.co.uk/cost/${p.slug}">`));
    assert.match(html, /<meta name="robots" content="index, follow">/);
    for (const m of ['og:title', 'og:description', 'og:image', 'og:url']) assert.ok(html.includes(`property="${m}"`), `${p.slug} ${m}`);
    for (const m of ['twitter:card', 'twitter:title', 'twitter:description', 'twitter:image']) assert.ok(html.includes(`name="${m}"`), `${p.slug} ${m}`);
    assert.match(html, /<nav class="crumbs" aria-label="Breadcrumb">/);
    const graph = schemaOf(html)['@graph'];
    const crumbs = graph.find(g => g['@type'] === 'BreadcrumbList');
    assert.deepStrictEqual(crumbs.itemListElement.slice(0, 2).map(i => i.name), ['Home', 'Costs']);
    assert.ok(graph.find(g => g['@type'] === 'WebPage'));
  }
});

test('FAQ schema only where the questions are on the page, word for word', () => {
  for (const p of landing.COST_PAGES) {
    const html = render(p.slug);
    const faq = schemaOf(html)['@graph'].find(g => g['@type'] === 'FAQPage');
    if (!faq) { assert.ok(!html.includes('<section class="faq">'), `${p.slug} shows questions with no schema`); continue; }
    for (const q of faq.mainEntity) {
      const vis = q.name.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
      assert.ok(html.includes(`<h3>${vis}</h3>`), `${p.slug}: "${q.name}" is not visible`);
    }
  }
  for (const slug of Object.keys(SPRINT)) {
    assert.ok(schemaOf(render(slug))['@graph'].some(g => g['@type'] === 'FAQPage'), `${slug} has no FAQs`);
  }
});

test('the sprint pages carry what is included and planning estimate vs quotation', () => {
  for (const slug of Object.keys(SPRINT)) {
    const html = render(slug);
    assert.ok(html.includes('<h2>What is included in these prices</h2>'), `${slug} included`);
    assert.ok(html.includes('<h2>Planning estimate or quotation?</h2>'), `${slug} planning vs quote`);
  }
});

test('hubs link down, every guide links up, the cornerstone links to every part', () => {
  const win = render('new-windows-cost-uk');
  for (const s of ['window-replacement-cost-uk', '10-window-replacement-cost', '12-window-replacement-cost', 'upvc-window-prices', 'aluminium-window-prices', 'sash-windows-cost', 'anthracite-windows-cost']) {
    assert.ok(win.includes(`href="/cost/${s}"`), `windows hub → ${s}`);
  }
  for (const p of landing.COST_PAGES) {
    const hub = landing.CATEGORIES[landing.categoryFor(p.slug)].hub;
    if (hub !== p.slug) assert.ok(render(p.slug).includes(`href="/cost/${hub}"`), `${p.slug} → up to ${hub}`);
  }
  const ext = render('house-exterior-renovation-cost');
  for (const s of ['new-windows-cost-uk', 'front-door-replacement-cost', 'house-rendering-cost', 'cladding-cost', 'fascia-soffit-replacement-cost', 'new-roof-cost']) {
    assert.ok(ext.includes(`href="/cost/${s}"`), `cornerstone → ${s}`);
  }
});

test('CTAs go to the right journey, say which button, and aluminium opens on aluminium', () => {
  /* One wording on every button since 6 Oct; the journey and the material
     still differ per page, and that is what this checks. */
  const W = 'Upload photo &amp; see price →';
  const hrefs = (html) => [...html.matchAll(new RegExp(`href="([^"]+)">${W}</a>`, 'g'))].map(m => m[1]);
  assert.ok(hrefs(render('new-windows-cost-uk')).some(h => /\/design\?journey=windows&amp;from=new-windows-cost-uk&amp;cta=(hero|end)/.test(h)));
  assert.ok(hrefs(render('composite-door-cost')).some(h => /journey=doors/.test(h)));
  assert.ok(hrefs(render('house-rendering-cost')).some(h => /journey=cladding/.test(h)));
  assert.ok(hrefs(render('aluminium-window-prices')).some(h => /material=aluminium/.test(h)));
  const plan = hrefs(render('house-exterior-renovation-cost')).filter(h => /cta=(hero|end)/.test(h));
  assert.ok(plan.length && plan.every(h => /\/design\?from=house-exterior-renovation-cost/.test(h) && !/journey=/.test(h)));
});

test('/cost lists every guide by category', () => {
  const html = landing.renderCostIndex(OPTS);
  for (const p of landing.COST_PAGES) assert.ok(html.includes(`href="/cost/${p.slug}"`), p.slug);
  assert.ok(landing.allPaths().includes('/cost'));
});

test('aluminium is priced by the engine at the catalogue figure, colour included', () => {
  const job = (sel) => glazing.publishedRange(glazing.estimateGlazing({ rates: catalogue.glazing, houseType: 'semi', windowCountOverride: 8, selections: { windowStyleId: 'casement', ...sel } }));
  const u = job({});
  const a = job({ windowMaterialId: 'aluminium' });
  const aAnth = job({ windowMaterialId: 'aluminium', windowDoorColourId: 'anthracite' });
  /* Mike, 30 September: £1,904 against £876 for the same window, 2.17x. The
     whole job moves by less, because access, disposal and the door do not. */
  assert.ok(a.low > u.low * 1.6 && a.low < u.low * 2.2, 'a little over twice the windows');
  assert.deepStrictEqual(aAnth, a, 'colour is included on aluminium');
  assert.deepStrictEqual(job({ windowMaterialId: 'nonsense' }), u, 'an unknown material prices as uPVC');
});

test('the tool offers the material and the server passes it through, allowlisted', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(server, /windowMaterials: \(c\.glazing\?\.materials/);
  assert.match(server, /windowMaterialId: \(catalogue\.glazing\.materials \|\| \[\]\)\.some/);
  assert.match(html, /materialRow\(wd\.windowMaterials\)/);
  assert.match(html, /windowMaterialId: state\.prefs\.windowMaterialId/);
});

test('SEO funnel: landings counted server-side only, and the button is allowlisted', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /SERVER_ONLY_STAGES = new Set\(\[[^\]]*'seo_landing'/);
  assert.match(server, /\['seo_landing', \{ of: 'landing'/);
  assert.match(server, /const CTA_PLACES = new Set\(\['hero', 'end', 'header'\]\)/);
  assert.match(server, /countStage\(`cta\/\$\{cta\}:\$\{stage\}`\)/);
  const pages = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pages.js'), 'utf8');
  assert.ok((pages.match(/countSeoLanding\(req,/g) || []).length >= 3, 'cost, area and index pages count a landing');
});

test('the tool\'s own price endpoint takes the material too', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'measure.js'), 'utf8');
  assert.match(src, /windowMaterialId: \(catalogue\.glazing\?\.materials \|\| \[\]\)\.some/);
});

test('a saved design keeps its frame material', () => {
  const resume = require('../resume');
  assert.ok(resume.ID_FIELDS.includes('windowMaterialId'));
  const out = resume.buildPayload({ windowStyleId: 'casement', windowMaterialId: 'aluminium' });
  assert.strictEqual(out.windowMaterialId, 'aluminium');
});

test('near-miss cost URLs redirect to the page they mean; nonsense still 404s', () => {
  assert.strictEqual(landing.costRedirectFor('window-replacement-cost'), 'window-replacement-cost-uk');
  assert.strictEqual(landing.costRedirectFor('new-windows-cost'), 'new-windows-cost-uk');
  assert.strictEqual(landing.costRedirectFor('New-Windows-Cost-UK'), 'new-windows-cost-uk');
  assert.strictEqual(landing.costRedirectFor('conservatory-cost'), 'conservatory-cost-uk');
  assert.strictEqual(landing.costRedirectFor('roof-replacement-cost'), 'new-roof-cost');
  assert.strictEqual(landing.costRedirectFor('something-else'), null);
  for (const to of Object.values(landing.COST_ALIASES)) {
    assert.ok(landing.COST_PAGES.some(p => p.slug === to), `alias points at a missing page: ${to}`);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pages.js'), 'utf8');
  assert.match(src, /res\.redirect\(301, `\/cost\/\$\{to\}`\)/);
});

test('every guide links to the cornerstone, and roofline is linked from roof and render', () => {
  for (const p of landing.COST_PAGES) {
    if (p.slug === 'house-exterior-renovation-cost') continue;
    assert.ok(render(p.slug).includes('href="/cost/house-exterior-renovation-cost"'), `${p.slug} → cornerstone`);
  }
  for (const s of ['new-roof-cost', 'house-rendering-cost', 'cladding-cost']) {
    const html = render(s);
    const rel = html.slice(html.indexOf('<nav class="related">'));
    assert.ok(rel.includes('href="/cost/fascia-soffit-replacement-cost"'), `${s} → roofline`);
  }
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'pages.js'), 'utf8');
  assert.match(src, /req\.path\.endsWith\('\/'\)/);
});

test('"12 windows" is one price on every guide that shows it', () => {
  const c = require('../catalogue.json');
  const twelvePage = landing.COST_PAGES.find(p => p.slug === '12-window-replacement-cost').build(c);
  const tenPage = landing.COST_PAGES.find(p => p.slug === '10-window-replacement-cost').build(c);
  const row = tenPage.sections[0].table.rows.find(r => r[0] === '12')[1];
  assert.ok(twelvePage.answer.startsWith(row.replace(' – ', ' to ')), `${twelvePage.answer} vs ${row}`);
});
