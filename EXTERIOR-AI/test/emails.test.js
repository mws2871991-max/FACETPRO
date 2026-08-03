/* Email template tests. The templates are pure, so this needs no network and
   no Resend stub — it checks what actually gets put in front of a homeowner. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const emails = require('../emails');

const PRICE = {
  cladding: 8200, roof: 5400, trim: 1900,
  scaffolding: 800, waste: 620, vat: 3384, total: 20304,
  footprintM2: 92, trimLengthM: 34,
  selections: {
    cladding: 'Sage Slate (Fibre Cement)',
    trim: 'Cedar (Fascia/Soffit/Guttering)',
    roof: 'Terracotta (Clay Tile)',
  },
};

const LEAD = {
  id: 'LD-4821',
  name: 'Jane Homeowner',
  email: 'jane@example.com',
  phone: '07700 900123',
  postcode: 'SW11 4NP',
  measurementSource: 'photo_door',
  renderUrl: 'https://cdn.example.test/render.jpg',
};

/* ── the homeowner's design pack ── */

test('the design pack contains their choices, total and reference', () => {
  const html = emails.designPackHtml(LEAD, PRICE, 'https://facetpro.co.uk');
  for (const needle of ['LD-4821', 'Jane Homeowner', 'Sage Slate', 'Cedar', 'Terracotta', '£20,304', '92 m²']) {
    assert.ok(html.includes(needle), `design pack should mention ${needle}`);
  }
});

test('the design pack states it is not a fixed quote', () => {
  const html = emails.designPackHtml(LEAD, PRICE, 'https://facetpro.co.uk');
  assert.match(html, /planning estimate, not a fixed quote/i);
  assert.match(html, /survey/i);
  const text = emails.designPackText(LEAD, PRICE, 'https://facetpro.co.uk');
  assert.match(text, /NOT A FIXED QUOTE/);
});

test('the design pack tells them how to withdraw consent', () => {
  const html = emails.designPackHtml(LEAD, PRICE, 'https://facetpro.co.uk');
  assert.match(html, /withdraw your consent/i);
  assert.ok(html.includes('https://facetpro.co.uk/privacy'));
  assert.ok(html.includes('https://facetpro.co.uk/terms'));
});

test('the design pack never leaks anything internal', () => {
  const html = emails.designPackHtml(LEAD, PRICE, 'https://facetpro.co.uk');
  // These belong in the notification to the business, not in the customer's copy.
  assert.ok(!html.includes('photo_door'), 'no internal measurement source');
  assert.ok(!html.includes('New lead'), 'not the internal subject line');
  assert.ok(!html.includes(LEAD.phone), 'no need to echo their phone number back');
});

test('the design pack embeds the render only when there is one', () => {
  const withRender = emails.designPackHtml(LEAD, PRICE, 'https://facetpro.co.uk');
  assert.ok(withRender.includes('<img src="https://cdn.example.test/render.jpg"'));

  const without = emails.designPackHtml({ ...LEAD, renderUrl: null }, PRICE, 'https://facetpro.co.uk');
  assert.ok(!without.includes('<img'), 'no broken image when they never rendered one');
});

test('a hostile render URL is dropped rather than embedded', () => {
  for (const bad of ['javascript:alert(1)', 'data:text/html,<script>x</script>', 'not a url', '']) {
    const html = emails.designPackHtml({ ...LEAD, renderUrl: bad }, PRICE, 'https://facetpro.co.uk');
    assert.ok(!html.includes('javascript:'), `javascript: URL must not survive (${bad})`);
    assert.ok(!html.includes('data:text/html'), `data: URL must not survive (${bad})`);
  }
});

test('the site URL is validated, falling back rather than emitting rubbish', () => {
  const html = emails.designPackHtml(LEAD, PRICE, 'javascript:alert(1)');
  assert.ok(!html.includes('javascript:'));
  assert.ok(html.includes('https://facetpro.co.uk/privacy'), 'falls back to the default site');

  const custom = emails.designPackHtml(LEAD, PRICE, 'https://staging.example.co.uk/');
  assert.ok(custom.includes('https://staging.example.co.uk/privacy'), 'honours a real override');
});

test('the subject carries the reference so replies can be matched up', () => {
  assert.strictEqual(emails.designPackSubject(LEAD), 'Your Facet Pro design — reference LD-4821');
});

test('the plain-text version stands on its own', () => {
  const text = emails.designPackText(LEAD, PRICE, 'https://facetpro.co.uk');
  assert.ok(!text.includes('<'), 'should contain no markup');
  for (const needle of ['LD-4821', 'Sage Slate', '£20,304', 'facetpro.co.uk/privacy']) {
    assert.ok(text.includes(needle), `text version should mention ${needle}`);
  }
});

/* ── escaping ── */

test('markup in a name cannot break out into either email', () => {
  const nasty = {
    ...LEAD,
    name: '<img src=x onerror="alert(1)">Jane',
    postcode: '"><script>alert(2)</script>',
  };
  for (const html of [
    emails.designPackHtml(nasty, PRICE, 'https://facetpro.co.uk'),
    emails.leadNotificationHtml(nasty, PRICE),
  ]) {
    assert.ok(!html.includes('<img src=x'), 'raw img tag must be escaped');
    assert.ok(!html.includes('<script>'), 'raw script tag must be escaped');
    assert.ok(html.includes('&lt;img src=x'), 'and should appear escaped instead');
  }
});

test('missing optional fields render as a dash, not "undefined"', () => {
  const sparse = { id: 'LD-1', name: 'A', email: 'a@example.com' };
  const html = emails.leadNotificationHtml(sparse, PRICE);
  assert.ok(!html.includes('undefined'), html.match(/.{0,40}undefined.{0,40}/) || '');
  assert.ok(html.includes('—'));
});

/* ── the internal notification ── */

test('the notification carries what you need to act on a lead', () => {
  const html = emails.leadNotificationHtml(LEAD, PRICE);
  for (const needle of ['LD-4821', 'Jane Homeowner', 'jane@example.com', '07700 900123', 'SW11 4NP', '£20,304', 'photo_door']) {
    assert.ok(html.includes(needle), `notification should mention ${needle}`);
  }
});
