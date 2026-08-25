/* Fetching a design, or the render of one, by an unguessable id.
 *
 * Fourth slice of the decomposition. These four go together because they share
 * a security model rather than a subject: none of them has a password, and all
 * of them are reachable by anyone holding the id. That is the point — a render
 * link is sent to a homeowner and a resume code is read off one device and
 * typed into another — and it is also the reason robots.txt disallows /r/ and
 * /s/ and the pages carry noindex and X-Robots-Tag. An id here is a
 * credential.
 *
 * Behaviour is unchanged: same paths, same limiters, same responses.
 */

'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const store = require('../store');
const resume = require('../resume');
const emails = require('../emails');

/**
 * @param {object} deps
 * @param {Function} deps.perMinute  (n, message) => limiter
 * @param {Function} deps.record     (table, row) => Promise
 *
 * The two resume limiters are NOT passed in: they were declared inside this
 * block rather than beside the other limiters in server.js, so they came with
 * the routes that own them. Passing them as well produced a duplicate
 * declaration, which is the pleasant kind of mistake — it fails at parse.
 * @param {string}   deps.SITE_URL             absolute base for the resume link
 */
module.exports = function designRoutes({ perMinute, record, SITE_URL }) {
  const router = express.Router();

  /* ── GET /r/:id ──
     Serves a stored render. The id is 128 bits of randomness, so the URL is the
     capability — that is what lets it work in an email without a login, and it
     is still a great deal better than a public provider URL: we control who has
     it, how long it lives, and retention deletes it with its lead. */
  router.get('/r/:id', async (req, res) => {
    const render = await store.getRender(req.params.id);
    if (!render) return res.status(404).json({ error: 'Not found.' });
    res.setHeader('Content-Type', render.mime || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(render.bytes);
  });

  /* ── POST /api/measure ──
     Optional. Estimates exterior wall area from a photo already analysed by
     /api/detect, so the quote can be sized to the actual house instead of the
     generic default footprint.

     No AI call: this is geometry over the boxes /api/detect already returned,
     which is why it is not routed through the daily cap. If a segmentation
     model is ever added here, it must consume the cap like detect and render do.

     Always a planning estimate — the response carries a range and a caveat, and
     the UI must present it as such. */
  /* ── CARRYING A DESIGN TO A PHONE ──
     The choices, under a six-character code, for a day. No photograph and
     nothing identifying — see resume.js for why that is the whole point rather
     than a detail.

     Two rate limits, because the two directions are different requests: issuing
     is cheap and rare, redeeming is what someone would sit and guess at. */
  const resumeIssueLimiter = rateLimit({
    windowMs: 60 * 1000, max: 10,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many codes — please wait a minute.' }
  });
  const resumeRedeemLimiter = rateLimit({
    windowMs: 60 * 1000, max: 15,
    standardHeaders: true, legacyHeaders: false,
    message: { error: 'Too many tries — please wait a minute.' }
  });

  /* ── A DESIGN SOMEBODY WANTS TO SHOW SOMEONE ──

     The strongest advertisement for this product is a homeowner showing a friend
     what their own house could look like. That is a page, not an image: /r/:id
     serves the JPEG, and a JPEG pasted into WhatsApp says nothing about where it
     came from and gives the friend nothing to tap.

     The privacy reasoning, since this publishes a photograph of somebody's home.

     Nothing here is new disclosure. The id is the same unguessable capability
     token /r/:id already uses — the homeowner has to choose to send it, exactly
     as they would the image, and anyone holding the link could already fetch the
     picture. What this adds is the frame around it and a way back to us.

     So: no name, no postcode, no price, no lead id, and no link between this
     page and the lead record. A recipient learns that a house exists and what it
     could look like, which is what they were shown anyway.

     noindex, nofollow, noarchive and no referrer, because a house photograph must
     not become a search result. robots.txt disallows /s/ as well — belt and
     braces, since robots.txt is a request and the header is an instruction.

     Cache-Control is private: this is somebody's home, not a public asset, and it
     must not sit in a shared CDN cache. */
  const sharePage = ({ imageUrl, siteUrl }) => `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="robots" content="noindex,nofollow,noarchive">
  <meta name="referrer" content="no-referrer">
  <title>See what this house could look like &mdash; Facet Pro</title>
  <meta property="og:title" content="See what my house could look like with Facet Pro">
  <meta property="og:description" content="One photo. See your exterior renovation and what it could cost.">
  <meta property="og:image" content="${emails.escapeHtml(imageUrl)}">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <link rel="icon" href="/assets/favicon-32.png">
  <style>
    :root{color-scheme:light}
    body{font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#FBF8F3;color:#0F1012;margin:0;padding:24px 16px}
    main{max-width:620px;margin:0 auto}
    .card{background:#fff;border:1px solid #e4e4e7;border-radius:20px;overflow:hidden}
    img{display:block;width:100%;height:auto;background:#E8DED0}
    .body{padding:22px 20px}
    h1{font-size:23px;line-height:1.25;margin:0 0 8px;font-weight:600}
    p{color:#3f3f46;margin:10px 0}
    .cta{display:block;margin-top:18px;padding:16px 20px;background:#0F1012;color:#fff;text-decoration:none;border-radius:999px;text-align:center;font-weight:600}
    .muted{color:#6B6E78;font-size:13px}
    footer{max-width:620px;margin:20px auto 0;color:#6B6E78;font-size:12px;text-align:center}
  </style></head><body><main>
  <div class="card">
    <img src="${emails.escapeHtml(imageUrl)}" alt="A home exterior visualised by Facet Pro">
    <div class="body">
      <h1>See what my house could look like with Facet Pro.</h1>
      <p>This is one photograph, visualised and costed &mdash; no survey, no showroom, nobody calling round.</p>
      <a class="cta" href="${emails.escapeHtml(siteUrl)}/">Try it on your house &rarr;</a>
      <p class="muted">Free to try &middot; One photo &middot; No sales call unless you ask</p>
    </div>
  </div>
  <footer>Facet Pro &middot; <a href="/privacy" style="color:#6B6E78">Privacy notice</a></footer>
  </main></body></html>`;

  router.get('/s/:id', perMinute(120, 'Too many requests — please wait a moment.'), async (req, res) => {
    /* Checked against the store rather than rendered blind, so a made-up id gets
       a 404 instead of a branded page with a broken image on it. */
    const render = await store.getRender(req.params.id);
    if (!render) return res.status(404).type('text/plain').send('Not found.');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.type('html').send(sharePage({
      imageUrl: `${SITE_URL.replace(/\/$/, '')}/r/${encodeURIComponent(req.params.id)}`,
      siteUrl: SITE_URL.replace(/\/$/, ''),
    }));
  });

  router.post('/api/resume', resumeIssueLimiter, async (req, res) => {
    const design = resume.buildPayload(req.body || {});
    if (!Object.keys(design).length) {
      return res.status(400).json({ error: 'There’s nothing to carry over yet — choose something first.', reason: 'nothing_to_save' });
    }
    const now = Date.now();
    const record = {
      ts: new Date(now).toISOString(),
      code: resume.newCode(),
      expiresAt: new Date(now + resume.TTL_MS).toISOString(),
      design,
    };
    try {
      await store.append('resumes', record);
    } catch (err) {
      console.error('Could not store a resume code:', err.message);
      return res.status(500).json({ error: 'We couldn’t make you a code just now.' });
    }
    res.setHeader('Cache-Control', 'no-store');
    res.json({ code: record.code, expiresAt: record.expiresAt });
  });

  router.get('/api/resume/:code', resumeRedeemLimiter, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!resume.isCode(req.params.code)) {
      return res.status(400).json({ error: 'That code doesn’t look right.', reason: 'bad_code' });
    }
    /* Use the index where there is one. getResume returns undefined on the
       JSONL backend, which has none, so that path still scans — but the
       database does not need to read every live code to find one row. */
    const wanted = resume.normaliseCode(req.params.code);
    let found;
    try { found = await store.getResume(wanted); } catch (_) { /* fall through */ }
    if (found === undefined) {
      let rows = [];
      try { rows = await store.readAll('resumes'); } catch (_) { /* none yet */ }
      found = resume.find(rows, wanted);
    } else if (found && resume.isExpired(found)) {
      found = null;
    }
    if (!found) {
      // Expired and never-existed are the same answer: there is nothing to tell
      // apart, and nothing worth confirming to somebody guessing.
      return res.status(404).json({ error: 'That code has expired or we don’t recognise it.', reason: 'not_found' });
    }
    res.json({ design: found.design, expiresAt: found.expiresAt });
  });

  return router;
};
