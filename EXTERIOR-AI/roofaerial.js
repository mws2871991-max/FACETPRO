'use strict';
/* The roof from above (0084) — Google Solar API, buildingInsights.

   A phone photo of the front sees one roof slope at a steep angle, so roof
   area and pitch are the least certain numbers we produce. Google's Solar API
   returns, for a building near a point, its roof segments measured from
   aerial imagery: each segment's area, its pitch, and the whole roof's area
   and footprint. That is better evidence than the photo, and it asks the
   homeowner for nothing.

   NOT WIRED IN. This module and scripts/solar-check.js exist so coverage and
   accuracy can be checked on real UK addresses first. Before it is used for
   customers: (1) a GOOGLE_SOLAR_API_KEY in the environment, (2) a check on
   5-10 houses we know, (3) Google added to the privacy notice as a processor
   — an address is personal data — and (4) the address, not just a postcode:
   findClosest picks the building nearest a point, and a postcode centroid is
   often a different house.

   Field names follow the public v1 reference (BuildingInsights.solarPotential
   .wholeRoofStats / roofSegmentStats[].{pitchDegrees, azimuthDegrees,
   stats.{areaMeters2, groundAreaMeters2}}, imageryQuality). */

const ENDPOINT = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';
const QUALITIES = ['HIGH', 'MEDIUM', 'LOW', 'BASE'];

function summarise(bi) {
  const sp = bi && bi.solarPotential;
  if (!sp) return null;
  const segs = Array.isArray(sp.roofSegmentStats) ? sp.roofSegmentStats : [];
  const segments = segs.map(s => ({
    pitchDeg: Number(s.pitchDegrees),
    azimuthDeg: Number(s.azimuthDegrees),
    areaM2: Number(s.stats && s.stats.areaMeters2),
    groundM2: Number(s.stats && s.stats.groundAreaMeters2),
  })).filter(s => Number.isFinite(s.areaM2) && s.areaM2 > 0);
  const whole = sp.wholeRoofStats || {};
  const roofAreaM2 = Number.isFinite(Number(whole.areaMeters2)) ? Number(whole.areaMeters2)
    : segments.reduce((a, s) => a + s.areaM2, 0);
  const footprintM2 = Number.isFinite(Number(whole.groundAreaMeters2)) ? Number(whole.groundAreaMeters2)
    : segments.reduce((a, s) => a + (Number.isFinite(s.groundM2) ? s.groundM2 : 0), 0);
  const pitched = segments.filter(s => Number.isFinite(s.pitchDeg));
  const pitchArea = pitched.reduce((a, s) => a + s.areaM2, 0);
  const pitchDeg = pitchArea > 0 ? pitched.reduce((a, s) => a + s.pitchDeg * s.areaM2, 0) / pitchArea : null;
  return {
    roofAreaM2: Math.round(roofAreaM2 * 10) / 10,
    footprintM2: Math.round(footprintM2 * 10) / 10,
    pitchDeg: pitchDeg === null ? null : Math.round(pitchDeg * 10) / 10,
    segments: segments.length,
    quality: QUALITIES.includes(bi.imageryQuality) ? bi.imageryQuality : null,
    imageryDate: bi.imageryDate || null,
    center: bi.center || null,
    postalCode: bi.postalCode || null,
  };
}

/* Never throws: a failure is { ok: false, reason }, so a caller can fall back
   to the photo the way every other optional source here does. */
async function roofFromAbove({ lat, lng, key, requiredQuality = 'MEDIUM', fetchImpl = globalThis.fetch, timeoutMs = 8000 } = {}) {
  if (!key) return { ok: false, reason: 'no key' };
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, reason: 'no location' };
  const q = new URLSearchParams({
    'location.latitude': String(lat), 'location.longitude': String(lng),
    requiredQuality: QUALITIES.includes(requiredQuality) ? requiredQuality : 'MEDIUM', key,
  });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${ENDPOINT}?${q}`, { signal: ctl.signal });
    if (res.status === 404) return { ok: false, reason: 'no building with imagery here' };
    if (!res.ok) return { ok: false, reason: `solar api ${res.status}` };
    const s = summarise(await res.json());
    if (!s || !(s.roofAreaM2 > 0)) return { ok: false, reason: 'no roof data' };
    return { ok: true, ...s };
  } catch (err) {
    return { ok: false, reason: err && err.name === 'AbortError' ? 'timed out' : (err && err.message) || 'failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { roofFromAbove, summarise, ENDPOINT };
