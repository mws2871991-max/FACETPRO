/* ─────────────────────────────────────────────────────────────────────────
   Landing pages for what homeowners actually search for.

   "How much do new windows cost" is the question, typed several hundred
   thousand times a month in this country, and the answers ranking for it are
   either a lead form pretending to be an article or a range so wide it means
   nothing. We can answer it properly, because there is a costing engine
   downstairs with real supplier and labour rates in it.

   Five decisions, and the first is the whole design.

   **Every figure on every page is computed from the same engine that prices
   the visualiser.** Nothing is written into the copy. A page saying £8,400 and
   a visualiser saying £11,000 for the same house is the failure that destroys
   trust in both, and it is inevitable the moment a number is typed into prose
   — somebody updates the rate card and nobody greps the marketing. So the
   templates take the catalogue and call `glazing.estimateGlazing`, and when
   `catalogue.json` changes the pages change with it. `notes/glazing-rates-from-
   the-trade.md` explains where the rates came from; this file never restates
   them.

   **The honesty rules from the product apply here too, more strictly.** These
   pages are read by people who have not seen anything yet, so a claim here is
   doing more work than the same claim beside a visualiser. Which means: the
   range is presented as a range, every page says it is an estimate and not a
   quotation, the beta notice appears when SITE_MODE says beta, and nothing
   claims accuracy nobody has validated. There are no testimonials, no review
   counts, no "trusted by" numbers and no invented accreditations — the four
   things a competitor's version of this page would open with, all of which
   would be fabrications here.

   **Area pages tell the truth about coverage.** A page headed "Windows in
   Basildon" implying installers who are not configured is a promise the
   routing cannot keep, and the person who discovers it is the homeowner who
   asked. So the page is rendered against the actual recipient list for that
   outward code, and where nobody covers it, it says so and offers the
   visualiser anyway — which still works, and is still worth their two minutes.

   **No scripts, so these serve under the stricter CSP.** They are documents.
   The interactive product is one tap away and does not need to be inlined into
   a cost guide.

   **They are not thin.** Each page answers its question in the first screen,
   shows the working, says what is and is not included, and only then asks for
   a photograph. A page that answers nothing and CTAs twice is the thing Google
   spent a decade learning to demote, and it is also just rude.
   ───────────────────────────────────────────────────────────────────────── */

'use strict';

const glazing = require('./glazing');
const routing = require('./routing');

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (n) => '£' + Math.round(Number(n) || 0).toLocaleString('en-GB');

/* ── ONE TRAP, DOCUMENTED ──

   catalogue.json holds percentages in two conventions. At the root, `vatPct` is
   0.2 and `wastePct` is 0.1 — fractions, and `computePrice` in server.js
   multiplies by them directly. Under `glazing`, `vatPct` is 20 — a percentage,
   and glazing.js divides by 100.

   Both are load-bearing and neither is wrong; they were written by different
   people for different sections. What is wrong is a third file guessing. The
   first draft of this one assumed percentages throughout, which quietly turned
   20% VAT into 0.2% and a 10% waste allowance into 0.1% — every wall, roof and
   roofline figure on nine landing pages understated by about a fifth, in the
   same direction and for the same reason the doors were once shown 20% over.

   So: normalise, explicitly, and say why. Anything above 1 is a percentage,
   anything at or below 1 is a fraction. VAT of 1% and waste of 1% do not
   occur in this trade, so the boundary is not ambiguous in practice — and if
   the catalogue is ever regularised to one convention, this keeps working.

   Guarded by test/landing.test.js, which reconciles a landing figure against
   the pricing engine's own output for the same inputs. */
const asFraction = (v) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n > 1 ? n / 100 : n;
};
const vatMult = (v) => 1 + asFraction(v);

/* ── FIGURES, COMPUTED ──────────────────────────────────────────────────── */

/* What a window job of N windows costs, through the same call the product
   makes. houseType matters because the engine scales a front-elevation count
   to the whole house; here the count IS the whole house, so the override is
   used and the type only affects the band mix. */
function windowJob(catalogue, { count, houseType = 'semi', colourId = null, styleId = 'casement' }) {
  const out = glazing.estimateGlazing({
    rates: catalogue.glazing,
    houseType,
    windowCountOverride: count,
    selections: { windowStyleId: styleId, windowDoorColourId: colourId },
  });
  return {
    count,
    low: out.range.low,
    high: out.range.high,
    perWindowLow: Math.round(out.range.low / count),
    perWindowHigh: Math.round(out.range.high / count),
  };
}

/* A single door, priced from the catalogue and spread across the market the
   same way the product spreads it. */
function doorPrices(catalogue) {
  const spread = glazing.INSTALLER_SPREAD;
  const vat = vatMult(catalogue.glazing.vatPct ?? 20);
  return catalogue.glazing.doors.map(d => ({
    name: d.name,
    low: Math.round(d.supplyFit * vat * spread.low),
    high: Math.round(d.supplyFit * vat * spread.high),
  }));
}

/* Fascias, soffits and guttering, per metre and for a typical run. The rates
   are supply and labour separately in the catalogue, which is how the trade
   quotes them and how the estimate adds them up. */
function rooflineFor(catalogue, metres) {
  const r = catalogue.trimRates || {};
  const vat = vatMult(catalogue.vatPct);
  const perM = (r.fasciaPerM || 0) + (r.fasciaLabourPerM || 0)
    + (r.soffitPerM || 0) + (r.soffitLabourPerM || 0)
    + (r.gutteringPerM || 0) + (r.gutteringLabourPerM || 0);
  const net = perM * metres;
  const scaffolding = catalogue.scaffoldingCost || 0;
  /* Waste is on materials only, not on labour — the same rule computePrice
     applies. A waste allowance is spoiled board, not spoiled hours. */
  const materials = ((r.fasciaPerM || 0) + (r.soffitPerM || 0) + (r.gutteringPerM || 0)) * metres;
  const waste = materials * asFraction(catalogue.wastePct);
  return {
    metres,
    perM: Math.round(perM * vat),
    total: Math.round((net + scaffolding + waste) * vat),
    scaffolding: Math.round(scaffolding * vat),
  };
}

/* Walls: render or cladding, per m² and for a typical wall area. */
function wallsFor(catalogue, m2) {
  const vat = vatMult(catalogue.vatPct);
  const rows = (catalogue.cladding || []).map(c => {
    const labour = catalogue.labour?.claddingPerM2 || 0;
    const net = (c.pricePerM2 + labour) * m2;
    const waste = c.pricePerM2 * m2 * asFraction(catalogue.wastePct);
    return {
      name: c.name,
      material: c.materialLabel || c.materialType || '',
      perM2: Math.round((c.pricePerM2 + labour) * vat),
      total: Math.round((net + waste + (catalogue.scaffoldingCost || 0)) * vat),
    };
  });
  return { m2, rows };
}

function roofFor(catalogue, m2) {
  const vat = vatMult(catalogue.vatPct);
  return (catalogue.roof || []).map(r => {
    const labour = catalogue.labour?.roofPerM2 || 0;
    const net = (r.pricePerM2 + labour) * m2;
    const waste = r.pricePerM2 * m2 * asFraction(catalogue.wastePct);
    return {
      name: r.name,
      perM2: Math.round((r.pricePerM2 + labour) * vat),
      total: Math.round((net + waste + (catalogue.scaffoldingCost || 0)) * vat),
    };
  });
}

/* ── THE PAGES ──────────────────────────────────────────────────────────── */

/* Cost pages. `slug` is the URL and the search intent; `build` returns the
   body. Adding one is adding an entry here — there is no per-page file to keep
   in sync, and no page can exist without a figure the engine produced. */
const COST_PAGES = [
  {
    slug: 'window-replacement-cost-uk',
    title: 'Window replacement cost UK (2026 prices)',
    h1: 'What does window replacement cost in the UK?',
    intent: 'window replacement cost UK',
    description: 'What replacing your windows costs in the UK, priced from real supplier and labour rates — per window and for a whole house.',
    build: (c) => {
      const semi = windowJob(c, { count: 8 });
      const detached = windowJob(c, { count: 12 });
      const terrace = windowJob(c, { count: 6, houseType: 'terrace' });
      return {
        answer: `${money(semi.perWindowLow)} to ${money(semi.perWindowHigh)} per window fitted, so roughly ${money(semi.low)} to ${money(semi.high)} for a typical eight-window semi.`,
        sections: [
          { heading: 'By house size', table: {
            head: ['House', 'Windows', 'Estimated cost fitted, inc VAT'],
            rows: [
              ['Mid-terrace', String(terrace.count), `${money(terrace.low)} – ${money(terrace.high)}`],
              ['Semi-detached', String(semi.count), `${money(semi.low)} – ${money(semi.high)}`],
              ['Detached', String(detached.count), `${money(detached.low)} – ${money(detached.high)}`],
            ],
          } },
          { heading: 'By window size', table: {
            head: ['Size', 'Typical opening', 'Supply and fit, inc VAT'],
            rows: c.glazing.windowBands.map(b => [
              b.label,
              b.example,
              money(b.supplyFit * vatMult(c.glazing.vatPct ?? 20)),
            ]),
          } },
          { heading: 'Why the range is this wide', paras: [
            'It is not uncertainty about the work. It is which company quotes it. The same eight windows, to the same specification, settle around 0.88× our base figure at the keener of the two national installers and about 1.6× at the other — and higher again if you accept the first number on the table.',
            'That is the single biggest variable in what you will pay, and it has nothing to do with your house. It is why the estimate here is a range rather than one confident figure, and why it is worth getting more than one quote even when the first one sounds reasonable.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'new-windows-cost-uk',
    title: 'New windows cost UK — what to budget in 2026',
    h1: 'How much do new windows cost?',
    intent: 'new windows cost UK',
    description: 'What new windows cost in the UK, by size, style and house type, from real fitted rates rather than a headline price.',
    build: (c) => {
      const base = windowJob(c, { count: 8 });
      const flush = windowJob(c, { count: 8, styleId: 'flush' });
      const sash = windowJob(c, { count: 8, styleId: 'sliding-sash' });
      return {
        answer: `${money(base.perWindowLow)} to ${money(base.perWindowHigh)} per window fitted for standard casements, before style choices.`,
        sections: [
          { heading: 'What the style does to the price', table: {
            head: ['Style', 'Eight windows fitted, inc VAT'],
            rows: [
              ['Casement', `${money(base.low)} – ${money(base.high)}`],
              ['Flush casement', `${money(flush.low)} – ${money(flush.high)}`],
              ['Sliding sash', `${money(sash.low)} – ${money(sash.high)}`],
            ],
          } },
          { heading: 'What moves the number, in order', paras: [
            'How many windows, then how big they are, then how many of them open. An opening light is a hinge, a lock and a sealed frame, and it costs about the same whatever size window it goes in — so a fixed pane and a window with two openers can differ by well over a third for the same hole in the wall. Nobody can tell which you have from a photograph, which is why we ask.',
            'Colour is the smallest of the four and the one people expect to be the biggest. Anthracite, black or a woodgrain finish adds a single-figure percentage, not a category.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'anthracite-windows-cost',
    title: 'Anthracite windows cost — what the colour actually adds',
    h1: 'What do anthracite windows cost?',
    intent: 'anthracite windows cost',
    description: 'What anthracite grey windows cost against white uPVC, and what the colour actually adds to a fitted price.',
    build: (c) => {
      const white = windowJob(c, { count: 8 });
      const grey = windowJob(c, { count: 8, colourId: 'anthracite' });
      const uplift = Math.round(((c.glazing.nonWhiteUplift || 1) - 1) * 100);
      return {
        answer: `About ${uplift}% more than the same window in white — ${money(grey.low)} to ${money(grey.high)} for eight, against ${money(white.low)} to ${money(white.high)} in white.`,
        sections: [
          { heading: 'White against anthracite, same house', table: {
            head: ['Finish', 'Eight windows fitted, inc VAT'],
            rows: [
              ['White uPVC', `${money(white.low)} – ${money(white.high)}`],
              ['Anthracite grey', `${money(grey.low)} – ${money(grey.high)}`],
            ],
          } },
          { heading: 'The part worth thinking about', paras: [
            `The ${uplift}% is not the decision. Anthracite changes how the whole front of a house reads — it darkens and defines every opening at once, and against pale brick or render the effect is dramatic in a way a colour swatch does not convey.`,
            'That is the one thing you genuinely cannot judge from a price page, and it is exactly what the visualiser is for: it puts the finish on your own elevation, keeping your brickwork and your window shapes as they are.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'upvc-window-prices',
    title: 'uPVC window prices — supply and fit, by size',
    h1: 'uPVC window prices, by size',
    intent: 'uPVC window prices',
    description: 'uPVC window prices by size, supply and fit, inc VAT — plus what a whole-house job comes to.',
    build: (c) => {
      const vat = vatMult(c.glazing.vatPct ?? 20);
      const semi = windowJob(c, { count: 8 });
      return {
        answer: `${money(c.glazing.windowBands[1].supplyFit * vat)} for a standard 1200 × 1200 fitted, with a whole eight-window semi at ${money(semi.low)} to ${money(semi.high)}.`,
        sections: [
          { heading: 'Per window, supply and fit', table: {
            head: ['Size', 'Example', 'Inc VAT'],
            rows: c.glazing.windowBands.map(b => [b.label, b.example, money(b.supplyFit * vat)]),
          } },
          { heading: 'What is in that figure', paras: [
            'Supply, fitting, removing and taking away the old frames, and the sealing and making good around the new one. VAT is included in every number on this page.',
            `Access equipment is separate where it is needed — ${money((c.glazing.accessCost || 0) * vat)} for a scaffold tower on upstairs windows — and there is a minimum job charge of ${money((c.glazing.minJobCharge || 0) * vat)}, because sending a two-man team out for one small window costs what it costs.`,
          ] },
        ],
      };
    },
  },
  {
    slug: '10-window-replacement-cost',
    title: '10 window replacement cost — what ten windows comes to',
    h1: 'What does replacing 10 windows cost?',
    intent: '10 window replacement cost',
    description: 'What replacing ten windows costs, fitted and inc VAT, with the same job priced at eight and twelve for comparison.',
    build: (c) => {
      const ten = windowJob(c, { count: 10 });
      return {
        answer: `${money(ten.low)} to ${money(ten.high)} fitted, inc VAT — around ${money(ten.perWindowLow)} to ${money(ten.perWindowHigh)} a window.`,
        sections: [
          { heading: 'Ten windows, and either side of it', table: {
            head: ['Windows', 'Estimated cost fitted, inc VAT'],
            rows: [8, 9, 10, 11, 12].map(n => {
              const j = windowJob(c, { count: n });
              return [String(n), `${money(j.low)} – ${money(j.high)}`];
            }),
          } },
          { heading: 'Ten is where the numbers stop being linear', paras: [
            'Not because of a bulk discount — there rarely is one worth the name — but because a ten-window house is usually a house where access, scaffolding and a two-day fit are being priced once rather than twice. Quotes that scale perfectly with the window count are usually quotes that have not looked at the house.',
            'Which of your ten are upstairs, how many open, and whether any are bays will move this more than the count itself.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'front-door-replacement-cost',
    title: 'Front door replacement cost UK',
    h1: 'What does a new front door cost?',
    intent: 'front door replacement cost',
    description: 'Front door replacement costs in the UK by door type — uPVC, composite, double, patio and bifold — fitted and inc VAT.',
    build: (c) => ({
      answer: (() => {
        const d = doorPrices(c).find(x => /composite/i.test(x.name));
        return `${money(d.low)} to ${money(d.high)} fitted for a composite front door, which is what most people are choosing.`;
      })(),
      sections: [
        { heading: 'By door type', table: {
          head: ['Door', 'Fitted, inc VAT'],
          rows: doorPrices(c).map(d => [d.name, `${money(d.low)} – ${money(d.high)}`]),
        } },
        { heading: 'Composite or uPVC', paras: [
          'A composite door is a solid core in a moulded skin: heavier, better insulated, and it holds a colour and a woodgrain far better over ten years of British weather. uPVC is the cheaper unit and a perfectly sound door in a sheltered opening.',
          'The gap between the two, fitted, is smaller than the gap between two companies quoting the same composite door — which is the recurring theme of every page on this site.',
        ] },
      ],
    }),
  },
  {
    slug: 'fascia-soffit-replacement-cost',
    title: 'Fascia and soffit replacement cost UK',
    h1: 'What does replacing fascias, soffits and guttering cost?',
    intent: 'fascia soffit replacement cost',
    description: 'Fascia, soffit and guttering replacement costs per metre and for a typical house, including scaffolding, inc VAT.',
    build: (c) => {
      const typical = rooflineFor(c, 30);
      return {
        answer: `About ${money(typical.perM)} a metre all-in, so roughly ${money(typical.total)} for a typical 30-metre run including scaffolding.`,
        sections: [
          { heading: 'By length of run', table: {
            head: ['Run', 'Estimated cost inc VAT'],
            rows: [20, 25, 30, 40, 50].map(m => {
              const r = rooflineFor(c, m);
              return [`${m} m`, money(r.total)];
            }),
          } },
          { heading: 'Why scaffolding is the line that surprises people', paras: [
            `Roofline work is all at height, so access is not an optional extra — it is ${money(typical.scaffolding)} of the figure above before anybody touches a fascia board. A quote that omits it is not cheaper, it is incomplete.`,
            'It is also the reason to do fascias, soffits and guttering together, and to think about whether the roof is due at the same time. Paying twice for the same scaffold is the most common avoidable cost in exterior work.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'house-rendering-cost',
    title: 'House rendering cost UK — per m² and per house',
    h1: 'What does rendering a house cost?',
    intent: 'house rendering cost',
    description: 'House rendering and cladding costs per square metre and for a typical house, including scaffolding and waste, inc VAT.',
    build: (c) => {
      const walls = wallsFor(c, 90);
      const cheapest = walls.rows.reduce((a, b) => (a.perM2 <= b.perM2 ? a : b));
      return {
        answer: `From about ${money(cheapest.perM2)} per m² supplied and applied, so roughly ${money(cheapest.total)} for a 90 m² house including scaffolding.`,
        sections: [
          { heading: 'By finish, on 90 m² of wall', table: {
            head: ['Finish', 'Per m² inc VAT', 'Typical house inc VAT'],
            rows: walls.rows.map(r => [`${r.name}${r.material ? ` (${r.material})` : ''}`, money(r.perM2), money(r.total)]),
          } },
          { heading: 'The number nobody knows about their own house', paras: [
            'Wall area. Almost everyone guesses it badly, and it is the multiplier on every figure above — which is why a rendering quote over the phone is worth nothing and why a survey is normally the first thing anybody insists on.',
            'Upload a photograph and we estimate your wall area from the elevation, using your front door as the known dimension. It is an estimate, and it says so, but it is a great deal better than a guess and it takes about a minute.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'new-roof-cost',
    title: 'New roof cost UK — what a re-roof comes to',
    h1: 'What does a new roof cost?',
    intent: 'new roof cost UK',
    description: 'New roof and re-roofing costs per square metre and for a typical house, including scaffolding and waste, inc VAT.',
    build: (c) => {
      const rows = roofFor(c, 80);
      const cheapest = rows.reduce((a, b) => (a.perM2 <= b.perM2 ? a : b));
      return {
        answer: `From about ${money(cheapest.perM2)} per m², so roughly ${money(cheapest.total)} on an 80 m² roof including scaffolding and waste.`,
        sections: [
          { heading: 'By covering, on 80 m²', table: {
            head: ['Covering', 'Per m² inc VAT', '80 m² roof inc VAT'],
            rows: rows.map(r => [r.name, money(r.perM2), money(r.total)]),
          } },
          { heading: 'What this does not include', paras: [
            'Structural work. If the timbers are gone, the felt has failed across the whole deck or the chimney needs rebuilding, that is a different job with a different number, and no photograph and no page can tell you whether you are in it.',
            'Everything here assumes a sound roof structure being re-covered. Treat it as the floor of what a re-roof costs, not the ceiling.',
          ] },
        ],
      };
    },
  },
  {
    slug: 'house-exterior-renovation-cost',
    title: 'House exterior renovation cost UK — the whole outside',
    h1: 'What does renovating a house exterior cost?',
    intent: 'house exterior renovation cost',
    description: 'What a full exterior renovation costs in the UK — windows, doors, walls, roof and roofline priced together rather than separately.',
    build: (c) => {
      const win = windowJob(c, { count: 8 });
      const doors = doorPrices(c).find(d => /composite/i.test(d.name));
      const walls = wallsFor(c, 90);
      const cheapWall = walls.rows.reduce((a, b) => (a.perM2 <= b.perM2 ? a : b));
      const roofline = rooflineFor(c, 30);
      const roof = roofFor(c, 80).reduce((a, b) => (a.perM2 <= b.perM2 ? a : b));
      const low = win.low + doors.low + cheapWall.total + roofline.total + roof.total;
      const high = win.high + doors.high + cheapWall.total + roofline.total + roof.total;
      return {
        answer: `${money(low)} to ${money(high)} for a typical semi doing windows, front door, walls, roofline and roof together.`,
        sections: [
          { heading: 'The whole outside, itemised', table: {
            head: ['Element', 'Estimated cost inc VAT'],
            rows: [
              ['8 windows', `${money(win.low)} – ${money(win.high)}`],
              ['Composite front door', `${money(doors.low)} – ${money(doors.high)}`],
              [`Walls, 90 m² (${cheapWall.name})`, money(cheapWall.total)],
              ['Fascias, soffits, guttering, 30 m', money(roofline.total)],
              [`Roof, 80 m² (${roof.name})`, money(roof.total)],
            ],
          } },
          { heading: 'Why the total is not five quotes added up', paras: [
            'Five trades priced separately means paying for access five times, five sets of mobilisation, and five companies each protecting their own margin against the others\u2019 unknowns. Priced together, the scaffold goes up once.',
            'It also means you see one number for the outside of your house instead of five that never quite add up to a decision. That is the whole reason this site prices all of it from one photograph.',
          ] },
        ],
      };
    },
  },
];

/* Area pages. Kept to the outward codes and towns the business actually works
   — Grays is home, and the rest are the M25-east corridor around it. A page
   for every town in Britain is exactly the thin-content estate this file's
   header argues against, and it would also be claiming coverage nobody has. */
const AREA_PAGES = [
  { slug: 'windows-grays', town: 'Grays', county: 'Essex', outward: 'RM17' },
  { slug: 'windows-essex', town: 'Essex', county: null, outward: 'CM1', region: true },
  { slug: 'windows-romford', town: 'Romford', county: 'Essex', outward: 'RM1' },
  { slug: 'windows-basildon', town: 'Basildon', county: 'Essex', outward: 'SS14' },
  { slug: 'windows-kent', town: 'Kent', county: null, outward: 'DA1', region: true },
  { slug: 'windows-surrey', town: 'Surrey', county: null, outward: 'GU1', region: true },
];

/* ── TEMPLATE ───────────────────────────────────────────────────────────── */

const table = (t) => `<table>
<thead><tr>${t.head.map(h => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>
<tbody>${t.rows.map(r => `<tr>${r.map((cell, i) =>
  i === 0 ? `<th scope="row">${escapeHtml(cell)}</th>` : `<td>${escapeHtml(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`;

const section = (s) => `<section><h2>${escapeHtml(s.heading)}</h2>
${s.table ? table(s.table) : ''}
${(s.paras || []).map(p => `<p>${escapeHtml(p)}</p>`).join('\n')}
</section>`;

/* Which trade a page is about, so the visualiser can open on the thing the
   visitor searched for instead of on everything at once.

   Derived from the slug rather than stored per page, because the slug IS the
   search intent — that is what it was chosen for — and two lists that have to
   agree are two lists that will not.

   'exterior' is deliberately absent: a whole-exterior page wants the default
   page, everything shown, nothing pre-declined. Absence is the answer, not a
   value. */
function journeyForSlug(slug) {
  if (/^windows-/.test(slug) || /window/.test(slug)) return 'windows';
  if (/door/.test(slug)) return 'doors';
  if (/fascia|soffit|guttering|roofline/.test(slug)) return 'roofline';
  if (/rendering|render|cladding/.test(slug)) return 'cladding';
  if (/roof/.test(slug)) return 'roof';
  return null;
}

/* The CTA, verbatim from the brief and identical on every page: the point of
   all of this is one action.

   It now carries the journey. Sixteen pages already targeted sixteen search
   intents and then dropped every one of them at the door — somebody arriving
   from "front door replacement cost" met the same generic uploader telling
   them to stand back and get the whole front of the house in. The pages
   existed; the thread between them and the engine did not. */
const ctaHref = (siteUrl, slug) => {
  const journey = slug ? journeyForSlug(slug) : null;
  return `${siteUrl}/${journey ? `?journey=${journey}` : ''}#your-photo`;
};

const cta = (siteUrl, slug) => `<div class="cta-block">
  <h2>See it on your own house</h2>
  <p>Every figure above is a typical house. Yours is not typical — nobody's is.
     Upload one photograph and we will find your windows, doors, roof and walls,
     estimate your wall area, and price your own elevation.</p>
  <p><a class="cta" href="${escapeHtml(ctaHref(siteUrl, slug))}">Upload a photo of your house</a></p>
  <p class="muted">Free to try &middot; One photo &middot; No sales call unless you ask</p>
</div>`;


/* Every page carries the same two caveats, in the same words as the product.
   Two copies of a disclaimer is how they drift, so they are written once here
   and no page may override them. */
const CAVEAT = 'These are estimates for planning, from real supplier and labour rates — not a quotation, and not a survey. What you pay depends on your own house and, more than anything else, on which company quotes it. Your installer confirms the figure on survey.';

const BETA_NOTICE = 'Facet Pro is in beta. Our measurement of wall area from a photograph is still being calibrated against surveyed properties, so treat wall and roof figures as indicative and window figures as a guide.';

function page({ title, description, h1, canonical, body, siteUrl, siteMode, related, faq, slug }) {
  const beta = siteMode === 'beta';
  return `<!doctype html><html lang="en-GB"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(canonical)}">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${escapeHtml(siteUrl)}/assets/og-image.png">
<link rel="icon" href="/assets/favicon-32.png">
<link rel="stylesheet" href="/assets/landing.css">
${faq ? `<script type="application/ld+json">${JSON.stringify(faq)}</script>` : ''}
</head><body>
<header class="site"><div class="wrap">
  <a class="logo" href="${escapeHtml(siteUrl)}/">Facet Pro</a>
  <a href="${escapeHtml(ctaHref(siteUrl, slug))}">See my house &rarr;</a>
</div></header>
<main class="wrap">
<h1>${escapeHtml(h1)}</h1>
${beta ? `<p class="notice">${escapeHtml(BETA_NOTICE)}</p>` : ''}
${body}
${cta(siteUrl, slug)}
<p class="caveat">${escapeHtml(CAVEAT)}</p>
${related ? `<nav class="related"><h2>Related costs</h2><ul>${related.map(r =>
  `<li><a href="${escapeHtml(r.href)}">${escapeHtml(r.label)}</a></li>`).join('')}</ul></nav>` : ''}
</main>
<footer class="site"><div class="wrap">
  Facet Pro &middot; <a href="/privacy">Privacy notice</a> &middot; <a href="/terms">Terms of use</a>
</div></footer>
</body></html>`;
}

/* FAQPage structured data, built from the page's own headings and first
   paragraph. Generated rather than hand-written so it cannot describe content
   the page does not have, which is the thing Google penalises. */
function faqFor(built) {
  const items = built.sections.filter(s => s.paras?.length).map(s => ({
    '@type': 'Question',
    name: s.heading,
    acceptedAnswer: { '@type': 'Answer', text: s.paras[0] },
  }));
  if (!items.length) return null;
  return { '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items };
}

/* ── RENDERING ──────────────────────────────────────────────────────────── */

function relatedFor(slug) {
  return COST_PAGES.filter(p => p.slug !== slug).slice(0, 5)
    .map(p => ({ href: `/cost/${p.slug}`, label: p.h1.replace(/\?$/, '') }));
}

function renderCostPage(slug, { catalogue, siteUrl, siteMode }) {
  const def = COST_PAGES.find(p => p.slug === slug);
  if (!def) return null;
  const built = def.build(catalogue);
  const body = `<div class="answer"><strong>The short answer</strong><span>${escapeHtml(built.answer)}</span></div>
${built.sections.map(section).join('\n')}`;
  return page({
    slug,
    title: def.title,
    description: def.description,
    h1: def.h1,
    canonical: `${siteUrl}/cost/${slug}`,
    body, siteUrl, siteMode,
    related: relatedFor(slug),
    faq: faqFor(built),
  });
}

/* An area page, rendered against who actually covers it.

   `recipients` is the live LEAD_RECIPIENTS list. Where nobody covers the
   outward code the page says so plainly — it does not imply installers who do
   not exist, and it does not hide the visualiser either, because that works
   everywhere and is the thing worth their time. */
function renderAreaPage(slug, { catalogue, siteUrl, siteMode, recipients = [] }) {
  const def = AREA_PAGES.find(p => p.slug === slug);
  if (!def) return null;

  const parsed = routing.parsePostcode(`${def.outward} 1AA`);
  const covering = recipients.filter(r => routing.covers(r, parsed));

  const semi = windowJob(catalogue, { count: 8 });
  const terrace = windowJob(catalogue, { count: 6, houseType: 'terrace' });
  const detached = windowJob(catalogue, { count: 12 });
  const where = def.region ? def.town : `${def.town}${def.county ? `, ${def.county}` : ''}`;

  const coverage = covering.length
    ? `<p>We currently work with ${covering.length} vetted installer${covering.length === 1 ? '' : 's'} covering ${escapeHtml(where)}. If you ask for quotes, your design goes to up to three of them &mdash; and only if you ask.</p>`
    : `<p>We are still signing up installers who cover ${escapeHtml(where)}, so we cannot promise you quotes here yet. The visualiser and the estimate work exactly the same &mdash; use them to find out what your house could look like and what it should cost, and we will tell you if that changes.</p>`;

  const body = `<div class="answer"><strong>The short answer</strong><span>${escapeHtml(
    `${money(semi.low)} to ${money(semi.high)} for a typical eight-window semi in ${where}, fitted and inc VAT.`)}</span></div>
<section><h2>Window costs in ${escapeHtml(where)}</h2>
${table({
    head: ['House', 'Windows', 'Estimated cost fitted, inc VAT'],
    rows: [
      ['Mid-terrace', String(terrace.count), `${money(terrace.low)} – ${money(terrace.high)}`],
      ['Semi-detached', String(semi.count), `${money(semi.low)} – ${money(semi.high)}`],
      ['Detached', String(detached.count), `${money(detached.low)} – ${money(detached.high)}`],
    ],
  })}
<p>These are national fitted rates rather than a local quote. Labour varies less around the M25 than most people expect; what varies enormously is which company you ask, which is worth more attention than your postcode.</p>
</section>
<section><h2>Installers covering ${escapeHtml(where)}</h2>
${coverage}
<p class="muted">We are not an installer and we do not do the work. We visualise and cost your project, and pass it to vetted installers if &mdash; and only if &mdash; you ask us to.</p>
</section>
<section><h2>Why start with a photograph</h2>
<p>A local quote over the phone is a guess with a postcode attached. The thing that actually decides your price is your own elevation: how many windows, how big, how many open, and how much wall there is. One photograph answers all four, in about a minute, without anybody coming to your house.</p>
</section>`;

  return page({
    slug,
    title: `Window and door costs in ${where} — Facet Pro`,
    description: `What new windows and doors cost in ${where}, from real fitted rates — and how to see them on your own house before anybody visits.`,
    h1: `New windows and doors in ${where}`,
    canonical: `${siteUrl}/${slug}`,
    body, siteUrl, siteMode,
    related: relatedFor(''),
  });
}

/* Every landing URL, for the sitemap and for the tests. One source, so a page
   cannot exist without being listed or be listed without existing. */
function allPaths() {
  return [
    ...COST_PAGES.map(p => `/cost/${p.slug}`),
    ...AREA_PAGES.map(p => `/${p.slug}`),
  ];
}

module.exports = {
  COST_PAGES, AREA_PAGES,
  renderCostPage, renderAreaPage, allPaths,
  CAVEAT, BETA_NOTICE,
  _internals: { asFraction, vatMult, windowJob, doorPrices, rooflineFor, wallsFor, roofFor, escapeHtml, money },
};
