/* EPC sizing routes. Every one answers 404 until EPC_SIZING=on, EPC_TOKEN and
   ADDRESS_LOOKUP_KEY are all set, so deploying this changes nothing.

   GET  /api/epc/addresses?postcode=  — the visitor's own postcode, addresses
                                        from the licensed lookup, with UPRNs
   POST /api/epc { uprn, storeys? }    — the newest certificate for that UPRN,
                                        sized; returns an epcId

   The figure stays here, under the epcId, the way a photo measurement stays
   under its detectionId: /api/quote and /api/lead are given the id and look
   the area up themselves, so a browser can never send one. Held in memory
   for two hours and never written down — and the UPRN is not kept at all. */

'use strict';

const crypto = require('crypto');
const express = require('express');
const epc = require('../epc');
const lookup = require('../addresslookup');

const TTL_MS = 2 * 60 * 60 * 1000;
const MAX = 5000;
const records = new Map();

const live = () => epc.enabled() && lookup.configured();

function prune() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, r] of records) if (r.at < cutoff) records.delete(id);
  while (records.size > MAX) records.delete(records.keys().next().value);
}

/* For resolveFootprint in server.js. */
function epcMeasurement(epcId) {
  if (!live() || !epcId) return null;
  const r = records.get(String(epcId));
  if (!r || Date.now() - r.at > TTL_MS) return null;
  return r.result;
}

function epcRoutes({ perMinute, obs }) {
  const router = express.Router();
  const limit = perMinute(20, 'Too many lookups — please wait a moment.');

  router.get('/api/epc/addresses', limit, async (req, res) => {
    if (!live()) return res.status(404).json({ error: 'Not found.' });
    try {
      const list = await lookup.addressesFor(req.query.postcode);
      if (list === null) return res.status(400).json({ error: 'That doesn’t look like a UK postcode.' });
      res.json({ addresses: list });
    } catch (err) {
      obs?.record?.('epc', 'address lookup failed', { reason: err.message });
      res.status(502).json({ error: 'We couldn’t look up that postcode just now. Your photo estimate still works.' });
    }
  });

  router.post('/api/epc', limit, async (req, res) => {
    if (!live()) return res.status(404).json({ error: 'Not found.' });
    const { uprn, storeys } = req.body || {};
    if (!/^\d{1,12}$/.test(String(uprn || ''))) return res.status(400).json({ error: 'Choose your address from the list.' });
    try {
      const cert = await epc.lookupByUprn(uprn);
      if (!cert) return res.status(404).json({ error: 'We couldn’t find an energy certificate for that address — your photo estimate still stands.', reason: 'no_certificate' });
      const result = epc.sizeFromEpc(cert, { storeys: Number(storeys) || undefined });
      if (!result) {
        return res.status(422).json({ error: cert.propertyKind === 'flat'
          ? 'The certificate is for a flat, and we price whole houses — your photo estimate still stands.'
          : 'That certificate doesn’t have what we need to size the walls — your photo estimate still stands.', reason: 'not_sizable' });
      }
      prune();
      const epcId = crypto.randomBytes(12).toString('hex');
      records.set(epcId, { result, at: Date.now() });
      res.json({ epcId, ...result, caveat: 'A planning estimate from your home’s energy certificate, not a survey. An installer confirms exact measurements on site.' });
    } catch (err) {
      obs?.record?.('epc', 'certificate lookup failed', { reason: err.message });
      res.status(502).json({ error: 'The energy certificate register didn’t answer just now. Your photo estimate still works.' });
    }
  });

  return router;
}

module.exports = { epcRoutes, epcMeasurement, live };
