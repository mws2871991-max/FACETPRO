#!/usr/bin/env node
/* A month of social posts for Buffer, from plan.js (npm run social).

     npm run social -- --start 2026-10-12 --board "Home exterior ideas & costs"

   Writes:
   - the images, to assets/social/<month>/ — they must be at public URLs for
     Buffer, so they go live with the next deploy, which should be AFTER the
     batch is approved;
   - one CSV per Buffer channel (Instagram, Facebook, X, Pinterest) and a
     preview page, to ~/Downloads/Facet Pro - Social/<month>/ — outside the
     repository, because it is a working draft for Mike to approve.

   TikTok gets no file: it is video-first and video is not decided yet, and
   Buffer's bulk upload does not take video anyway.

   Every price is fetched from the engine as the batch is built (prices.js)
   and the date goes on the image, so a post never quotes a figure the site
   no longer gives. Re-run the month if prices change. */

'use strict';
/* global document -- the page.evaluate callbacks run in the browser */

const fs = require('fs');
const os = require('os');
const path = require('path');
const plan = require('./plan');
const { range, SITE } = require('./prices');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const START = arg('start');
if (!/^\d{4}-\d{2}-\d{2}$/.test(START || '')) { console.error('Give --start YYYY-MM-DD (the first day to post).'); process.exit(2); }
const BOARD = arg('board', 'Home exterior ideas & costs');
const MONTH = START.slice(0, 7);
const ROOT = path.join(__dirname, '..', '..');
const IMG_DIR = path.join(ROOT, 'assets', 'social', MONTH);
const OUT = path.join(os.homedir(), 'Downloads', 'Facet Pro - Social', MONTH);
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/* Best-guess times; Buffer can move them. 24-hour, as Buffer requires. */
const TIMES = { instagram: '19:00', facebook: '12:30', x: '08:30', pinterest: '20:30' };
const TODAY = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

const dayOf = (i) => { const d = new Date(`${START}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + i); return d.toISOString().slice(0, 10); };
const link = (p, source, i) => {
  const u = new URL(p.link, SITE);
  u.searchParams.set('utm_source', source);
  u.searchParams.set('utm_medium', 'social');
  u.searchParams.set('utm_campaign', `${MONTH.replace('-', '')}_d${String(i + 1).padStart(2, '0')}`);
  return u.toString();
};
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fileUrl = (p) => 'file://' + p.split(path.sep).map(encodeURIComponent).join('/');

/* ── the images ── */
const FONT = fileUrl(path.join(ROOT, 'assets', 'fonts', 'geist-variable.woff2'));
const MONO = fileUrl(path.join(ROOT, 'assets', 'fonts', 'GeistMono-500.woff2'));
const HOUSE = (s) => `<svg width="${s}" height="${s}" viewBox="0 0 40 40"><defs><clipPath id="fpmark1"><rect width="40" height="40" rx="8"/></clipPath></defs><g clip-path="url(#fpmark1)"><rect width="40" height="40" fill="currentColor"/><path d="M28 0H40V12Z" fill="#B5482A"/></g><path d="M13 9H28V14H19V18.5H26.5V23.5H19V31H13Z" fill="#FFFFFF"/></svg>`;
const CSS = (W, H) => `
@font-face{font-family:G;src:url(${FONT}) format('woff2');font-weight:100 900}
@font-face{font-family:M;src:url(${MONO}) format('woff2')}
*{margin:0;box-sizing:border-box}
body{width:${W}px;height:${H}px;font-family:G;color:#16181A;background:#F6F4F0;display:flex;flex-direction:column;padding:${Math.round(W * 0.07)}px;overflow:hidden}
.top{display:flex;align-items:center;gap:14px;font-weight:700;letter-spacing:.14em;font-size:${Math.round(W * 0.026)}px}
.eb{font-family:M;font-size:${Math.round(W * 0.019)}px;letter-spacing:.14em;text-transform:uppercase;color:#5B5F63}
h1{font-weight:700;letter-spacing:-.035em;line-height:1.02}
.sub{color:#45494D;line-height:1.35}
.foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;gap:20px}
.cta{background:#B5482A;color:#fff;font-weight:600;border-radius:6px;padding:${Math.round(W * 0.018)}px ${Math.round(W * 0.026)}px;font-size:${Math.round(W * 0.026)}px;white-space:nowrap}
.fine{font-size:${Math.round(W * 0.0175)}px;color:#5B5F63;line-height:1.4;max-width:62%}
.dark{background:#16181A;color:#fff}.dark .eb{color:#E08A6C}.dark .sub,.dark .fine{color:rgba(255,255,255,.75)}
.ba{position:relative;border-radius:8px;overflow:hidden;box-shadow:0 24px 50px -20px rgba(22,24,26,.45)}
.ba img{display:block;width:100%;height:100%;object-fit:cover;position:absolute;inset:0}
.ba .r{clip-path:inset(0 0 0 50%)}.ba i{position:absolute;top:0;bottom:0;left:50%;width:4px;margin-left:-2px;background:#fff}
.tag{position:absolute;top:16px;font-family:M;font-size:${Math.round(W * 0.017)}px;letter-spacing:.12em;color:#fff;padding:6px 10px;border-radius:3px;z-index:2}
.ai{position:absolute;bottom:14px;left:14px;font-size:${Math.round(W * 0.016)}px;background:rgba(22,24,26,.78);color:#fff;padding:5px 9px;border-radius:3px;z-index:2}
ol{list-style:none;counter-reset:n;display:grid;gap:${Math.round(W * 0.022)}px}
ol li{counter-increment:n;display:flex;gap:18px;align-items:baseline;font-size:${Math.round(W * 0.04)}px;line-height:1.25;font-weight:500}
ol li::before{content:counter(n);font-family:M;color:#B5482A;font-size:.8em;min-width:1.4em}
.price{color:#B5482A;font-weight:700;letter-spacing:-.035em;line-height:1}
.row{display:flex;justify-content:space-between;align-items:baseline;gap:20px;border-top:2px solid #E6E3DD;padding-top:18px}`;

function cardHtml(p, i, prices, W, H) {
  const tall = H / W > 1.4;
  const top = `<div class="top">${HOUSE(Math.round(W * 0.04))}FACET PRO</div>`;
  const fine = (txt) => `<div class="fine">${txt}</div>`;
  const cta = `<div class="cta">See yours → facetpro.co.uk</div>`;
  if (p.kind === 'price') {
    const when = `Prices from the Facet Pro estimator, ${TODAY}.`;
    const body = p.compare
      ? `<div style="display:grid;gap:22px;margin-top:${tall ? 50 : 30}px">${[['a', p.labels[0]], ['b', p.labels[1]]].map(([k, l]) =>
        `<div class="row"><div style="font-size:${Math.round(W * 0.04)}px;font-weight:600">${esc(l)}</div><div class="price" style="font-size:${Math.round(W * 0.068)}px">${esc(range(prices[k]))}</div></div>`).join('')}</div>`
      : `<div class="price" style="font-size:${Math.round(W * (range(prices).length > 15 ? 0.105 : 0.125))}px;margin-top:${tall ? 70 : 48}px">${esc(range(prices))}</div>`;
    return `<style>${CSS(W, H)}</style>${top}
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <div class="eb">What it costs · ${esc(TODAY)}</div>
      <h1 style="font-size:${Math.round(W * 0.1)}px;margin-top:18px">${esc(p.headline)}</h1>
      <div class="sub" style="font-size:${Math.round(W * 0.034)}px;margin-top:16px">${esc(p.detail)} · on a typical ${{ semi: 'semi-detached', terrace: 'mid-terrace', detached: 'detached' }[p.houseType]} house</div>
      ${body}
      <div class="sub" style="font-size:${Math.round(W * 0.03)}px;margin-top:22px">Fitted · inc. VAT</div>
      </div>
      <div class="foot" style="margin-top:0">${fine(`Planning estimate, not a quotation. ${when} Your own house will differ — an installer confirms on survey.`)}${cta}</div>`;
  }
  if (p.kind === 'reveal') {
    const imgH = Math.round((W - 2 * W * 0.07) * (tall ? 0.95 : 0.66));
    const [lb, la] = p.labels || ['BEFORE', 'AFTER'];
    const img = (k) => fileUrl(path.join(ROOT, 'assets', 'home', `${k}.webp`));
    return `<style>${CSS(W, H)}</style>${top}
      <div class="ba" style="height:${imgH}px;margin-top:${Math.round(W * 0.05)}px">
        <img src="${img(p.before)}"><img class="r" src="${img(p.after)}"><i></i>
        <span class="tag" style="left:16px;background:rgba(22,24,26,.78)">${esc(lb.toUpperCase())}</span>
        <span class="tag" style="right:16px;background:#B5482A">${esc(la.toUpperCase())}</span>
        <span class="ai">AI illustration · not a real home</span>
      </div>
      <h1 style="font-size:${Math.round(W * 0.064)}px;margin-top:${Math.round(W * 0.05)}px">${esc(p.headline)}</h1>
      <div class="sub" style="font-size:${Math.round(W * 0.03)}px;margin-top:14px">${esc(p.sub)}</div>
      <div class="foot">${fine('Example house: an AI-generated illustration. Free · no account · no sales call.')}${cta}</div>`;
  }
  // tip
  const dark = !p.list;
  return `<style>${CSS(W, H)}</style><div class="${dark ? 'dark' : ''}" style="position:absolute;inset:0;padding:${Math.round(W * 0.07)}px;display:flex;flex-direction:column">${top.replace('<div class="top">', `<div class="top" style="color:${dark ? '#fff' : '#16181A'}">`)}
      <div style="flex:1;display:flex;flex-direction:column;justify-content:center">
      <div class="eb">${esc(p.eyebrow || '')}</div>
      <h1 style="font-size:${Math.round(W * (p.headline.length > 50 ? 0.078 : 0.1))}px;margin-top:20px">${esc(p.headline)}</h1>
      ${p.list ? `<ol style="margin-top:${Math.round(W * 0.06)}px">${p.list.map(x => `<li>${esc(x)}</li>`).join('')}</ol>`
        : `<div class="sub" style="font-size:${Math.round(W * 0.04)}px;margin-top:${Math.round(W * 0.05)}px;max-width:92%">${esc(p.sub)}</div>`}
      </div>
      <div class="foot" style="margin-top:0">${fine('facetpro.co.uk · see your house, see the price')}${cta}</div></div>`;
}

/* ── captions ── */
const HASHTAGS = { price: '#homeimprovement #newwindows #ukhomes #renovation #homeideas', reveal: '#beforeandafter #homeexterior #ukhomes #kerbappeal #homeinspo', tip: '#homeimprovement #homeowneruk #renovationtips #ukhomes' };
// Every price caption already says inc. VAT; this adds what it is and when.
const ESTIMATE_LINE = 'Planning estimate, not a quotation.';
function captions(p, i, prices) {
  const text = typeof p.caption === 'function' ? p.caption(p.compare ? { a: range(prices.a), b: range(prices.b) } : range(prices)) : p.caption;
  const est = p.kind === 'price' ? ` ${ESTIMATE_LINE} Prices on ${TODAY}.` : '';
  const ai = p.kind === 'reveal' ? ' (AI illustration — not a real home.)' : '';
  const ig = `${text}${est}${ai}\n\nLink in bio.\n\n${HASHTAGS[p.kind]}`;
  const fb = `${text}${est}${ai}\n\nSee yours: ${link(p, 'facebook', i)}`;
  // X: a link counts as 23 characters whatever its length.
  let xBody = `${text}${p.kind === 'price' ? ' Planning estimate, not a quote.' : ''}`;
  const xLen = (s) => s.length + 1 + 23;
  while (xLen(xBody) > 280 && xBody.includes('. ')) xBody = xBody.slice(0, xBody.lastIndexOf('. ') + 1);
  if (xLen(xBody) > 280) throw new Error(`Day ${i + 1}: X post too long even trimmed`);
  const x = `${xBody} ${link(p, 'x', i)}`;
  const pin = `${text}${est}${ai}`.slice(0, 500);
  return { ig, fb, x, pin };
}

const csv = (rows) => rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n') + '\r\n';

(async () => {
  let chromium;
  try { ({ chromium } = require('playwright-core')); } catch (_) { console.error('npm install first (playwright-core is a dev dependency).'); process.exit(2); }
  fs.mkdirSync(IMG_DIR, { recursive: true });
  fs.mkdirSync(OUT, { recursive: true });

  console.log(`Pricing ${plan.filter(p => p.kind === 'price').length} posts from ${SITE}…`);
  const prices = [];
  for (const p of plan) prices.push(p.kind === 'price' ? await p.price() : null);

  const browser = await chromium.launch({ executablePath: CHROME });
  const shoot = async (html, W, H, file) => {
    const page = await browser.newPage({ viewport: { width: W, height: H } });
    /* From a file, not setContent: an about:blank page may not load file://
       fonts or pictures, and silently falls back to a serif and blank images. */
    const tmp = path.join(os.tmpdir(), `facetpro-social-${process.pid}.html`);
    fs.writeFileSync(tmp, `<!doctype html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`);
    await page.goto(fileUrl(tmp), { waitUntil: 'load' });
    const fontOk = await page.evaluate(async () => { await document.fonts.ready; return document.fonts.check('700 40px G'); });
    const imgsOk = await page.evaluate(() => [...document.images].every(i => i.complete && i.naturalWidth > 0));
    if (!fontOk || !imgsOk) throw new Error(`${path.basename(file)}: ${!fontOk ? 'font' : 'an image'} did not load`);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(150);
    await page.screenshot({ path: file, type: 'jpeg', quality: 88 });
    await page.close();
  };

  const rows = { instagram: [], facebook: [], x: [], pinterest: [] };
  const preview = [];
  for (let i = 0; i < plan.length; i++) {
    const p = plan[i];
    const n = String(i + 1).padStart(2, '0');
    const feed = `${n}-${p.slug}.jpg`, pinFile = `${n}-${p.slug}-pin.jpg`;
    await shoot(cardHtml(p, i, prices[i], 1080, 1350), 1080, 1350, path.join(IMG_DIR, feed));
    await shoot(cardHtml(p, i, prices[i], 1000, 1500), 1000, 1500, path.join(IMG_DIR, pinFile));
    const url = (f) => `${SITE}/assets/social/${MONTH}/${f}`;
    const c = captions(p, i, prices[i]);
    const day = dayOf(i);
    rows.instagram.push([c.ig, url(feed), '', `${day} ${TIMES.instagram}`]);
    rows.facebook.push([c.fb, url(feed), '', `${day} ${TIMES.facebook}`]);
    rows.x.push([c.x, url(feed), '', `${day} ${TIMES.x}`]);
    rows.pinterest.push([c.pin, url(pinFile), '', `${day} ${TIMES.pinterest}`, p.pinTitle.slice(0, 100), p.alt, link(p, 'pinterest', i), BOARD]);
    preview.push({ day, n, p, c, feed, pinFile });
    process.stdout.write(`\r${i + 1}/${plan.length}`);
  }
  await browser.close();
  console.log('');

  const head = ['Text', 'Image URL', 'Tags', 'Posting Time'];
  fs.writeFileSync(path.join(OUT, 'buffer-instagram.csv'), csv([head, ...rows.instagram]));
  fs.writeFileSync(path.join(OUT, 'buffer-facebook.csv'), csv([head, ...rows.facebook]));
  fs.writeFileSync(path.join(OUT, 'buffer-x.csv'), csv([head, ...rows.x]));
  fs.writeFileSync(path.join(OUT, 'buffer-pinterest.csv'), csv([[...head, 'Title', 'Alt Text', 'Link', 'Board Name'], ...rows.pinterest]));
  fs.writeFileSync(path.join(OUT, 'TikTok - video to come.txt'), 'TikTok is video-first, and launch video is still being decided. Buffer\'s bulk upload does not take video, so TikTok posts will be added separately once the videos exist.\n');

  const img = (f) => fileUrl(path.join(IMG_DIR, f));
  fs.writeFileSync(path.join(OUT, 'PREVIEW - approve before upload.html'), `<!doctype html><meta charset="utf-8"><title>Facet Pro social · ${MONTH}</title>
<style>body{font:15px/1.5 -apple-system,sans-serif;background:#F6F4F0;color:#16181A;margin:0;padding:24px}h1{margin:0 0 4px}.d{display:grid;grid-template-columns:270px 180px 1fr;gap:18px;background:#fff;border:1px solid #E6E3DD;border-radius:8px;padding:16px;margin:14px 0}
.d img{width:100%;border-radius:4px}pre{white-space:pre-wrap;font:inherit;margin:0 0 10px;background:#F6F4F0;padding:8px;border-radius:4px}b{font-size:12px;letter-spacing:.08em;color:#5B5F63}@media(max-width:800px){.d{grid-template-columns:1fr}}</style>
<h1>Facet Pro · ${MONTH} · ${plan.length} days from ${START}</h1><p>Prices checked against the live engine on ${TODAY}. Approve this, then deploy (so the images are public) and upload the four CSVs to Buffer.</p>
${preview.map(({ day, n, p, c, feed, pinFile }) => `<div class="d"><div><b>DAY ${n} · ${day} · ${p.kind.toUpperCase()}</b><img src="${img(feed)}"></div><div><b>PINTEREST</b><img src="${img(pinFile)}"></div><div>
<b>INSTAGRAM</b><pre>${esc(c.ig)}</pre><b>FACEBOOK</b><pre>${esc(c.fb)}</pre><b>X</b><pre>${esc(c.x)}</pre><b>PINTEREST · ${esc(p.pinTitle)}</b><pre>${esc(c.pin)}</pre></div></div>`).join('')}`);

  console.log(`Images: ${IMG_DIR}\nBuffer files and preview: ${OUT}`);
})().catch((e) => { console.error('\n' + e.message); process.exit(1); });
