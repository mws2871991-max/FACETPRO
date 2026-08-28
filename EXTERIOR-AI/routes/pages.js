/* The pages: sitemap, cost guides, area pages, legal, investors.
 *
 * Sixth slice of the decomposition. Everything a visitor can reach that is a
 * page rather than an API, mounted as one unit — which matters more here than
 * in the other slices, because this group contains the `/:slug` catch-all.
 *
 * Express matches in registration order, so `/:slug` must stay after every
 * specific single-segment route. Keeping the whole group together and mounting
 * it where it already sat preserves that: the order inside the router is the
 * order it had in server.js, and the router mounts before the 404 handler and
 * after everything else. Splitting these across two modules, or mounting this
 * one earlier, would let `/:slug` start swallowing /privacy and /investors.
 *
 * Behaviour is unchanged: same paths, same limiters, same responses.
 */

'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const landing = require('../landing');

/* ── AN UNFINISHED LEGAL PAGE MUST NOT BE INDEXED ──
 *
 * /privacy and /terms are served to anybody, carry `<meta name="robots"
 * content="index, follow">`, and were listed in the sitemap — while holding
 * thirteen and nine unfilled placeholders respectively. Facet Pro was asking
 * Google to index two legal documents that say [COMPANY LEGAL NAME].
 *
 * Nothing caught it. refuseToStartIfTheNoticeIsUnfinished() in server.js
 * inspects exactly these two files, and it is the right guard for the thing it
 * guards — taking someone's details behind an unfinished Article 13 notice —
 * so it only looks when LEAD_CAPTURE is on. Capture is off, so it never looked,
 * and the pages went out anyway. Publishing an unfinished notice and
 * collecting behind one are different failures; only the second had a guard.
 *
 * So this is deliberately not another switch to remember. The page tells us
 * whether it is finished by whether it still has brackets in it, and it is
 * read per request — no restart needed, and no cache to go stale when the
 * brackets are filled. Same shape as the /investors gate, which un-404s itself
 * the moment its two placeholders are replaced.
 *
 * What it does NOT do is refuse to serve the page. A site that processes
 * photographs of people's homes and offers no privacy notice at all is worse
 * than one offering a visibly draft notice — the draft is honest about being a
 * draft, and it is what a visitor asking the question is entitled to see. It
 * comes out of the sitemap and out of the index; it stays reachable.
 *
 * The same bracket pattern as server.js PLACEHOLDER, kept in step deliberately:
 * a placeholder is defined by its brackets. */
const PLACEHOLDER = /\[[A-Z][^\]]{2,}\]/g;

function placeholdersIn(file) {
  try { return (fs.readFileSync(file, 'utf8').match(PLACEHOLDER) || []).length; }
  catch (_) { return 0; }        // unreadable is not the same as unfinished
}

/**
 * @param {object} deps
 * @param {Function} deps.perMinute               (n, message) => limiter
 * @param {Function} deps.requireInvestorPassword the gate that 404s an
 *   unfinished financial promotion as well as a wrong password
 * @param {object}   deps.catalogue
 * @param {string}   deps.SITE_MODE
 * @param {Array}    deps.LEAD_RECIPIENTS
 * @param {string}   deps.SITE_URL
 * @param {string}   deps.__dirname               the app root, since path
 *   resolution here must stay relative to server.js rather than to routes/
 */
module.exports = function pageRoutes({
  perMinute, requireInvestorPassword, SITE_URL, __dirname: appDir,
  catalogue, SITE_MODE, LEAD_RECIPIENTS,
}) {
  const router = express.Router();
  const __dirname = appDir;   // keep the moved code's path expressions correct

  /* The sitemap is generated, not a file.

     It was a static three-URL document, and adding sixteen landing pages to a
     hand-maintained XML file is a guarantee that one day there will be a page
     nobody can find and an entry pointing at a page that no longer exists.
     landing.allPaths() is the single source, so a page cannot exist unlisted and
     cannot be listed without existing — guarded by test/landing.test.js.

     The static middleware runs before every route in this file, so this route can
     only ever be reached because '/sitemap.xml' has been removed from
     PUBLIC_FILES and the file deleted. See the note there. */
  router.get('/sitemap.xml', (req, res) => {
    const base = SITE_URL.replace(/\/$/, '');
    const today = new Date().toISOString().slice(0, 10);
    /* A page still full of brackets is not offered to search. It reappears
       here by itself once they are filled — see the note at the top. */
    const legal = [
      { loc: '/privacy', file: 'privacy.html', priority: '0.3', changefreq: 'yearly' },
      { loc: '/terms', file: 'terms.html', priority: '0.3', changefreq: 'yearly' },
    ].filter(p => !placeholdersIn(path.join(__dirname, 'legal', p.file)));

    const urls = [
      { loc: '/', priority: '1.0', changefreq: 'weekly' },
      ...landing.allPaths().map(p => ({ loc: p, priority: '0.8', changefreq: 'monthly' })),
      ...legal,
    ];
    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map(u => `  <url>
      <loc>${base}${u.loc}</loc>
      <lastmod>${today}</lastmod>
      <changefreq>${u.changefreq}</changefreq>
      <priority>${u.priority}</priority>
    </url>`).join('\n')}
  </urlset>`);
  });

  /* ── LANDING PAGES ──

     Cost guides and area pages, rendered from the catalogue on each request. See
     landing.js for why nothing here is a static file: every figure comes out of
     the same pricing engine the visualiser uses, so the pages cannot disagree
     with the product, and a rate change updates the marketing by itself.

     Rendered per request rather than cached because they are cheap — a few
     arithmetic calls and a template — and because a stale price is the one thing
     these pages must never serve. The CDN cache header does the real caching, at
     an interval short enough that a rate change is live the same day.

     These serve under the stricter CSP: no scripts, so isLegalPath includes them.
     The one script tag is application/ld+json, which is data, not code, and is
     not affected by script-src. */
  const landingCacheHeader = (res) => {
    res.setHeader('Cache-Control', 'public, max-age=600, stale-while-revalidate=3600');
  };

  router.get('/cost/:slug', perMinute(120, 'Too many requests — please wait a moment.'), (req, res, next) => {
    const html = landing.renderCostPage(req.params.slug, {
      catalogue, siteUrl: SITE_URL.replace(/\/$/, ''), siteMode: SITE_MODE,
    });
    /* next() rather than a 404 here, so an unknown slug falls through to the
       ordinary not-found handler and gets the same response as any other missing
       path. Two 404 pages is two things to keep consistent. */
    if (!html) return next();
    landingCacheHeader(res);
    res.type('html').send(html);
  });

  router.get('/:slug', perMinute(120, 'Too many requests — please wait a moment.'), (req, res, next) => {
    /* Area pages sit at the root because "/windows-essex" is the URL somebody
       would link to and the one that reads as a page rather than a directory.
       The cost of that is this route matching every unknown single-segment path,
       which is why it is registered after every real route and hands anything it
       does not recognise straight on. */
    const html = landing.renderAreaPage(req.params.slug, {
      catalogue,
      siteUrl: SITE_URL.replace(/\/$/, ''),
      siteMode: SITE_MODE,
      /* The live recipient list, so a page cannot imply coverage the routing
         could not honour. An area with nobody configured says so. */
      recipients: LEAD_RECIPIENTS,
    });
    if (!html) return next();
    landingCacheHeader(res);
    res.type('html').send(html);
  });

  /* Served either way; indexed only when finished. X-Robots-Tag rather than
     editing the meta tag in the file, because the header is an instruction to
     every crawler including ones that never parse the HTML, and because the
     day somebody fills the brackets in they should not also have to remember
     to change a meta tag back. */
  const legalPage = (file) => (req, res) => {
    const full = path.join(__dirname, 'legal', file);
    if (placeholdersIn(full)) res.set('X-Robots-Tag', 'noindex, nofollow');
    res.sendFile(full);
  };
  router.get('/privacy', legalPage('privacy.html'));
  router.get('/terms', legalPage('terms.html'));
  /* Gated — see requireInvestorPassword. noindex and robots.txt remain, but
     they were never the control; they only keep it out of search results.
     Served from gated/, which is not in PUBLIC_DIRS, so there is no static path
     to the file. Listed in isLegalPath above so it serves under
     script-src 'none', which is what a page of pure text should get. */
  router.get('/investors', requireInvestorPassword, (req, res) =>
    res.sendFile(path.join(__dirname, 'gated', 'investors.html')));

  return router;
};
