'use strict';
require('./helpers/data-dir');
/* 0073: a roofline colour stays on the roofline. Render 08fd5c7d, 4 Oct:
   Ink Trim for the fascias also painted the garden gate and door surround. */
const { test } = require('node:test');
const assert = require('node:assert');
const { buildRenderPrompt } = require('../renderprompt');

test('choosing a trim colour names what it must not reach', () => {
  const p = String(buildRenderPrompt({ trim: { id: 'ink-trim', name: 'Ink Trim' } }) || '');
  assert.ok(p, 'a prompt was built');
  assert.match(p, /roofline only/);
  for (const w of ['door surround', 'gates', 'railings', 'window surrounds']) assert.ok(p.includes(w), w);
});

test('gates and railings are held on every render', () => {
  const p = String(buildRenderPrompt({ roof: { id: 'slate', name: 'Slate' } }) || '');
  assert.match(p, /fencing, gates, railings/);
});
