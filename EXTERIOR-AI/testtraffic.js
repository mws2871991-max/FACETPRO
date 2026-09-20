/* Keeping automated traffic out of the numbers the business is calibrated on.

   Between 17 and 20 September an automated review uploaded two photographs —
   assets/work/hero-before.jpg and assets/work/newbuild-before.jpg — around
   fifteen times against production, to test the journey. autoMeasure() runs on
   every upload, so each one wrote a measurements row, and every one of those
   rows was a fallback: the newbuild is a detached house measured at 181 m²
   against a semi-detached band, because the house type defaults to semi.

   /api/measurements then reported 86% of photographs failing to size the
   estimate, over 35 samples. Roughly fifteen of those rows were the test
   traffic, all failures, and about ten of them were the same 181 m² recorded
   again and again — which lands in exactly the bucket bandRejections offers as
   evidence that the semi ceiling is too low. The real rate is bad enough on its
   own (about three quarters once the test rows come out) and the finding
   survives, but nobody should retune a band against one photograph counted ten
   times.

   So: a request may say it is a test, and the two tables the calibration reads
   ignore it. Deliberately narrow — the request is still served exactly as a
   real one, because a test that takes a different path through the code tests
   something else.

   OFF unless TEST_TRAFFIC_TOKEN is set, so production excludes nothing by
   default and a stray header from a scraper cannot quietly remove itself from
   the funnel. The token is a shared secret rather than a bare flag for that
   reason alone; it guards data integrity, not access, and nothing behind it is
   private. */

'use strict';

const crypto = require('crypto');

const HEADER = 'x-facetpro-test';

/* Read per call rather than captured at require time: the tests set the
   variable after loading the server, and an operator turning it on should not
   need a restart to find out whether it works. */
function isTestTraffic(req) {
  const token = String(process.env.TEST_TRAFFIC_TOKEN || '').trim();
  if (!token) return false;

  const sent = String(req?.headers?.[HEADER] || '');
  if (!sent || sent.length !== token.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(token));
  } catch {
    return false;
  }
}

module.exports = { isTestTraffic, TEST_TRAFFIC_HEADER: HEADER };
