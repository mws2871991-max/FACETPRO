/* Facet Pro service worker (0074).

   Deliberately does almost nothing. It exists so the site can be added to a
   home screen and open like an app, and so a page opened with no signal says
   so instead of showing the browser's dinosaur.

   It caches ONE thing: the offline page. Never the app, never the API, never
   a photograph. railway up replaces the page under the same URL, and a worker
   that cached it would leave people on yesterday's code with today's server —
   the stale-stylesheet problem server.js already refuses for app.css. */
/* global self, caches, Request */
'use strict';
const CACHE = 'fp-offline-v1';
const OFFLINE = '/offline';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.add(new Request(OFFLINE, { cache: 'reload' }))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  /* Page loads only. Everything else goes to the network untouched. */
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
