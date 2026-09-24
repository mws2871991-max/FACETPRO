/* Found walking the live site as a customer on 24 September. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildRenderPrompt } = require('../renderprompt');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('a door on its own never asks for the windows to change', () => {
  const p = buildRenderPrompt({ doorStyle: 'Composite Door', glazingColour: 'Anthracite', glazingColourId: 'anthracite' });
  assert.ok(p, 'a door-only job still makes a prompt');
  assert.ok(!/Replace the window frames/.test(p), 'the door-only prompt asks for new window frames');
  assert.ok(!/Every window frame (and the door frame )?must visibly take/.test(p), 'the door-only prompt recolours the windows');
  assert.match(p, /Replace the front door only/);
  assert.match(p, /every window frame keeps its existing colour/i);
});

test('windows and doors together still change both', () => {
  const p = buildRenderPrompt({ windowStyle: 'Casement', doorStyle: 'Composite Door', glazingColour: 'Anthracite', glazingColourId: 'anthracite' });
  assert.match(p, /Replace the window frames and the front door/);
});

test('Ink Trim is not described as blue', () => {
  const p = buildRenderPrompt({ trim: { id: 'ink-trim', name: 'Ink Trim' } });
  assert.ok(p && !/blue/i.test(p.slice(0, p.indexOf('Keep'))), 'the model paints "ink blue" bright blue');
});

test('the windows sentence shows no internal multiplier', () => {
  assert.ok(!/\(×\$\{g\.frontToTotal\}\)/.test(html), '"(×2.6)" means nothing to a customer');
});

test('the upload badge does not promise "a few seconds"', () => {
  assert.ok(!/Takes a few seconds/.test(html));
});

test('no link on a shared part of the page is a homepage-only #anchor', () => {
  const footer = html.slice(html.lastIndexOf('<footer'), html.indexOf('</footer>', html.lastIndexOf('<footer')));
  for (const a of ['#our-work', '#how-it-works', '#faq', '#your-photo']) {
    assert.ok(!footer.includes(`href="${a}"`), `footer link ${a} goes nowhere off its page`);
  }
  assert.ok(!html.includes('href="#conservatory"'), '#conservatory only exists on /design');
});

test('a phone is not offered "take the photo on my phone"', () => {
  const panel = html.slice(html.indexOf('function resumePanel'), html.indexOf("'Not next to your house?'"));
  assert.match(panel, /if \(onPhone\(\) && !currentResumeCode\(\)\)/);
  assert.match(panel, /Started on a computer\?/);
});
