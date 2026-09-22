/* The operator views: funnel, measurements, ops.
 *
 * The first domain lifted out of server.js, which the August 2026 code audit
 * called "a major concentration point" at 4,000-plus lines and asked to be
 * decomposed "incrementally behind tests", not rewritten. This is the smallest
 * honest slice: three read-only routes, one shared guard, no writes, and no
 * other part of the file reaching into them.
 *
 * Nothing about their behaviour changes. Same paths, same middleware, same
 * responses, same tests — the only difference is which file they live in. That
 * is the whole point of a first extraction: if it needed a behavioural change
 * to fit, the seam would be in the wrong place.
 *
 * Dependencies come in as an argument rather than being imported, because they
 * are server.js's state and middleware, not this module's. store, obs, geometry
 * and measure are required directly — those are modules in their own right and
 * pretending otherwise would just be ceremony.
 *
 * One of them is a function on purpose. See getUsage below.
 */

'use strict';

const express = require('express');
const store = require('../store');
const obs = require('../observability');
const geometry = require('../geometry');
const measure = require('../measure');

/**
 * @param {object} deps
 * @param {Function} deps.installerLimiter        rate limiter middleware
 * @param {Function} deps.requireInstallerPassword the shared-password guard
 * @param {string[]} deps.FUNNEL_STAGES           stage names, in journey order
 * @param {string[]} deps.JOURNEY_SOURCES         the journeys a visitor can arrive on
 * @param {object}  deps.DAILY_LIMITS             detect/render caps
 * @param {Function} deps.getUsage                () => the CURRENT usage object
 * @param {boolean} deps.LEAD_CAPTURE
 * @param {string}  deps.SITE_MODE
 */
module.exports = function opsRoutes({
  installerLimiter, requireInstallerPassword,
  FUNNEL_STAGES, BRANCH_STAGES, JOURNEY_SOURCES, DAILY_LIMITS,
  getUsage, LEAD_CAPTURE, SITE_MODE,
}) {
  const router = express.Router();

  /* The table from the plan: each stage, and what share of the previous one it
     kept. Behind the installer password, like everything else that describes
     the business rather than the product. */
  router.get('/api/funnel', installerLimiter, requireInstallerPassword, async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    /* Read days, then total them, rather than reading twice.

       The totals below come from the same rows the breakdown reports, so the
       two cannot disagree — and a change shipped this morning can be read
       against this morning rather than against thirty days of history, which
       is what left the confirmation question unreadable. */
    let byDay = {};
    try { byDay = await store.readFunnelDays(days); }
    catch (err) { return res.status(500).json({ error: 'Could not read the funnel.' }); }

    const counts = {};
    for (const stages of Object.values(byDay)) {
      for (const [stage, n] of Object.entries(stages)) counts[stage] = (counts[stage] || 0) + n;
    }

    /* The first day each counter recorded anything.

       Two stages divided by each other are only a rate if both were being
       counted over the same days. render_shown over render_started read as
       387% — not because more renders finished than began, but because
       render_shown has a month of history and render_started was moved to fire
       on the request a few days ago. The ratio spanned two different windows
       and looked like a finding.

       Every stage inserted into this journey from now on creates the same
       artefact for as long as the window is wider than its own history, so the
       fix belongs here rather than in a note telling the reader to remember
       which stages are new. */
    const firstSeen = {};
    for (const [day, stages] of Object.entries(byDay)) {
      for (const [stage, n] of Object.entries(stages)) {
        if (!n) continue;
        if (!firstSeen[stage] || day < firstSeen[stage]) firstSeen[stage] = day;
      }
    }

    /* Conversion is against the step before, not against the top, because the
       question is always "where do we lose them".

       The rate is reported even where the two counters do not share a window,
       and flagged rather than withheld. An earlier cut of this suppressed it,
       and the live table killed that idea inside a minute: thirteen of sixteen
       rows went blank.

       The reason is that firstSeen cannot mean what suppression needs it to
       mean. It is the first day a counter recorded anything, which is "when it
       shipped" only for a counter that saw traffic immediately. cta_clicked
       has been running the whole time and simply idled for five days; by
       first-traffic it is indistinguishable from a counter added last week.
       Withholding on that basis throws away good rows to hide bad ones.

       So both facts go out and the reader decides: the number, and whether the
       two counters covered the same days. That is enough to stop 387% being
       read as a render success rate, without pretending to know which stages
       are young. */
    const chain = (key) => {
      let prev = null;
      let prevKey = null;
      return FUNNEL_STAGES.map(stage => {
        const k = key(stage);
        const n = counts[k] || 0;
        const isFirst = prevKey === null;
        const ofPrevious = isFirst ? null : (prev > 0 ? Math.round((n / prev) * 1000) / 10 : 0);
        const sameWindow = !isFirst && (firstSeen[k] || null) === (firstSeen[prevKey] || null);
        prev = n;
        prevKey = k;
        return {
          stage,
          count: n,
          ofPreviousPct: ofPrevious,
          firstSeen: firstSeen[k] || null,
          /* False means the rate beside it spans two different amounts of
             history and is arithmetic rather than behaviour. Null on the first
             step, which has nothing before it to compare against. */
          sameWindowAsPrevious: isFirst ? null : sameWindow,
        };
      });
    };

    const funnel = chain(stage => stage);

    /* Per journey, same shape, so the two can be read side by side. A journey
       with no traffic is omitted rather than shown as a column of zeroes. */
    const byJourney = {};
    for (const j of JOURNEY_SOURCES) {
      const rows = chain(stage => `${j}:${stage}`);
      if (rows.some(r => r.count > 0)) byJourney[j] = rows;
    }

    /* The same table again, split by the screen it happened on.

       The journey is photograph, upload, image and pricing choices, and until
       now not one stage could be read by device — so "is the reveal working on
       a phone?" and "do people price on a laptop and give up on a mobile?"
       were both unanswerable about the most phone-shaped product here. Same
       shape as byJourney deliberately: the two are read side by side. */
    const byDevice = {};
    for (const d of ['mobile', 'desktop']) {
      const rows = chain(stage => `device/${d}:${stage}`);
      if (rows.some(r => r.count > 0)) byDevice[d] = rows;
    }

    /* The loop-backs, each against a step it can honestly be compared with.

       Reported beside the funnel rather than inside it: /api/funnel divides
       every step by the one before, and a branch inserted into that chain
       would hand its own small count to the next real step as a denominator.
       See BRANCH_STAGES in server.js. */
    const branches = [...(BRANCH_STAGES || new Map())].map(([stage, meta]) => {
      const n = counts[stage] || 0;
      const base = counts[meta.of] || 0;
      return {
        stage, label: meta.label, count: n, of: meta.of, ofCount: base,
        ofPct: base > 0 ? Math.round((n / base) * 1000) / 10 : null,
      };
    });

    /* The one number the customer-journey audit calls the key KPI: the share
       of visitors who reach a personalised estimate.

       Every figure needed was already in the table and nobody was going to
       divide row nine by row one. "Personalised" is deliberately
       estimate_viewed against landing rather than anything earlier — a price
       appears from the moment the page loads, so counting that would score a
       visitor who bounced. estimate_viewed fires when somebody opens what the
       figure is made of, on their own house, which is the moment the promise
       on the front of the site has actually been delivered. */
    const landing = counts.landing || 0;
    const reached = counts.estimate_viewed || 0;
    const keyKpi = {
      metric: 'reached a personalised estimate',
      of: 'landing',
      count: reached,
      ofCount: landing,
      pct: landing > 0 ? Math.round((reached / landing) * 1000) / 10 : null,
    };

    res.setHeader('Cache-Control', 'no-store');
    res.json({ days, keyKpi, funnel, branches, byJourney, byDevice, byDay,
      note: 'Counts are per stage, not per person — see the funnel table in store.js. '
        + 'byJourney counts only visitors who arrived on a journey; the totals above include everyone. '
        + 'byDevice splits by the width the page was rendered at, under 768px being mobile, and only covers stages recorded since that key shipped — an empty or short column is missing history rather than missing traffic. '
        + 'Each row carries firstSeen, the first day that counter recorded anything, and sameWindowAsPrevious. Where that is false, ofPreviousPct divides two counters with different amounts of history and is arithmetic rather than behaviour — render_shown over render_started read as 387% for that reason, the first having a month of history and the second days. Treat those as uncomparable rather than as findings. Note that firstSeen is first traffic, not the day the counter shipped, so a genuinely old but rarely-hit stage looks young. Where the window does match, a figure above 100% is real and means the chain is not strictly nested — the cost pages link straight into the tool, so design_opened outruns cta_clicked. '
        + 'byDay is the raw day-keyed breakdown, so it carries the prefixed counters in the same object as the plain stages — journey:…, from/…, device/… — where funnel, byJourney and byDevice present them already split out. Filter on the prefix before summing, or the same visit is counted more than once. '
        + 'Read a change against the days since it shipped: a figure that looks like a rate against thirty days of history is usually a few hours of numerator over a month of denominator.' });
  });

  /* ── GET /api/measurements ──
     The evidence for the thresholds, in the shape you would actually read it.

     Not a dump: buckets of door-box proportions against what the measurer did
     with them. The question this exists to answer is "where do real front doors
     stop and garage doors begin", and a list of rows does not answer it — a
     histogram does. Behind the installer password like everything else that
     describes the business rather than the product. */
  router.get('/api/measurements', installerLimiter, requireInstallerPassword, async (req, res) => {
    const limit = Math.min(5000, Math.max(1, parseInt(req.query.limit, 10) || 1000));

    /* ?days=N, clamped the way /api/funnel clamps it.

       Without a window these aggregates cover the whole table, so the fallback
       rate mixes photographs from before the house-type fix with photographs
       after it, and nothing measured from here on can be attributed to the
       change that caused it. Same fault the funnel had until readFunnelDays.

       Absent means everything, which is what every existing caller expects.
       A default window would silently change what this endpoint has been
       reporting all week. */
    const daysRaw = req.query.days === undefined ? null
      : Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 1));
    const sinceIso = daysRaw === null ? null
      : new Date(Date.now() - daysRaw * 86400000).toISOString();

    let allRows = [];
    try { allRows = await store.readMeasurements(limit, sinceIso); }
    catch (err) { return res.status(500).json({ error: 'Could not read the observations.' }); }

    /* One photograph, measured five times, is one observation.

       autoMeasure() runs on every upload, so a reload, a second journey or an
       automated run writes another row for the same house. The 20 September
       fallback rate read 86% over 35 rows — and about fifteen of those rows
       were two photographs uploaded again and again by a review, roughly ten
       of them the identical 181 m². A band retuned against that histogram is a
       band fitted to one house.

       There is no identifier to group by, deliberately: the table holds shape
       numbers and an outcome and nothing tied to a person or a property, which
       is why it needs no retention period. But the same photograph measured
       twice produces the same numbers to the same precision, so the row itself
       is the key. Anything that collides here measured identically, which is
       the only sense in which two observations could be told apart anyway.

       Both are reported. `rows` is what happened; `samples` is how many houses
       it happened to, and every rate below is computed on the second, because
       "86% of photographs" was the claim being made. */
    const signature = (r) => [
      r.houseType || '', r.method || '',
      Number(r.m2) || '', Number(r.doorRatio) || '', Number(r.doorHeightPct) || '',
      Number(r.doorBoxes) || '', Number(r.rejectedM2) || '', r.rejectedSide || '',
    ].join('|');

    const seen = new Set();
    const rows = [];
    for (const r of allRows) {
      const key = signature(r);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(r);
    }
    const repeats = allRows.length - rows.length;

    const buckets = {};
    const byMethod = {};
    for (const r of rows) {
      byMethod[r.method || 'unknown'] = (byMethod[r.method || 'unknown'] || 0) + 1;
      const ratio = Number(r.doorRatio);
      if (!Number.isFinite(ratio)) continue;
      /* Half-unit buckets: a door leaf sits near 2.36, a garage near 0.88, and
         the interesting question is what lands between them. */
      const key = (Math.floor(ratio * 2) / 2).toFixed(1);
      (buckets[key] ||= { doorRatioFrom: Number(key), samples: 0, usedAsScale: 0 });
      buckets[key].samples += 1;
      if (r.method === 'door') buckets[key].usedAsScale += 1;
    }

    /* What the band refused, which is the half that could revise it.

       Grouped by house type and by side, because those are the two things a
       bound is set from. A run of detached photographs computing 210–230 m² and
       being refused against a ceiling of 200 says the ceiling is too low; a run
       computing 45 m² says the scale reference is being read off something that
       is not a door, and the fix is in geometry.js rather than here.

       The extremes are carried rather than a mean. A mean of the rejects is a
       number about a distribution nobody has looked at yet; the nearest miss is
       the one that tells you where the bound actually wants to be. */
    const band = {};
    for (const r of rows) {
      if (!Number.isFinite(Number(r.rejectedM2)) || !r.rejectedSide) continue;
      const type = r.houseType || 'unknown';
      const side = r.rejectedSide;
      const b = (band[type] ||= { below: null, above: null });
      const entry = (b[side] ||= { count: 0, nearest: null, furthest: null, byMethod: {} });
      const v = Number(r.rejectedM2);
      entry.count += 1;
      entry.byMethod[r.rejectedMethod || 'unknown'] = (entry.byMethod[r.rejectedMethod || 'unknown'] || 0) + 1;
      /* "Nearest" means nearest to the bound it failed, which is the largest
         value below the floor and the smallest above the ceiling. */
      entry.nearest = entry.nearest === null ? v : (side === 'below' ? Math.max(entry.nearest, v) : Math.min(entry.nearest, v));
      entry.furthest = entry.furthest === null ? v : (side === 'below' ? Math.min(entry.furthest, v) : Math.max(entry.furthest, v));
    }

    /* How often the photograph did not end up being used, as a rate.

       The 18 September review asked for this directly: both of the site's own
       well-framed marketing photographs fell back to a typical figure, and
       "2 of 2" is either terrible luck or the product's core claim not
       working. byMethod has carried the counts all along, but a reader had to
       do the division themselves and nobody was going to.

       Split by cause, because the two want different fixes and a single
       percentage hides which one you have:

       - refused  — something was measured and the house-type band threw it
                    out. The fix is the band, or the scale reference. This is
                    the half that bandRejections below can revise.
       - unusable — nothing could be measured at all: no door-shaped box, or
                    walls filling too little or too much of the frame. The fix
                    is detection, or the photo guidance before the upload.

       A rate over a handful of samples is noise, so the sample count travels
       with it and the note says so rather than leaving somebody to act on
       two photographs. */
    const measured = rows.filter(r => r.method && r.method !== 'prior').length;
    const refused = rows.filter(r => r.method === 'prior' && Number.isFinite(Number(r.rejectedM2))).length;
    const unusable = rows.filter(r => r.method === 'prior' && !Number.isFinite(Number(r.rejectedM2))).length;
    const pct = (n) => (rows.length ? Math.round((n / rows.length) * 100) : null);

    const fallback = {
      samples: rows.length,
      rows: allRows.length,
      repeats,
      measured, refused, unusable,
      fallbackPct: pct(refused + unusable),
      refusedPct: pct(refused),
      unusablePct: pct(unusable),
      /* Distinct photographs, not rows. Thirty rows of one house is one house,
         and the whole point of the flag is to stop somebody acting on it. */
      reliable: rows.length >= 30,
    };

    /* ── THE CALIBRATION TABLE ──

       What six real houses are compared against, arranged so the comparison
       is one subtraction rather than a project.

       On 20 September the band refused 87% of readings, every one above the
       ceiling, every one from the door method, across all five house types.
       Something is systematically over-reading by roughly a third — but m2 is
       front elevation times a multiplier, and only the product was stored, so
       there was no way to say which half.

       Both halves are recorded now, and grouped here by house type with the
       median rather than the mean: these are small samples and one bad
       photograph should not move the figure a rate card gets set from.

       HOW TO USE IT. For each of six houses, measure the front elevation and
       get the whole-house wall area from an installer. Then:

         frontElevationM2 close to the tape, m2 too high  -> frontToTotal is
           too big; fix FRONT_TO_TOTAL / the calibration table in measure.js.
         frontElevationM2 already too high                -> the door method
           over-reads; the fix is in geometry.js, and the multiplier is
           probably innocent.

       The band is deliberately not widened in the meantime. Accepting these
       readings would put figures 30-40% high into real prices, and an honest
       typical figure beats a confident wrong one. */
    const median = (xs) => {
      const a = xs.filter(Number.isFinite).sort((x, y) => x - y);
      if (!a.length) return null;
      const m = Math.floor(a.length / 2);
      return a.length % 2 ? a[m] : Math.round(((a[m - 1] + a[m]) / 2) * 10) / 10;
    };

    /* Number(null) is 0, not NaN — so a plain isFinite check lets every row
       written before this shipped through as a zero and drags the medians to
       nothing. Rows without the working are absent, not zero. */
    const num = (v) => (v === null || v === undefined || v === '' ? null
      : (Number.isFinite(Number(v)) ? Number(v) : null));

    const calibration = {};
    for (const r of rows) {
      if (num(r.frontElevationM2) === null) continue;
      const type = r.houseType || 'unknown';
      const c = (calibration[type] ||= { samples: 0, front: [], total: [], coverage: [], frontToTotal: null });
      c.samples += 1;
      c.front.push(num(r.frontElevationM2));
      /* The figure the door method produced, whether or not the band kept it.
         rejectedM2 is where it lands once the band fires; m2 is where it
         lands when it does not. */
      const produced = num(r.rejectedM2) ?? num(r.m2);
      if (produced !== null) c.total.push(produced);
      const cov = num(r.coverageM2);
      if (cov !== null) c.coverage.push(cov);
      const f2t = num(r.frontToTotal);
      if (f2t !== null) c.frontToTotal = f2t;
    }
    for (const [type, c] of Object.entries(calibration)) {
      const band = (measure.HOUSE_TYPE_PRIORS || {})[type]?.band || null;
      calibration[type] = {
        samples: c.samples,
        medianFrontElevationM2: median(c.front),
        frontToTotal: c.frontToTotal,
        medianTotalM2: median(c.total),
        medianCoverageM2: median(c.coverage),
        band,
        overCeilingBy: band && median(c.total) ? Math.round((median(c.total) / band[1] - 1) * 100) : null,
        needs: 'the front elevation from a tape measure, and the whole-house wall area from an installer',
      };
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      samples: rows.length,
      rows: allRows.length,
      repeats,
      /* What window these numbers cover, so a figure quoted from here can be
         attributed to a change. Null means the whole table. */
      days: daysRaw,
      since: sinceIso,
      fallback,
      calibration,
      byMethod,
      currentThreshold: geometry.MIN_DOOR_RATIO,
      doorLeafRatio: Number(geometry.DOOR_LEAF_RATIO.toFixed(2)),
      ratioBuckets: Object.values(buckets).sort((a, b) => a.doorRatioFrom - b.doorRatioFrom),
      bandRejections: band,
      /* The bounds themselves, beside what they refused — a rejection list you
         have to go and look up the band for is a rejection list nobody reads. */
      bands: Object.fromEntries(Object.entries(measure.HOUSE_TYPE_PRIORS || {}).map(([k, p]) => [k, p.band])),
      note: 'Shape of the most door-like box each photograph offered, including boxes the measurer refused, '
          + 'and the figures the house-type band threw out. MIN_DOOR_RATIO and the bands in measure.js are '
          + 'currently set from a synthetic terrace and a prototype survey table; this is what would replace that. '
          + 'bandRejections is empty until the band fires, and rows recorded before 18 August 2026 have no rejected figure. '
          + '`fallback` is how often a photograph did not end up sizing the estimate — refused means the band threw a '
          + 'reading out (fix the band, see bandRejections), unusable means nothing could be measured (fix detection '
          + 'or the photo guidance). Treat it as noise until reliable is true, at 30 samples. '
          + 'samples counts distinct photographs and rows counts measurements: autoMeasure runs on every upload, '
          + 'so one house reloaded or re-tested writes a row each time, and repeats is how many were folded away. '
          + 'Every rate here is per photograph. Set TEST_TRAFFIC_TOKEN and send X-Facetpro-Test to keep automated '
          + 'runs out of this table altogether.',
    });
  });

  router.get('/api/ops', installerLimiter, requireInstallerPassword, async (req, res) => {
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    /* Read through the getter, every time.

       `usage` is REASSIGNED in server.js when the UTC day rolls over — not
       mutated, replaced. Capturing the object at wiring time would have bound
       this route to whichever day the process started on, and it would have
       reported that day's counts forever after: no error, no crash, just a
       number that quietly stopped moving. The kind of thing a "purely
       mechanical" extraction introduces and nobody notices until the caps look
       wrong. */
    const usage = getUsage();

    /* The measurement fallback rate, repeated here on purpose.

       It lives in full detail on /api/measurements, and nobody was going to
       open a second endpoint to find out whether the thing the product is
       built on is working. This is the page that gets watched, so the one
       number that says "photographs are not sizing estimates" belongs on it,
       with a pointer to where the detail is. */
    let measurement = null;
    try {
      const rows = await store.readMeasurements(500);
      const fell = rows.filter(r => !r.method || r.method === 'prior').length;
      measurement = {
        samples: rows.length,
        fallbackPct: rows.length ? Math.round((fell / rows.length) * 100) : null,
        reliable: rows.length >= 30,
        detail: '/api/measurements',
      };
    } catch (_) { /* an ops page that fails because one panel failed is worse */ }

    res.json({
      ...obs.summary({ limit }),
      usage: { day: usage.day, detect: usage.detect, render: usage.render, caps: DAILY_LIMITS },
      measurement,
      storage: store.hasDb ? 'postgres' : 'jsonl files (lost on restart without a volume)',
      leadCapture: LEAD_CAPTURE ? 'on' : 'off',
      siteMode: SITE_MODE,
    });
  });

  return router;
};
