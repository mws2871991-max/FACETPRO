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
  FUNNEL_STAGES, JOURNEY_SOURCES, DAILY_LIMITS,
  getUsage, LEAD_CAPTURE, SITE_MODE,
}) {
  const router = express.Router();

  /* The table from the plan: each stage, and what share of the previous one it
     kept. Behind the installer password, like everything else that describes
     the business rather than the product. */
  router.get('/api/funnel', installerLimiter, requireInstallerPassword, async (req, res) => {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    let counts = {};
    try { counts = await store.readFunnel(days); }
    catch (err) { return res.status(500).json({ error: 'Could not read the funnel.' }); }

    let previous = null;
    const funnel = FUNNEL_STAGES.map(stage => {
      const n = counts[stage] || 0;
      /* Conversion is against the step before, not against the top, because the
         question is always "where do we lose them". */
      const ofPrevious = previous === null ? null : (previous > 0 ? Math.round((n / previous) * 1000) / 10 : 0);
      previous = n;
      return { stage, count: n, ofPreviousPct: ofPrevious };
    });

    /* Per journey, same shape, so the two can be read side by side. A journey
       with no traffic is omitted rather than shown as a column of zeroes. */
    const byJourney = {};
    for (const j of JOURNEY_SOURCES) {
      let prev = null;
      const rows = FUNNEL_STAGES.map(stage => {
        const n = counts[`${j}:${stage}`] || 0;
        const ofPrevious = prev === null ? null : (prev > 0 ? Math.round((n / prev) * 1000) / 10 : 0);
        prev = n;
        return { stage, count: n, ofPreviousPct: ofPrevious };
      });
      if (rows.some(r => r.count > 0)) byJourney[j] = rows;
    }

    res.setHeader('Cache-Control', 'no-store');
    res.json({ days, funnel, byJourney, note: 'Counts are per stage, not per person — see the funnel table in store.js. byJourney counts only visitors who arrived on a journey; the totals above include everyone.' });
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
    let rows = [];
    try { rows = await store.readMeasurements(limit); }
    catch (err) { return res.status(500).json({ error: 'Could not read the observations.' }); }

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

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      samples: rows.length,
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
          + 'bandRejections is empty until the band fires, and rows recorded before 18 August 2026 have no rejected figure.',
    });
  });

  router.get('/api/ops', installerLimiter, requireInstallerPassword, (req, res) => {
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
    res.json({
      ...obs.summary({ limit }),
      usage: { day: usage.day, detect: usage.detect, render: usage.render, caps: DAILY_LIMITS },
      storage: store.hasDb ? 'postgres' : 'jsonl files (lost on restart without a volume)',
      leadCapture: LEAD_CAPTURE ? 'on' : 'off',
      siteMode: SITE_MODE,
    });
  });

  return router;
};
