/* Sizing a house from its Energy Performance Certificate (built 7 Oct 2026,
   OFF until EPC_SIZING=on — see "EPC sizing" in the README).

   Why. The photo measures the front with the door as a ruler, then multiplies
   up for walls nobody photographed. Both halves are guesses about this house:
   the ruler assumes a door height, and the multiplier assumes a typical plan.
   An EPC was drawn up by an assessor who visited, and it records the total
   floor area (to RICS standards), the built form (detached, semi, terrace...)
   and the room height. From those the whole house's walls follow by the same
   rule the RdSAP method itself uses: exposed perimeter x wall height.

   What it does NOT record for a house: how many storeys, or how wide the
   front is. Storeys come from the property type (a bungalow is one) or the
   caller; the frontage from the caller (the photo) or the typical plan for
   the type, and the range is wider when it is assumed.

   Calibration. Gross wall (perimeter x height) includes windows and doors and
   the survey figures do not. The net share is set per type so that a house of
   the English Housing Survey's mean floor area comes out at exactly the
   surveyed average in measure.js — so this agrees with what the site already
   believes about an average house, and moves with the real floor area of this
   one. That is calibration to averages, not validation against houses:
   scripts/validate-epc.js is the check, and it has to be run against real
   jobs before this is switched on.

   Licence. Everything read here is a non-address field, Open Government
   Licence v3.0. The EPC register's ADDRESS fields are Ordnance Survey and
   Royal Mail data with use restrictions; this file never reads, stores or
   shows them. Houses are found by UPRN, which the address lookup supplies. */

'use strict';

const measure = require('./measure');

const API = (process.env.EPC_API_BASE || 'https://api.get-energy-performance-data.communities.gov.uk').replace(/\/$/, '');
const enabled = () => process.env.EPC_SIZING === 'on' && !!process.env.EPC_TOKEN;

/* RdSAP floor-to-ceiling, plus the floor and ceiling between storeys, gives
   the storey height that walls are measured over. */
const FLOOR_ZONE_M = 0.25;
const DEFAULT_ROOM_HEIGHT_M = 2.4;
/* Unvalidated, so not tight. Wider again when the frontage is assumed. */
const SPREAD = { frontageMeasured: 0.12, frontageTypical: 0.18 };

/* Built form as text (the API) or as an RdSAP code (older schemas). */
const BUILT_FORM = {
  detached: 'detached', 'semi-detached': 'semi', semidetached: 'semi',
  'end-terrace': 'endTerrace', endterrace: 'endTerrace', 'enclosed end-terrace': 'endTerrace',
  'mid-terrace': 'terrace', midterrace: 'terrace', 'enclosed mid-terrace': 'terrace',
  1: 'detached', 2: 'semi', 3: 'endTerrace', 4: 'terrace', 5: 'endTerrace', 6: 'terrace',
};
function builtFormKey(v) {
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  return BUILT_FORM[s] || BUILT_FORM[s.replace(/[^a-z]/g, '')] || null;
}

/* Houses and bungalows only. A flat's walls are the block's, not the
   homeowner's to re-clad, and this product does not price them. */
function propertyKind(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('bungalow') || s === '1') return 'bungalow';
  if (s.includes('flat') || s.includes('maisonette') || s === '2' || s === '3') return 'flat';
  if (s.includes('park home')) return 'other';
  if (s.includes('house') || s === '0') return 'house';
  return null;
}

/* The certificate's layout differs by schema version — flat or nested,
   snake_case or UPPER_SNAKE — so fields are found by name wherever they sit. */
function findField(obj, names, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return undefined;
  const want = new Set(names.map(n => n.toLowerCase().replace(/[^a-z]/g, '')));
  for (const [k, v] of Object.entries(obj)) {
    if (want.has(k.toLowerCase().replace(/[^a-z]/g, '')) && v !== null && v !== '' && typeof v !== 'object') return v;
  }
  for (const v of Object.values(obj)) {
    if (v && typeof v === 'object') {
      const hit = findField(v, names, depth + 1);
      if (hit !== undefined) return hit;
    }
  }
  return undefined;
}

/* Every value of a field, for those recorded per storey (room height). */
function allValues(obj, names, out = [], depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 6) return out;
  const want = new Set(names.map(n => n.toLowerCase().replace(/[^a-z]/g, '')));
  for (const [k, v] of Object.entries(obj)) {
    if (want.has(k.toLowerCase().replace(/[^a-z]/g, '')) && v != null && typeof v !== 'object') out.push(v);
    else if (v && typeof v === 'object') allValues(v, names, out, depth + 1);
  }
  return out;
}

const num = (v) => { const n = Number(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) && n > 0 ? n : null; };

/* The fields sizing needs, from one certificate's `data` block. */
function readCertificate(data) {
  const heights = allValues(data, ['floor_height', 'room_height']).map(num).filter(h => h && h >= 1.8 && h <= 5);
  return {
    floorAreaM2: num(findField(data, ['total_floor_area'])),
    builtForm: builtFormKey(findField(data, ['built_form'])),
    propertyKind: propertyKind(findField(data, ['property_type'])),
    floorHeightM: heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : null,
    registrationDate: String(findField(data, ['registration_date', 'lodgement_date', 'lodgement_datetime']) || '').slice(0, 10) || null,
    extensions: num(findField(data, ['extension_count'])) || 0,
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function exposedPerimeterM(plan, footprintM2, frontageM) {
  const W = frontageM, D = footprintM2 / W;
  if (plan.exposed === '2W') return 2 * W;
  if (plan.exposed === '2W+D') return 2 * W + D;
  return 2 * W + 2 * D;
}

/* Net share of gross wall, per type, so the EHS mean house lands on the
   surveyed average. Derived, not typed in, so it moves with measure.js. */
const NET_SHARE = Object.fromEntries(Object.entries(measure.PLAN_GEOMETRY).map(([type, plan]) => {
  const gross = exposedPerimeterM(plan, plan.floorAreaM2 / plan.storeys, plan.frontageM)
    * plan.storeys * (DEFAULT_ROOM_HEIGHT_M + FLOOR_ZONE_M);
  return [type, measure.HOUSE_TYPE_PRIORS[type].wallM2 / gross];
}));

/* Wall area from a certificate. `storeys` and `frontageM` are optional and
   come from the photo when it can tell; otherwise the typical plan. Returns
   null when the certificate cannot size a house (a flat, no floor area, an
   unknown built form) — the caller falls back to the photo. */
function sizeFromEpc(cert, { storeys, frontageM } = {}) {
  if (!cert || !cert.floorAreaM2) return null;
  if (cert.propertyKind === 'flat' || cert.propertyKind === 'other') return null;
  const type = cert.propertyKind === 'bungalow' ? 'bungalow' : cert.builtForm;
  if (!type || !measure.PLAN_GEOMETRY[type]) return null;
  const plan = measure.PLAN_GEOMETRY[type];
  const st = Number.isInteger(storeys) && storeys >= 1 && storeys <= 4 ? storeys : plan.storeys;
  const measuredFront = Number.isFinite(frontageM) && frontageM >= 3 && frontageM <= 25;
  const W = measuredFront ? frontageM : plan.frontageM;
  const footprint = cert.floorAreaM2 / st;
  const room = clamp(cert.floorHeightM || DEFAULT_ROOM_HEIGHT_M, 2.1, 3.5);
  const gross = exposedPerimeterM(plan, footprint, W) * st * (room + FLOOR_ZONE_M);
  const m2 = gross * NET_SHARE[type];
  if (!(m2 >= 20 && m2 <= 600)) return null;
  const spread = measuredFront ? SPREAD.frontageMeasured : SPREAD.frontageTypical;
  const round5 = (n) => Math.max(5, Math.round(n / 5) * 5);
  const label = measure.HOUSE_TYPE_PRIORS[type].label;
  return {
    m2: Math.round(m2),
    low: round5(m2 * (1 - spread)),
    high: round5(m2 * (1 + spread)),
    method: 'epc',
    houseType: type,
    houseTypeLabel: label,
    confidence: measuredFront ? 'good' : 'rough',
    notes: [
      `Sized from your home’s Energy Performance Certificate${cert.registrationDate ? ` (${cert.registrationDate})` : ''}: ${Math.round(cert.floorAreaM2)} m² of floor, ${label.toLowerCase()}.`,
      `${st} storey${st === 1 ? '' : 's'}, room height ${room.toFixed(1)} m${cert.floorHeightM ? '' : ' (typical; the certificate did not say)'}, front about ${W.toFixed(1)} m wide${measuredFront ? ' from your photo' : ' (typical for this type)'}.`,
    ],
    epc: { floorAreaM2: cert.floorAreaM2, builtForm: cert.builtForm, propertyKind: cert.propertyKind, floorHeightM: cert.floorHeightM, registrationDate: cert.registrationDate },
  };
}

async function getJson(url, token, ms = 8000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: ctl.signal });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`EPC register answered ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

/* The newest certificate for a UPRN, read. Null when it has none. */
async function lookupByUprn(uprn, { token = process.env.EPC_TOKEN } = {}) {
  const digits = String(uprn ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 12 || !token) return null;
  const search = await getJson(`${API}/api/domestic/search?uprn=${digits.padStart(12, '0')}&page_size=20`, token);
  const list = (search?.data || []).filter(c => c?.certificateNumber);
  if (!list.length) return null;
  list.sort((a, b) => String(b.registrationDate || '').localeCompare(String(a.registrationDate || '')));
  const cert = await getJson(`${API}/api/certificate?certificate_number=${encodeURIComponent(list[0].certificateNumber)}`, token);
  return cert?.data ? readCertificate(cert.data) : null;
}

module.exports = { enabled, readCertificate, sizeFromEpc, lookupByUprn, builtFormKey, propertyKind, NET_SHARE, _internals: { findField, exposedPerimeterM } };
