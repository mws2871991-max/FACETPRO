/* Scaffolding by the size of the house (6 October 2026).

   A flat £800 was right for a terrace and low for anything bigger: published
   2026 guides put a semi at £875–£1,800 and a detached house at £1,200–£3,000
   (Checkatrade's scaffolding guide, Feb 2026; Homebuilding & Renovating;
   MyBuilder). Scaled with the exterior wall area — the same quantity the
   photograph measures — so a bigger elevation needs more scaffold:

     50 m² of wall (terrace)  £800
     85 m² (semi)             ~£1,240
    130 m² (detached)          £1,800

   One rule, used by the visualiser and by every cost guide, so the two cannot
   quote different scaffolds for the same house. Ex VAT, like every rate. */
'use strict';

function scaffoldingFor(catalogue, wallM2) {
  const s = catalogue && catalogue.scaffolding;
  if (!s) return (catalogue && catalogue.scaffoldingCost) || 0;
  const a = Number(wallM2);
  const area = Number.isFinite(a) && a > 0 ? a : catalogue.defaultFootprintM2;
  const raw = s.base + (area - s.baseWallM2) * s.perExtraWallM2;
  return Math.round(Math.min(s.max, Math.max(s.base, raw)));
}

module.exports = { scaffoldingFor };
