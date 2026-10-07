/* Postcode to addresses, each with its UPRN, for EPC sizing (epc.js).

   A licensed lookup rather than the EPC register's own addresses: those are
   Ordnance Survey and Royal Mail data restricted to energy-efficiency
   purposes, and a product's "pick your address" list is not one of them.
   The UPRN is the bridge — open data that the EPC register can be asked by.

   One provider so far, Ideal Postcodes (UPRN is a standard field; a postcode
   that finds nothing is not charged). Off unless ADDRESS_LOOKUP_KEY is set.
   Nothing is stored: the list goes to the visitor and the UPRN they pick goes
   to epc.js. */

'use strict';

const PROVIDER = process.env.ADDRESS_LOOKUP_PROVIDER || 'ideal-postcodes';
const configured = () => !!process.env.ADDRESS_LOOKUP_KEY;

async function addressesFor(postcode) {
  const pc = String(postcode || '').replace(/\s+/g, '').toUpperCase();
  if (!/^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(pc) || !configured()) return null;
  if (PROVIDER !== 'ideal-postcodes') throw new Error(`Unknown ADDRESS_LOOKUP_PROVIDER ${PROVIDER}`);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(`https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(pc)}?api_key=${encodeURIComponent(process.env.ADDRESS_LOOKUP_KEY)}`, { signal: ctl.signal });
    if (r.status === 404) return [];
    if (!r.ok) throw new Error(`Address lookup answered ${r.status}`);
    const body = await r.json();
    return (body?.result || [])
      .filter(a => a && String(a.uprn || '').trim())
      .map(a => ({
        label: [a.line_1, a.line_2, a.line_3, a.post_town].map(s => String(s || '').trim()).filter(Boolean).join(', '),
        uprn: String(a.uprn).trim(),
      }));
  } finally { clearTimeout(t); }
}

module.exports = { addressesFor, configured };
