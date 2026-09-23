/* Georgian bars: an option on new windows, priced as a multiple of each
   window, drawn on the picture, carried by the save code and the lead.

   The uplift is our own figure, not a supplier's (catalogue
   glazing.georgianBarNote), so these pin where it applies rather than what
   it is. */

'use strict';

require('./helpers/data-dir');   // never write to the real data/ — see the file

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const catalogue = require('../catalogue.json');
const { estimateGlazing } = require('../glazing');
const { buildRenderPrompt } = require('../renderprompt');

const priced = (selections, extra = {}) => estimateGlazing({
  rates: catalogue.glazing, houseType: 'semi', windowCountOverride: 8,
  selections: { windowStyleId: 'casement', windowDoorColourId: 'white', doorStyleId: 'none', ...selections },
  ...extra,
}).price;

test('the catalogue offers Georgian bars and prices them', () => {
  const bars = catalogue.windowsDoors.windowBars || [];
  assert.ok(bars.some(b => b.id === 'georgian'), 'windowsDoors.windowBars should offer georgian');
  const uplift = catalogue.glazing.georgianBarUplift;
  assert.ok(uplift > 1 && uplift < 1.5, `georgianBarUplift should be a modest multiple, got ${uplift}`);
  assert.ok(catalogue.glazing.georgianBarNote, 'an unsourced figure has to say so');
});

test('bars multiply the windows by the uplift', () => {
  const plain = priced({});
  const bars = priced({ windowBarsId: 'georgian' });
  const ratio = bars.supplyFit / plain.supplyFit;
  assert.ok(Math.abs(ratio - catalogue.glazing.georgianBarUplift) < 0.001,
    `supplyFit should rise by exactly the uplift, rose by ${ratio}`);
  // Access and disposal do not care what is in the glass.
  assert.strictEqual(bars.access, plain.access);
  assert.strictEqual(bars.disposal, plain.disposal);
});

test('bars never touch a door, or windows that are staying', () => {
  const door = { windowStyleId: 'none', doorStyleId: 'composite' };
  assert.strictEqual(priced({ ...door, windowBarsId: 'georgian' }).total, priced(door).total,
    'a door-only job moved when bars were chosen');
  const both = { doorStyleId: 'composite' };
  const withBars = priced({ ...both, windowBarsId: 'georgian' });
  assert.strictEqual(withBars.doors, priced(both).doors, 'the door line moved with bars');
});

test('the picture is asked for bars only when they were chosen, on windows only', () => {
  const base = { windowStyle: 'Casement', glazingColour: 'White', glazingColourId: 'white' };
  assert.match(buildRenderPrompt({ ...base, georgianBars: true }), /Georgian glazing bars/);
  assert.match(buildRenderPrompt({ ...base, georgianBars: true }), /Do not add bars to the front door/);
  assert.doesNotMatch(buildRenderPrompt(base), /Georgian/);
  // Bars with no windows changing is not a request.
  assert.doesNotMatch(buildRenderPrompt({ doorStyle: 'Composite', glazingColour: 'White', georgianBars: true }) || '', /Georgian/);
});

test('a kept door is not told to take the frame colour', () => {
  /* The sentence said "every window frame and the door frame must visibly
     take this colour" whether or not the door was changing, beside a hold
     telling the model to leave the door alone. */
  const windowsOnly = buildRenderPrompt({ windowStyle: 'Casement', glazingColour: 'Anthracite', glazingColourId: 'anthracite' });
  assert.doesNotMatch(windowsOnly, /door frame must visibly take/);
  const withDoor = buildRenderPrompt({ windowStyle: 'Casement', doorStyle: 'Composite', glazingColour: 'Anthracite', glazingColourId: 'anthracite' });
  assert.match(withDoor, /door frame must visibly take/);
});

test('the choice travels: price request, render, save code, lead', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const measureRoute = fs.readFileSync(path.join(__dirname, '..', 'routes', 'measure.js'), 'utf8');
  const { ID_FIELDS } = (() => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'resume.js'), 'utf8');
    return { ID_FIELDS: src.slice(src.indexOf('const ID_FIELDS'), src.indexOf('];', src.indexOf('const ID_FIELDS'))) };
  })();
  assert.match(ID_FIELDS, /'windowBarsId'/, 'the save code drops the bars');
  assert.match(measureRoute, /selections: \{[^}]*windowBarsId/, '/api/glazing does not price the bars');
  assert.match(server, /georgianBars: windowBarsId === 'georgian'/, '/api/render does not ask for the bars');
  assert.match(server, /bars: pickById\(wd\.windowBars, body\.windowBarsId/, 'the lead does not record the bars');
  assert.match(server, /windowBars: \(c\.windowsDoors\.windowBars/, 'the public catalogue does not offer the bars');
  const glazingChoice = html.slice(html.indexOf('function glazingChoice'), html.indexOf('function glazingChoice') + 1500);
  assert.match(glazingChoice, /windowBarsId: state\.prefs\.windowBarsId/, 'the render request does not send the bars');
});
