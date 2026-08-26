/* The source of every file that can define a route.
 *
 * Several tests assert structural properties by reading source and matching a
 * regex — that a gated route carries a rate limiter, that the cost pages are
 * routed, that the sitemap is generated rather than served from disk. Those
 * are worth asserting: no behavioural test covers "every gated route", because
 * you would have to know the list in advance, which is the thing being checked.
 *
 * The trap is where they look. Each one originally read server.js alone, and
 * each broke as routes moved into routes/ — not because anything regressed,
 * but because the file they were reading no longer contained the routes. The
 * dangerous version of that failure is the quiet one: a sweep that finds fewer
 * routes and passes anyway is a test that has narrowed its own scope while
 * still reporting green.
 *
 * So the source comes from here, once, and any future module is covered the
 * day it is created rather than the day someone notices.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const APP_ROOT = path.join(__dirname, '..', '..');

/** Concatenated source of server.js and every module in routes/. */
function routeSource() {
  const routesDir = path.join(APP_ROOT, 'routes');
  const files = [path.join(APP_ROOT, 'server.js')];
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir).sort()) {
      if (f.endsWith('.js')) files.push(path.join(routesDir, f));
    }
  }
  return files.map(f => fs.readFileSync(f, 'utf8')).join('\n');
}

/* Routes are declared on `app` in server.js and on `router` inside a module,
   so a pattern written for one misses the other. Build it once, here. */
const routeDeclaration = (route) =>
  new RegExp(`(?:app|router)\\.(get|post)\\(\\s*'${route.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);

module.exports = { routeSource, routeDeclaration, APP_ROOT };
