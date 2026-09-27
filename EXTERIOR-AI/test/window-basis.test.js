'use strict';

require('./helpers/data-dir');
/* The installer is told, part by part, which windows were measured and which
   are a typical size. See glazing.windowBasis. */
const test = require('node:test');
const assert = require('node:assert');
const { windowBasis } = require('../glazing');
const emails = require('../emails');

const photo = { countSource: 'photo_door', frontCount: 4, seenOnly: true, windowCount: 6, backCount: 2 };

test('a back photo: front measured, back counted at typical sizes, sides not seen', () => {
  const b = windowBasis(photo, { backCountSource: 'photo', backPhotoCount: 2 });
  assert.strictEqual(b.front.sizes, 'measured');
  assert.strictEqual(b.back.counted, 'photo');
  assert.strictEqual(b.back.sizes, 'typical');
  assert.match(b.lines.join(' '), /Front: 4 windows, counted from the photo\. Sizes measured/);
  assert.match(b.lines.join(' '), /Back: 2 windows, counted from a photo of the back\. Sizes typical, not measured\./);
  assert.match(b.lines.join(' '), /Sides: not in either photo, and not priced\./);
});

test('windows added with + after a back photo are told apart from the ones it counted', () => {
  const b = windowBasis({ ...photo, backCount: 3, windowCount: 7 }, { backCountSource: 'photo', backPhotoCount: 2 });
  assert.match(b.lines.join(' '), /2 counted from a photo of the back plus 1 added by the homeowner/);
  assert.match(b.lines.join(' '), /Any side windows are among the ones the homeowner added/);
});

test('a typed count is the homeowner\'s number, at typical sizes', () => {
  const b = windowBasis(photo, { backCountSource: 'told' });
  assert.strictEqual(b.back.counted, 'told');
  assert.match(b.lines.join(' '), /Back and sides: 2 windows, number given by the homeowner\. Sizes typical, not measured\./);
});

test('no front door in shot: the front is counted, not measured', () => {
  const b = windowBasis({ ...photo, countSource: 'photo_count' }, { backCountSource: 'told' });
  assert.strictEqual(b.front.sizes, 'typical');
  assert.match(b.lines[0], /Sizes typical, not measured/);
});

test('unanswered back is said to be unpriced, not zero', () => {
  const b = windowBasis({ ...photo, backCount: null, windowCount: 4 }, { backCountSource: 'not priced' });
  assert.strictEqual(b.back, null);
  assert.match(b.lines.join(' '), /Back and sides: not priced/);
});

test('no photo at all: nothing is claimed as counted', () => {
  const b = windowBasis({ countSource: 'house_type_prior', frontCount: null, windowCount: 8 });
  assert.strictEqual(b.front.counted, 'estimated');
  assert.match(b.lines[0], /8 windows in all: typical for the house type\. Not counted or measured/);
});

test('the lead email carries the lines', () => {
  const lines = windowBasis(photo, { backCountSource: 'photo', backPhotoCount: 2 }).lines;
  const html = emails.leadNotificationHtml({ id: 'L1', name: 'A', email: 'a@b.c', glazing: { windowCount: 6, range: { low: 5000, high: 9000 }, countBasis: { lines } } }, null);
  assert.match(html, /Windows/);
  assert.match(html, /Sizes typical, not measured/);
  assert.match(html, /£5,000–£9,000/);
});

test('sides answered after a back photo are their own line', () => {
  const told = windowBasis({ ...photo, backCount: 4, windowCount: 8 }, { backCountSource: 'photo', backPhotoCount: 2, sideCount: 2 });
  assert.match(told.lines.join(' '), /Back: 2 windows, counted from a photo of the back\./);
  assert.match(told.lines.join(' '), /Sides: 2 windows, number given by the homeowner/);
  const none = windowBasis(photo, { backCountSource: 'photo', backPhotoCount: 2, sideCount: 0 });
  assert.match(none.lines.join(' '), /Sides: none, as the homeowner told us/);
  assert.strictEqual(none.sides, 'none');
});

test('a saved design keeps how many the back photo read, and the sides answer', () => {
  const resume = require('../resume');
  const p = resume.buildPayload({ backCount: 4, backCountSource: 'photo', backPhotoCount: 2, sideCount: 2 });
  assert.strictEqual(p.backPhotoCount, 2);
  assert.strictEqual(p.sideCount, 2);
  const unanswered = resume.buildPayload({ backCount: 2, backCountSource: 'photo', backPhotoCount: 2 });
  assert.ok(!('sideCount' in unanswered), 'not answered must not become none');
});
