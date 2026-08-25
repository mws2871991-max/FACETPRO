/* Turning a detection into numbers: window pricing, and wall measurement.
 *
 * Fifth slice of the decomposition. These two share the thing that makes them
 * awkward to move and sensible to move together: both read `detectionRecords`,
 * the in-memory map of what the vision model found, keyed by the id handed back
 * to the browser.
 *
 * That map is passed in rather than rebuilt here, and passing it directly is
 * safe for a reason worth stating, because the opposite case bit this
 * decomposition already. `detectionRecords` is a `const` Map mutated in place,
 * so a reference stays correct for the life of the process. `usage` in
 * routes/ops.js is a `let` that gets REASSIGNED on the UTC day rollover, so a
 * reference to it goes stale and that one has to be a getter. Same-looking
 * dependency, opposite handling, and the difference is one keyword.
 *
 * Behaviour is unchanged: same paths, same responses.
 */

'use strict';

const express = require('express');
const store = require('../store');
const glazing = require('../glazing');
const measure = require('../measure');
const obs = require('../observability');

/**
 * @param {object} deps
 * @param {Map}      deps.detectionRecords  const Map, mutated in place — safe
 *   to hold by reference; see the note above before adding another like it
 * @param {object}   deps.catalogue
 * @param {Function} deps.record            (table, row) => Promise
 * @param {object}   deps.MEASURE_TUNING
 * @param {Function} deps.pricingVersion         which rate card priced this
 * @param {Function} deps.pruneDetectionRecords  the map's own eviction pass
 * @param {boolean}  deps.GLAZING_RATES_SOURCED
 *
 * The last three stay owned by server.js rather than moving here: /api/quote
 * uses pricingVersion and /api/detect uses pruneDetectionRecords, so they are
 * shared, not ours. Adjacency in the old file was not ownership — the same
 * thing purgeLeadPiiFor taught the withdrawal slice.
 */
module.exports = function measureRoutes({
  detectionRecords, catalogue, record, MEASURE_TUNING,
  pricingVersion, pruneDetectionRecords, GLAZING_RATES_SOURCED,
}) {
  const router = express.Router();

  /* ── POST /api/glazing ──
     A guide price for replacing the windows and the front door.

     Reads the boxes from our own detection record rather than the request, for
     the same reason /api/measure does: the client can send an id, not a
     geometry. Never returns nothing — worst case it falls back to the house-type
     prior and says so, because a homeowner who has just uploaded a photograph of
     their house should not be told the tool has no opinion about it.

     The rates behind this are not sourced. See the warning at startup and the
     caveat the client renders — every figure here is a guide until a supplier
     rate card replaces catalogue.glazing. */
  router.post('/api/glazing', (req, res) => {
    const { detectionId, houseType, windowStyleId, doorStyleId, windowDoorColourId, windowCount, openerCount } = req.body || {};

    /* No style chosen, no price. The module will happily price a default set,
       which is the right behaviour for a module and the wrong one for an
       endpoint: a figure attached to a choice nobody made is the same problem
       as an email confirming a consent nobody gave. */
    if (!windowStyleId && !doorStyleId) {
      return res.status(400).json({ error: 'Choose a window or door style first.', reason: 'nothing_chosen' });
    }

    const record = detectionId ? detectionRecords.get(String(detectionId)) : null;

    try {
      const result = glazing.estimateGlazing({
        detections: record?.detections || [],
        // The record already holds the ratio — it does not hold `size`. Copying the
        // integration note's snippet verbatim read undefined here, which is not
        // an error, just a null: every estimate silently fell back to the
        // house-type prior while looking like it had measured the photograph.
        aspectRatio: record?.aspectRatio ?? null,
        houseType,
        selections: { windowStyleId, doorStyleId, windowDoorColourId },
        rates: catalogue.glazing,
        windowCountOverride: windowCount,
        openerCount,
      });
      res.json({ ...result, ratesSourced: GLAZING_RATES_SOURCED, pricing: pricingVersion() });
    } catch (err) {
      console.error('Glazing estimate failed:', err.message);
      res.status(500).json({ error: 'We couldn’t work out a window estimate for that photo.' });
    }
  });

  router.post('/api/measure', async (req, res) => {
    const measureStartedAt = Date.now();
    res.on('finish', () => {
      obs.time('measure_request', Date.now() - measureStartedAt);
      obs.outcome('measure_request', res.statusCode < 400);
    });

    const { detectionId, houseType } = req.body || {};
    if (!detectionId) return res.status(400).json({ error: 'detectionId required.' });

    /* One normalised key for all four operations.

       The lookup used String(detectionId) and the delete and set used the raw
       value. Send `{"detectionId": ["<a real uuid>"]}` and the array stringifies
       to the same text, so the lookup succeeds — then the delete finds no such
       key and does nothing, and the set inserts a *second* entry under an array
       key that nothing will ever match or evict. Sixty a minute, each holding a
       whole detections array, and the prune below is what stops it growing
       without bound. */
    const id = String(detectionId);
    const record = detectionRecords.get(id);
    if (!record) {
      return res.status(404).json({ error: 'That photo has expired — please upload it again to measure.' });
    }
    /* Still in use — and Map preserves insertion order, so touching the
       timestamp was not enough: eviction takes the oldest inserted, not the
       oldest used. Re-inserting moves it to the back of the queue, which is
       what "keep it alive" was supposed to mean. Someone measuring a photo they
       uploaded twenty minutes ago was getting "that photo has expired"
       mid-journey. */
    record.at = Date.now();
    detectionRecords.delete(id);
    detectionRecords.set(id, record);
    pruneDetectionRecords();

    const result = measure.estimateWallArea({
      detections: record.detections,
      aspectRatio: record.aspectRatio,
      houseType,
      tuning: MEASURE_TUNING,
    });

    // Remembered against the record so /api/quote and /api/lead can use the
    // figure without the client being able to send one of its own.
    record.measurement = result;

    /* One row of evidence about how this photograph measured.

       Three thresholds in geometry.js are currently set from a synthetic
       terrace: where a door box stops being door-shaped, whether the
       house-type band needs a lower bound as well as an upper one, and whether
       a door boxed with its sidelights can be trusted. None of them can be
       settled by argument, only by seeing where real front doors sit.

       Shape numbers and an outcome. No image, no identifier, nothing tied to a
       person or a property — which is why it can be kept without attaching a
       retention period to somebody, and why the privacy notice's counting
       paragraph covers it. Awaited so a storage failure surfaces rather than
       becoming an unhandled rejection, but never allowed to cost the homeowner
       their measurement. */
    try {
      await store.recordMeasurement({
        houseType: result.houseType,
        method: result.method,
        m2: result.m2,
        doorRatio: result.observed?.doorRatio,
        doorHeightPct: result.observed?.doorHeightPct,
        doorBoxes: result.observed?.doorBoxes,
        /* The figure the house-type band refused, when it refused one. Recorded
           because the band's bounds are judgements and this is the only thing
           that could ever revise them — see measure.js. */
        rejected: result.observed?.rejected,
      });
    } catch (err) {
      obs.record('storage', 'could not record a measurement observation', { reason: err.message });
    }

    res.json({
      ...result,
      caveat: 'A planning estimate from your photo, not a survey. An installer confirms exact measurements on site.',
    });
  });

  return router;
};
