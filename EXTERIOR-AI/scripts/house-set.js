#!/usr/bin/env node
/* The test-house set: one change, run across every house, judged together.

   Why it exists (6 Oct). Render faults kept coming back because each fix was
   checked on the one or two houses to hand while testers walked different
   ones: a door held on the bay house turned brown on the 1930s house, and
   "fixed" meant "fixed on the house I tried". This runs a scenario across a
   folder of houses and writes one report — before, after, and a heat map of
   every pixel the render changed — so a door, a neighbour's window or a
   tile-hung wall that moved shows up in red whether or not the after picture
   looks plausible.

   The houses live OUTSIDE this repository (default ~/facetpro-houses):
   some are real houses whose owners have not been asked, and this repo is
   public. The reports are written there too, never here.

   Usage:
     npm run houses -- --scenario windows          (windows, door, roofline, roof, walls, makeover)
     npm run houses -- --scenario roof --exp kept-parts
     npm run houses -- --scenario roof --only 05,07  (file-name prefixes)
     npm run houses -- --site http://localhost:3999

   Against the live site it needs --yes: every render comes out of the same
   DAILY_RENDER_LIMIT real visitors use, and a run that hits it stops at once.

   Each house costs one photo analysis and one render against the site's
   daily caps. Run it against the live site only for a reason. */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const jpeg = require('jpeg-js');
const { PNG } = require('pngjs');
const catalogue = require('../catalogue.json');

const arg = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : fallback;
};
const SITE = (arg('site') || 'https://www.facetpro.co.uk').replace(/\/$/, '');
const DIR = arg('dir') || process.env.HOUSE_SET_DIR || path.join(os.homedir(), 'facetpro-houses');
const SCENARIO = arg('scenario', 'windows');
const EXP = arg('exp');
const ONLY = (arg('only') || '').split(',').map(s => s.trim()).filter(Boolean);
// --trim <id>: the roofline colour for this run (coastal-fog, ink-trim, cedar).
const TRIM = arg('trim');
// --roof <id>: add a roof finish to the scenario (slate-roof, charcoal-roof, terracotta).
const ROOF = arg('roof');
const MAX_EDGE = 1600;          // what the page downscales to before upload
const QUALITY = 85;
const CHANGED = 40;             // channel difference that counts as "changed"

const sw = (group, id) => (catalogue[group] || []).find(x => x.id === id);
const none = { claddingId: 'none', trimId: 'none', roofId: 'none', claddingName: 'Leave as it is', trimName: 'Leave as it is', roofName: 'Leave as it is' };
const windows = { windowStyleName: 'Casement', windowDoorColourName: 'Anthracite', windowDoorColourId: 'anthracite', windowBarsId: 'none' };
const SCENARIOS = {
  windows: { ...none, ...windows },
  door: { ...none, doorStyleName: 'Composite Door', doorStyleId: 'composite', windowDoorColourName: 'Black', windowDoorColourId: 'black' },
  roofline: { ...none, trimId: 'ink-trim', trimName: sw('trim', 'ink-trim')?.name },
  roof: { ...none, roofId: 'slate-roof', roofName: sw('roof', 'slate-roof')?.name },
  walls: { ...none, claddingId: 'alabaster', claddingName: sw('cladding', 'alabaster')?.name },
  makeover: { ...none, ...windows, doorStyleName: 'Composite Door', doorStyleId: 'composite', trimId: 'ink-trim', trimName: sw('trim', 'ink-trim')?.name },
};

function resizeRGBA(src, W, H) {
  const out = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const fx = Math.min(src.width - 1, Math.max(0, (x + 0.5) * src.width / W - 0.5));
    const fy = Math.min(src.height - 1, Math.max(0, (y + 0.5) * src.height / H - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(src.width - 1, x0 + 1), y1 = Math.min(src.height - 1, y0 + 1);
    const ax = fx - x0, ay = fy - y0;
    for (let c = 0; c < 4; c++) {
      const p = (xx, yy) => src.data[(yy * src.width + xx) * 4 + c];
      out[(y * W + x) * 4 + c] = Math.round((p(x0, y0) * (1 - ax) + p(x1, y0) * ax) * (1 - ay) + (p(x0, y1) * (1 - ax) + p(x1, y1) * ax) * ay);
    }
  }
  return { width: W, height: H, data: out };
}

/* As the page does: longest edge at most 1600px, JPEG at 0.85. */
function prepare(file) {
  const src = jpeg.decode(fs.readFileSync(file), { useTArray: true, maxMemoryUsageInMB: 512 });
  const s = Math.min(1, MAX_EDGE / Math.max(src.width, src.height));
  const img = s < 1 ? resizeRGBA(src, Math.round(src.width * s), Math.round(src.height * s)) : { width: src.width, height: src.height, data: Buffer.from(src.data) };
  return { img, jpeg: jpeg.encode(img, QUALITY).data };
}

/* The site limits renders and analyses per minute from one address, as it
   should. A 429 waits a minute and tries again, up to three times; PACE
   seconds between houses keeps most runs under the limit to begin with. */
const PACE = Number(arg('pace', '12'));
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const post = async (p, body, tries = 3) => {
  for (let t = 0; ; t++) {
    const r = await fetch(SITE + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (_) { /* not JSON */ }
    /* The daily cap is the live site's, shared with real visitors (6 Oct: a
       run used the last of it). Stop the whole run on it — never retry. */
    if (r.status === 429 && /photorealistic pictures right now|daily/i.test(String(j.error || '') + String(j.reason || ''))) {
      console.error(`\nThe site's DAILY render cap is used up — stopping. Real visitors can't get renders until midnight UTC.`);
      process.exit(3);
    }
    if (r.status === 429 && t < tries) { console.log(`  ${p}: rate limited, waiting a minute`); await sleep(61000); continue; }
    return { status: r.status, body: j };
  }
};

/* Every pixel the render moved, in red over a dimmed copy of the photo, and
   the share of the frame that moved. */
function diff(before, renderPng) {
  /* /r/ answers in the format the request accepts (renderformats.js, 7 Oct):
     a plain fetch gets JPEG now, not the provider's PNG. Read either. */
  const isPng = renderPng[0] === 0x89 && renderPng[1] === 0x50;
  const after = isPng ? PNG.sync.read(renderPng) : jpeg.decode(renderPng, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 512 });
  const b = resizeRGBA(before, after.width, after.height);
  const out = new PNG({ width: after.width, height: after.height });
  let changed = 0;
  for (let i = 0; i < after.width * after.height; i++) {
    const k = i * 4;
    const d = Math.max(Math.abs(after.data[k] - b.data[k]), Math.abs(after.data[k + 1] - b.data[k + 1]), Math.abs(after.data[k + 2] - b.data[k + 2]));
    const grey = Math.round((b.data[k] + b.data[k + 1] + b.data[k + 2]) / 3 * 0.45);
    if (d > CHANGED) changed++;
    const heat = Math.min(255, Math.max(0, (d - 12) * 4));
    out.data[k] = Math.min(255, grey + heat); out.data[k + 1] = Math.max(0, grey - heat / 3); out.data[k + 2] = Math.max(0, grey - heat / 3); out.data[k + 3] = 255;
  }
  return { png: PNG.sync.write(out), changedShare: changed / (after.width * after.height) };
}

(async () => {
  if (!SCENARIOS[SCENARIO]) { console.error(`Unknown scenario "${SCENARIO}". One of: ${Object.keys(SCENARIOS).join(', ')}`); process.exit(2); }
  if (!fs.existsSync(DIR)) { console.error(`No house folder at ${DIR}. Put the test photos there (never in this repo).`); process.exit(2); }
  const houses = fs.readdirSync(DIR).filter(f => /\.jpe?g$/i.test(f)).filter(f => !ONLY.length || ONLY.some(p => f.startsWith(p))).sort();
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const out = path.join(DIR, 'runs', `${stamp}-${SCENARIO}${EXP ? `-${EXP}` : ''}`);
  fs.mkdirSync(out, { recursive: true });
  console.log(`${houses.length} houses · scenario ${SCENARIO}${EXP ? ` · exp ${EXP}` : ''} · ${SITE}\n→ ${out}`);
  if (/facetpro\.co\.uk/.test(SITE)) {
    console.log(`\nThis uses up to ${houses.length} of the LIVE site's daily renders, which real visitors share.`);
    if (!process.argv.includes('--yes')) { console.log('Add --yes to go ahead (best overnight, or after raising DAILY_RENDER_LIMIT).'); process.exit(1); }
  }

  const rows = [];
  for (const [n, file] of houses.entries()) {
    if (n) await sleep(PACE * 1000);
    const name = file.replace(/\.jpe?g$/i, '');
    const row = { name };
    try {
      const { img, jpeg: bytes } = prepare(path.join(DIR, file));
      fs.writeFileSync(path.join(out, `${name}-before.jpg`), bytes);
      const image = Buffer.from(bytes).toString('base64');
      const det = await post('/api/detect', { image, mimeType: 'image/jpeg' });
      row.windows = det.body.frontWindowCount ?? null;
      if (det.status !== 200) { row.note = `analysis ${det.status}: ${det.body.error || ''}`; rows.push(row); console.log(name, row.note); continue; }
      const t0 = Date.now();
      const r = await post('/api/render', { image, mimeType: 'image/jpeg', detectionId: det.body.detectionId,
        ...SCENARIOS[SCENARIO], ...(TRIM ? { trimId: TRIM, trimName: sw('trim', TRIM)?.name } : {}), ...(ROOF ? { roofId: ROOF, roofName: sw('roof', ROOF)?.name } : {}), ...(EXP ? { experiments: [EXP] } : {}) });
      row.seconds = Math.round((Date.now() - t0) / 1000);
      if (r.status !== 200 || !r.body.url) { row.note = `render ${r.status}: ${r.body.error || ''}`; rows.push(row); console.log(name, row.note); continue; }
      row.roofSkipped = r.body.roofSkipped || null;
      row.missed = (r.body.missedChanges || []).join(', ') || null;
      const png = Buffer.from(await (await fetch(SITE + r.body.url)).arrayBuffer());
      row.afterFile = `${name}-after.${png[0] === 0x89 ? 'png' : 'jpg'}`;
      fs.writeFileSync(path.join(out, row.afterFile), png);
      const d = diff(img, png);
      fs.writeFileSync(path.join(out, `${name}-changed.png`), d.png);
      row.changed = Math.round(d.changedShare * 1000) / 10;
      row.ok = true;
      console.log(`${name}: ${row.changed}% of the frame changed${row.roofSkipped ? `, roof skipped (${row.roofSkipped})` : ''}${row.missed ? `, missed: ${row.missed}` : ''}, ${row.seconds}s`);
    } catch (err) {
      row.note = `failed: ${err.message}`; console.log(name, row.note);
    }
    rows.push(row);
  }

  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const html = `<!doctype html><meta charset="utf-8"><title>Houses · ${esc(SCENARIO)}</title>
<style>body{font:15px/1.5 -apple-system,sans-serif;margin:24px;background:#f6f4ef;color:#18181b}h1{font-size:22px}
.row{background:#fff;border:1px solid #e4e4e7;border-radius:12px;padding:12px;margin:14px 0}.imgs{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
img{width:100%;border-radius:8px;display:block}.cap{font-size:13px;color:#52525b;margin-top:2px}.bad{color:#b91c1c}</style>
<h1>${esc(SCENARIO)}${EXP ? ` · ${esc(EXP)}` : ''} — ${rows.length} houses</h1>
<p>${esc(SITE)} · ${esc(stamp)}. Third picture: every pixel the render changed, in red. Anything red outside what was asked for is a fault.</p>
${rows.map(r => `<div class="row"><b>${esc(r.name)}</b> · ${r.ok ? `${r.changed}% of the frame changed · ${r.windows ?? '?'} windows counted · ${r.seconds}s${r.roofSkipped ? ` · <span class="bad">roof skipped (${esc(r.roofSkipped)})</span>` : ''}${r.missed ? ` · <span class="bad">missed: ${esc(r.missed)}</span>` : ''}` : `<span class="bad">${esc(r.note)}</span>`}
<div class="imgs"><div><img src="${esc(r.name)}-before.jpg"><div class="cap">Before</div></div>${r.ok ? `<div><img src="${esc(r.afterFile)}"><div class="cap">After</div></div><div><img src="${esc(r.name)}-changed.png"><div class="cap">What changed</div></div>` : ''}</div></div>`).join('\n')}`;
  fs.writeFileSync(path.join(out, 'report.html'), html);
  fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify({ site: SITE, scenario: SCENARIO, exp: EXP, rows }, null, 2));
  console.log(`\nReport: ${path.join(out, 'report.html')}`);
})();
