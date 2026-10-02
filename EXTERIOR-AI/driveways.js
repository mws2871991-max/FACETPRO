'use strict';
/* Driveways (2 October 2026), behind DRIVEWAYS=off|test|on.

   A planning estimate and a picture, nothing more yet: there is no driveway
   installer in the network, so nothing here goes into a lead. The rule the
   product is built on still holds — if we can't see it, don't pretend — so the
   size is told by the homeowner (how many cars), never read from the photo:
   ground seen from the pavement is foreshortened past measuring.

   The figure is surface + groundworks + waste, each a range from the sources
   named in catalogue.json. What it leaves out is named, not hidden (the
   Love Windows ruling: conditions belong beside the price). */
const catalogue = require('./catalogue.json');

const D = () => catalogue.driveways || null;
const round50 = (n) => Math.round(n / 50) * 50;

function mode(env = process.env) {
  const v = String(env.DRIVEWAYS || '').toLowerCase();
  return ['off', 'test', 'on'].includes(v) ? v : 'off';
}

/* On for everyone, or in test only for a request that asked for the trial
   (?exp=driveway on the page, sent on as experiments or a query flag). */
function enabled({ body, query } = {}, env = process.env) {
  const m = mode(env);
  if (m === 'on') return true;
  if (m !== 'test') return false;
  const exps = Array.isArray(body?.experiments) ? body.experiments : [];
  return exps.includes('driveway') || String(query?.exp || '') === 'driveway';
}

/* What the page needs to draw the controls: names and sizes, no rates. */
function publicSection() {
  const d = D();
  if (!d) return null;
  return {
    note: d.note,
    materials: d.materials.map(m => ({
      id: m.id, name: m.name, hex: m.hex, materialLabel: m.materialLabel,
      styles: (m.styles || []).map(st => ({ id: st.id, name: st.name, hex: st.hex, swatch: st.swatch })),
      patterns: (m.patterns || []).map(pt => ({ id: pt.id, name: pt.name, note: pt.note, swatch: `/assets/swatches/driveway/pattern-${pt.id}.png` })),
    })),
    sizes: d.sizes.map(s => ({ id: s.id, name: s.name })),
    excluded: d.excluded, planning: d.planning, noInstallerYet: d.noInstallerYet, source: d.source,
    existingQuestion: d.existingQuestion, existingAnswers: d.existingAnswers, noDrivewayAdvice: d.noDrivewayAdvice,
  };
}

/* Resurfacing only (0054). Number 14 has a walled front garden, not a drive:
   asked for a driveway, the render knocked the wall down and took the bins
   and handrail away — real construction the estimate never priced. So the
   homeowner says whether there is a driveway now, and only 'yes' is drawn
   or priced. */
const hasExisting = (v) => String(v || '') === 'yes';

/* What must not change when a driveway is redone, segmented from the
   photograph and put back afterwards (restoreInsideMask in hold.js). Not the
   house wall: 'garden wall' and 'boundary wall' name the low wall in front. */
const KEEP_PROMPT = 'garden wall, boundary wall, fence, gate, railing, handrail, wheelie bin, car';

function material(id) { const d = D(); return d ? d.materials.find(m => m.id === String(id)) || null : null; }
function size(id) { const d = D(); return d ? d.sizes.find(s => s.id === String(id)) || null : null; }

/* Low and high, kept as a range throughout: the size band and the rate are
   both ranges, and multiplying the lows and the highs is the honest spread. */
function estimate({ materialId, sizeId } = {}) {
  const d = D(); const m = material(materialId); const s = size(sizeId);
  if (!d || !m || !s) return null;
  const [aLo, aHi] = s.m2, [rLo, rHi] = m.perM2, [gLo, gHi] = d.groundworksPerM2, [wLo, wHi] = d.wasteRemoval;
  const surface = [aLo * rLo, aHi * rHi];
  const groundworks = [aLo * gLo, aHi * gHi];
  const low = round50(surface[0] + groundworks[0] + wLo);
  const high = round50(surface[1] + groundworks[1] + wHi);
  return {
    material: { id: m.id, name: m.name, materialLabel: m.materialLabel },
    size: { id: s.id, name: s.name, m2: s.m2, kind: 'told' },
    low, high,
    parts: {
      surface: surface.map(round50),
      groundworks: groundworks.map(round50),
      wasteRemoval: [wLo, wHi],
    },
    permeableNote: m.permeableNote,
    excluded: d.excluded, planning: d.planning, noInstallerYet: d.noInstallerYet,
    source: d.source, updated: d.updated,
    kind: 'planning-estimate',
  };
}

/* What the render is asked for, in the words the model is given: the style's
   own words (colour and finish), the block-paving pattern and border, and a
   plain default for each surface when no style was sent. */
const DEFAULT_WORDS = {
  'block-paving': 'new natural grey concrete block paving',
  'resin-bound': 'a smooth, solid resin-bound surface in silver grey — small stones fixed together in clear resin into one flat, seamless, hard surface like a pavement, with no loose stones and no gravel',
  'tarmac': 'new smooth, even black tarmac',
  'gravel': 'fresh grey granite chippings',
  'stone-setts': 'natural grey granite setts laid in neat rows',
  'imprinted-concrete': 'new pattern-imprinted concrete in a slate-grey random ashlar stone pattern',
};
function promptWords(materialId, styleId, patternId) {
  const m = material(materialId);
  if (!m) return null;
  const st = (m.styles || []).find(x => x.id === String(styleId || ''));
  let words = st ? st.words : DEFAULT_WORDS[m.id];
  if (m.id === 'block-paving') {
    const pt = (m.patterns || []).find(x => x.id === String(patternId || '')) || (m.patterns || [])[0];
    if (pt) words += ` ${pt.words}`;
    if (m.border) words += `, ${m.border}`;
  }
  return words + ', with a neat edge';
}
function styleName(materialId, styleId) {
  const m = material(materialId); const st = m && (m.styles || []).find(x => x.id === String(styleId || ''));
  return st ? st.name : null;
}

module.exports = { mode, enabled, publicSection, estimate, material, size, promptWords, styleName, DEFAULT_WORDS, hasExisting, KEEP_PROMPT };
