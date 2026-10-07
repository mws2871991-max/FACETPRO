#!/usr/bin/env node
/* Is EPC sizing right? Checked against jobs whose walls were really measured.

   The gate before EPC_SIZING=on. Each row is a house you have surveyed: its
   postcode and house number (or UPRN), and the wall area you measured. This
   sizes each from its energy certificate exactly as the site would, and puts
   that beside both the measured figure and what the site uses today without a
   photo (the typical figure for the house type) — so the question it answers
   is "is this better than what we do now, and by how much".

   The jobs file is addresses of real homes. It lives OUTSIDE this public
   repository (default ~/facetpro-houses/epc-jobs.json), and so does the
   report. Copy epc-jobs.template.json from there to start.

   Usage (EPC_TOKEN and ADDRESS_LOOKUP_KEY in the environment):
     npm run validate:epc
     npm run validate:epc -- --file ~/somewhere/jobs.json
     npm run validate:epc -- --dump        also print the first certificate's
                                           field names, to confirm the schema */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const epc = require('../epc');
const lookup = require('../addresslookup');
const measure = require('../measure');

const arg = (n, d = null) => { const i = process.argv.indexOf(`--${n}`); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d; };
const DIR = path.join(os.homedir(), 'facetpro-houses');
const FILE = (arg('file') || path.join(DIR, 'epc-jobs.json')).replace(/^~/, os.homedir());
const DUMP = process.argv.includes('--dump');

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : NaN; };
const pct = (a, b) => ((a - b) / b) * 100;

async function uprnFor(job) {
  if (job.uprn) return String(job.uprn);
  const list = await lookup.addressesFor(job.postcode);
  if (!list?.length) return null;
  const n = String(job.houseNumber ?? job.houseName ?? '').trim().toLowerCase();
  const hit = list.find(a => {
    const first = a.label.split(',')[0].toLowerCase();
    return n && (first.startsWith(n + ' ') || first === n || first.includes(n));
  });
  return hit?.uprn || null;
}

(async () => {
  if (!process.env.EPC_TOKEN) { console.error('Set EPC_TOKEN (GOV.UK One Login → Get energy performance of buildings data → API token).'); process.exit(2); }
  if (!fs.existsSync(FILE)) { console.error(`No jobs file at ${FILE}. Copy epc-jobs.template.json beside it and fill it in.`); process.exit(2); }
  const jobs = JSON.parse(fs.readFileSync(FILE, 'utf8')).filter(j => j && !j.comment && Number(j.knownWallAreaM2) > 0);
  if (!jobs.length) { console.error('No usable rows: each needs knownWallAreaM2 > 0 and a postcode + houseNumber, or a uprn.'); process.exit(2); }

  const rows = [];
  for (const job of jobs) {
    const known = Number(job.knownWallAreaM2);
    const row = { label: job.label || job.postcode || job.uprn, known };
    try {
      const uprn = await uprnFor(job);
      if (!uprn) { rows.push({ ...row, problem: 'address not found (check postcode / houseNumber, or give uprn)' }); continue; }
      if (DUMP && !rows.some(r => r.dumped)) {
        const API = (process.env.EPC_API_BASE || 'https://api.get-energy-performance-data.communities.gov.uk').replace(/\/$/, '');
        const s = await (await fetch(`${API}/api/domestic/search?uprn=${uprn.padStart(12, '0')}`, { headers: { Authorization: `Bearer ${process.env.EPC_TOKEN}`, Accept: 'application/json' } })).json();
        const num = s?.data?.[0]?.certificateNumber;
        if (num) {
          const c = await (await fetch(`${API}/api/certificate?certificate_number=${num}`, { headers: { Authorization: `Bearer ${process.env.EPC_TOKEN}`, Accept: 'application/json' } })).json();
          const keys = (o, p = '') => Object.entries(o || {}).flatMap(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? keys(v, `${p}${k}.`) : [`${p}${k}${Array.isArray(v) ? '[]' : ''}`]);
          console.log('Certificate fields (first job):\n  ' + keys(c?.data).filter(k => !/address|postcode|post_town/i.test(k)).join('\n  '));
        }
        row.dumped = true;
      }
      const cert = await epc.lookupByUprn(uprn);
      if (!cert) { rows.push({ ...row, problem: 'no energy certificate for this address' }); continue; }
      const sized = epc.sizeFromEpc(cert, { storeys: job.storeys, frontageM: job.frontageM });
      if (!sized) { rows.push({ ...row, problem: `certificate cannot size it (${cert.propertyKind || '?'}, ${cert.builtForm || 'no built form'})` }); continue; }
      const typical = measure.HOUSE_TYPE_PRIORS[sized.houseType].wallM2;
      rows.push({ ...row, type: sized.houseType, floor: cert.floorAreaM2, epc: sized.m2, low: sized.low, high: sized.high, typical,
        epcErr: pct(sized.m2, known), typicalErr: pct(typical, known), inRange: known >= sized.low && known <= sized.high, ratio: known / sized.m2 });
    } catch (err) {
      rows.push({ ...row, problem: err.message });
    }
  }

  const ok = rows.filter(r => !r.problem);
  const lines = [];
  lines.push(`# EPC sizing check — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, '', `${ok.length} of ${rows.length} jobs sized.`, '');
  lines.push('| Job | Type | Floor m² | Measured wall m² | EPC m² (range) | EPC error | Typical m² | Typical error |', '|---|---|---|---|---|---|---|---|');
  for (const r of rows) {
    lines.push(r.problem ? `| ${r.label} | — | — | ${r.known} | ${r.problem} | | | |`
      : `| ${r.label} | ${r.type} | ${Math.round(r.floor)} | ${r.known} | ${r.epc} (${r.low}–${r.high})${r.inRange ? '' : ' ✗'} | ${r.epcErr.toFixed(0)}% | ${r.typical} | ${r.typicalErr.toFixed(0)}% |`);
  }
  if (ok.length) {
    const mae = (k) => median(ok.map(r => Math.abs(r[k])));
    lines.push('', '## Summary', '',
      `- Median error, EPC: **${mae('epcErr').toFixed(0)}%**; typical figure (today, no photo): **${mae('typicalErr').toFixed(0)}%**.`,
      `- Measured area inside the EPC range: **${ok.filter(r => r.inRange).length} of ${ok.length}**.`,
      `- EPC within ±15%: ${ok.filter(r => Math.abs(r.epcErr) <= 15).length} of ${ok.length}.`);
    const byType = {};
    for (const r of ok) (byType[r.type] ||= []).push(r.ratio);
    lines.push('', 'Correction the data suggests (measured ÷ EPC, median by type; 1.00 = none):');
    for (const [t, rs] of Object.entries(byType)) lines.push(`- ${t}: ${median(rs).toFixed(2)} from ${rs.length} job${rs.length === 1 ? '' : 's'}${rs.length < 5 ? ' — too few to act on' : ''}`);
    lines.push('', 'Switch on when the EPC error is clearly below the typical figure\'s and most measured areas sit inside the range.');
  }
  const report = lines.join('\n');
  console.log('\n' + report);
  const out = path.join(DIR, 'runs');
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, `epc-check-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.md`);
  fs.writeFileSync(file, report + '\n');
  console.log(`\nReport: ${file}`);
})().catch((err) => { console.error(err); process.exit(1); });
