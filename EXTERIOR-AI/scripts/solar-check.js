#!/usr/bin/env node
'use strict';
/* Coverage and accuracy check for the roof-from-above idea (0084).

   Usage:
     GOOGLE_SOLAR_API_KEY=... node scripts/solar-check.js "14 Example Road, Town AB1 2CD" "..."

   Each address is geocoded (Google Geocoding API, same key — enable both
   "Solar API" and "Geocoding API" on the project), then buildingInsights is
   asked for the nearest building. Prints the roof area, footprint, average
   pitch, segment count and imagery quality, and the distance between the
   geocoded point and the building found, so a wrong-house match is visible.

   Compare against houses whose roofs we know. Nothing is stored; addresses
   given here are sent to Google, so use our own test houses or ones we have
   permission for. */
const { roofFromAbove } = require('../roofaerial');

const key = process.env.GOOGLE_SOLAR_API_KEY;
if (!key) { console.error('Set GOOGLE_SOLAR_API_KEY.'); process.exit(1); }
const addresses = process.argv.slice(2);
if (!addresses.length) { console.error('Give one or more addresses in quotes.'); process.exit(1); }

const metres = (a, b) => {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.latitude - a.lat) * r, dLng = (b.longitude - a.lng) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.latitude * r) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(x)));
};

(async () => {
  for (const address of addresses) {
    const g = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?${new URLSearchParams({ address, region: 'uk', key })}`).then(r => r.json()).catch(() => null);
    const hit = g && g.results && g.results[0];
    if (!hit) { console.log(`${address}\n  geocode failed: ${g && g.status}`); continue; }
    const { lat, lng } = hit.geometry.location;
    const precise = hit.geometry.location_type === 'ROOFTOP';
    const r = await roofFromAbove({ lat, lng, key });
    console.log(`${address}\n  geocoded ${precise ? 'to the rooftop' : `approximately (${hit.geometry.location_type})`}`);
    if (!r.ok) { console.log(`  roof: none — ${r.reason}`); continue; }
    console.log(`  roof ${r.roofAreaM2} m² · footprint ${r.footprintM2} m² · pitch ${r.pitchDeg}° · ${r.segments} segments · imagery ${r.quality} ${r.imageryDate ? JSON.stringify(r.imageryDate) : ''}`);
    if (r.center) console.log(`  building found ${metres({ lat, lng }, r.center)} m from the address point`);
  }
})();
