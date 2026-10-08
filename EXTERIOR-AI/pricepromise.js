/* The Facet Pro price promise (8 Oct 2026).

   Agreed in principle with the installers: for the job the homeowner chose,
   the installer's quote will be within the Facet Pro range and never more
   than 13% above the top of it. If the job changes at survey (more or larger
   windows, a different product, the condition of the house, unusual access),
   any difference is explained to the homeowner in writing.

   Off until PRICE_PROMISE=on, which is set only once the installers have
   signed it: a promise to the public that nobody is bound to keep is a
   misleading claim, and the site must not make it first.

   The cap is worked out per part, from the range the homeowner was shown for
   that part, and travels on the lead so the installer quotes against the same
   figure the homeowner holds. Not a guarantee and not a price match: words
   that would mean something the promise does not. */

'use strict';

const CAP = 0.13;

const enabled = () => String(process.env.PRICE_PROMISE || '').toLowerCase() === 'on';

const capAt = (high) => Math.round(Number(high) * (1 + CAP));

const okRange = (r) => r && Number.isFinite(Number(r.low)) && Number.isFinite(Number(r.high)) && Number(r.high) > 0;

/* glazing: the lead's glazing result (its marketRange is what the page shows);
   exterior: the walls/roof/roofline range from priceRange(). Either may be absent. */
function forLead({ glazing, exterior } = {}) {
  const parts = [];
  const g = glazing ? (glazing.marketRange || glazing.range || null) : null;
  if (okRange(g)) parts.push({ what: 'Windows and doors', low: Math.round(g.low), high: Math.round(g.high), capAt: capAt(g.high) });
  if (okRange(exterior)) parts.push({ what: 'Walls, roof and roofline', low: Math.round(exterior.low), high: Math.round(exterior.high), capAt: capAt(exterior.high) });
  if (!parts.length) return null;
  return {
    capPercent: Math.round(CAP * 100),
    parts,
    terms: '/price-promise',
    wording: 'For the job you chose, your installer’s quote will be within your Facet Pro range and never more than 13% above it. If the job changes at survey, any difference is explained to you in writing.',
  };
}

module.exports = { CAP, enabled, capAt, forLead };
