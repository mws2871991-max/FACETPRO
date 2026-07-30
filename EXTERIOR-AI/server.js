const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const store = require('./store');

const catalogue = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalogue.json'), 'utf8'));

const app = express();
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: '20mb' }));
app.use(express.static(__dirname));

/* ── RATE LIMITERS ── */
const detectLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many requests — please wait a minute and try again.' }
});
const renderLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many renders — please wait a minute.' }
});
const leadLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5,
  standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many submissions — please wait a minute.' }
});

/* ── GET /api/catalogue ── */
// Real cladding/trim/roof swatches + prices, loaded from catalogue.json.
// `internalNote` and `source` are developer provenance notes (they name internal
// file paths) — strip them so they never reach the public response.
const { internalNote, source, ...publicCatalogue } = catalogue;
app.get('/api/catalogue', (req, res) => {
  res.json(publicCatalogue);
});

/* ── helper: compute price server-side from catalogue + selections ──
   Never trust a client-submitted price — always recompute here so a
   tampered request can't create a lead with a fake quote. */
function computePrice({ claddingId, trimId, roofId, footprintM2, trimLengthM }) {
  const cladding = catalogue.cladding.find(c => c.id === claddingId) || catalogue.cladding[0];
  const trim = catalogue.trim.find(t => t.id === trimId) || catalogue.trim[0];
  const roof = catalogue.roof.find(r => r.id === roofId) || catalogue.roof[0];
  const claddingArea = footprintM2 && footprintM2 > 0 ? footprintM2 : catalogue.defaultFootprintM2;
  const roofArea = claddingArea * 0.55; // roof area is typically smaller than wall footprint
  const trimLength = trimLengthM && trimLengthM > 0 ? trimLengthM : catalogue.defaultTrimLengthM;

  // Real methodology from quote_generator.py: materials + labour (real per-m²/per-m rates)
  // + fixed scaffolding + waste allowance, then VAT on top.
  // Trim colour is cosmetic — fascia/soffit/guttering cost is the same real rate
  // regardless of which colour is picked, matching how the real business prices it.
  const tr = catalogue.trimRates;
  const claddingMaterial = cladding.pricePerM2 * claddingArea;
  const roofMaterial = roof.pricePerM2 * roofArea;
  const trimMaterial = (tr.fasciaPerM + tr.soffitPerM + tr.gutteringPerM) * trimLength;
  const materialsSubtotal = claddingMaterial + roofMaterial + trimMaterial;

  const claddingLabour = catalogue.labour.claddingPerM2 * claddingArea;
  const roofLabour = catalogue.labour.roofPerM2 * roofArea;
  const trimLabour = (tr.fasciaLabourPerM + tr.soffitLabourPerM + tr.gutteringLabourPerM) * trimLength;
  const labourSubtotal = claddingLabour + roofLabour + trimLabour;

  const scaffolding = catalogue.scaffoldingCost;
  const waste = materialsSubtotal * catalogue.wastePct;
  const subtotal = materialsSubtotal + labourSubtotal + scaffolding + waste;
  const vat = subtotal * catalogue.vatPct;
  const total = subtotal + vat;

  return {
    cladding: Math.round(claddingMaterial + claddingLabour),
    roof: Math.round(roofMaterial + roofLabour),
    trim: Math.round(trimMaterial + trimLabour),
    scaffolding: Math.round(scaffolding),
    waste: Math.round(waste),
    vat: Math.round(vat),
    total: Math.round(total),
    footprintM2: claddingArea,
    trimLengthM: trimLength,
    selections: {
      cladding: `${cladding.name} (${cladding.materialLabel})`,
      trim: `${trim.name} (Fascia/Soffit/Guttering)`,
      roof: `${roof.name} (${roof.materialLabel})`
    }
  };
}

/* ── POST /api/quote ── */
// Recomputes a price live from catalogue data as the user changes swatches —
// no AI call, instant. Real numbers (from catalogue.json), not a client guess.
app.post('/api/quote', (req, res) => {
  const { claddingId, trimId, roofId, footprintM2, trimLengthM } = req.body || {};
  res.json(computePrice({ claddingId, trimId, roofId, footprintM2, trimLengthM }));
});

/* ── POST /api/detect ──
   Real AI detection via Claude vision. Requires ANTHROPIC_API_KEY. */
app.post('/api/detect', detectLimiter, async (req, res) => {
  const { image, mimeType, sessionId } = req.body || {};
  if (!image || !mimeType) return res.status(400).json({ error: 'Missing image or mimeType.' });
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (!allowed.includes(mimeType)) return res.status(400).json({ error: 'Unsupported image type.' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set — see .env.example.' });

  let anthropicRes;
  try {
    anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-sonnet-5',
        max_tokens: 1200,
        messages: [{
          role: 'user',
          content: [
            { type: 'image', source: { type: 'base64', media_type: mimeType, data: image } },
            { type: 'text', text: `Detect every exterior architectural element on this UK home. Return ONLY a JSON array, no markdown. Detect ALL of these element types if visible:

- "window": any window
- "door-front": the main front door
- "roof": the main roof surface
- "cladding": exterior wall cladding/render/brick surface
- "fascia": the fascia board (under the roofline edge)
- "soffit": the soffit (underside of the roof overhang)
- "guttering": guttering/downpipes

Each item must have: {"type":"one of above","label":"short human label e.g. Main Roof","confidence":0.0-1.0,"x_pct":0-100,"y_pct":0-100,"w_pct":1-100,"h_pct":1-100,"notes":"one sentence description including material/colour if visible"}

Coordinates: x_pct/y_pct = top-left corner, w_pct/h_pct = width/height, all as % of image dimensions.

Finally add: {"type":"analysis","summary":"2-3 sentence overview of the property","era":"victorian|edwardian|inter-war|post-war|modern|contemporary","wallMaterial":"red-brick|yellow-brick|grey-brick|render|stone|pebbledash|timber|other"}` }
          ]
        }]
      })
    });
  } catch (err) {
    return res.status(502).json({ error: "Couldn't reach the detection service." });
  }

  if (!anthropicRes.ok) {
    let detail = '';
    try { detail = (await anthropicRes.json())?.error?.message || ''; } catch (_) {}
    console.error(`Anthropic error: HTTP ${anthropicRes.status} — ${detail}`);
    if (anthropicRes.status === 401) return res.status(500).json({ error: 'API key rejected.' });
    if (anthropicRes.status === 429) return res.status(429).json({ error: 'Rate limit hit — try again shortly.' });
    if (anthropicRes.status >= 500) return res.status(502).json({ error: 'Detection service error — try again.' });
    return res.status(502).json({ error: `Detection failed (HTTP ${anthropicRes.status}).${detail ? ' ' + detail : ''}` });
  }

  let data;
  try { data = await anthropicRes.json(); } catch (_) {
    return res.status(502).json({ error: 'Unreadable response from detection service.' });
  }

  const raw = data.content?.filter(b => b.type === 'text').map(b => b.text).join('') || '';
  const arrMatch = raw.replace(/```json|```/g, '').trim().match(/\[[\s\S]*\]/);
  let detections = [];
  if (arrMatch) {
    try { detections = JSON.parse(arrMatch[0]); } catch (_) {}
  }

  const elementCount = detections.filter(d => d.type !== 'analysis').length;
  await store.append('detections', { ts: new Date().toISOString(), sessionId: sessionId || null, elementCount, mimeType });

  res.json({ detections });
});

/* ── POST /api/render ──
   Real AI render via Replicate FLUX Kontext Pro. Requires REPLICATE_API_TOKEN.
   Accepts { image: 'data:image/...;base64,...', mimeType, claddingName, trimName, roofName } */
app.post('/api/render', renderLimiter, async (req, res) => {
  const { image, mimeType, claddingName, trimName, roofName } = req.body || {};
  if (!image) return res.status(400).json({ error: 'image required' });
  if (typeof image !== 'string' || image.length < 10) return res.status(400).json({ error: 'Invalid image data.' });
  if (image.length > 20 * 1024 * 1024) return res.status(413).json({ error: 'Image too large (max 20MB).' });

  const replicateKey = process.env.REPLICATE_API_TOKEN;
  if (!replicateKey) return res.status(500).json({ error: 'REPLICATE_API_TOKEN not set — see .env.example.' });

  const cladding = claddingName || 'Alabaster';
  const trim = trimName || 'Ink Trim';
  const roof = roofName || 'Slate Roof';

  const prompt = [
    `Replace the exterior wall cladding with a photorealistic ${cladding} finish, the window/door trim with ${trim} coloured trim, and the roof material with ${roof}.`,
    `Critically: preserve the exact perspective, shadow direction, ambient lighting colour temperature, lens distortion, camera exposure, and depth of field of the original photograph.`,
    `The windows, doors, garden, path, sky and every other element must remain completely untouched and pixel-perfect to the original — only the wall cladding, trim colour, and roof material change.`,
    `Shadows and reflections must remain consistent with the existing light source angle and intensity.`,
    `The result must be indistinguishable from a real installation photograph.`
  ].join(' ');

  const inputImage = image.startsWith('data:') ? image : `data:${mimeType || 'image/jpeg'};base64,${image}`;

  try {
    const controller = new AbortController();
    const renderTimeout = setTimeout(() => controller.abort(), 120000);

    const predRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-kontext-pro/predictions', {
      method: 'POST',
      signal: controller.signal,
      headers: { 'Authorization': `Bearer ${replicateKey}`, 'Content-Type': 'application/json', 'Prefer': 'wait=90' },
      body: JSON.stringify({ input: { prompt, input_image: inputImage, output_format: 'jpg', safety_tolerance: 5 } })
    });
    clearTimeout(renderTimeout);

    if (!predRes.ok) {
      const err = await predRes.json().catch(() => ({}));
      console.error('Replicate render error:', predRes.status, err);
      return res.status(502).json({ error: `Render failed (${predRes.status}).` });
    }

    const pred = await predRes.json();
    if (pred.status === 'succeeded' && pred.output) {
      const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
      return res.json({ url });
    }

    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 2000));
      const poll = await fetch(`https://api.replicate.com/v1/predictions/${pred.id}`, {
        headers: { 'Authorization': `Bearer ${replicateKey}` }
      });
      const p = await poll.json();
      if (p.status === 'succeeded') {
        const url = Array.isArray(p.output) ? p.output[0] : p.output;
        return res.json({ url });
      }
      if (p.status === 'failed') return res.status(502).json({ error: 'Render failed — try again.' });
    }
    return res.status(504).json({ error: 'Render timed out — try again.' });

  } catch (err) {
    console.error('Render error:', err);
    return res.status(502).json({ error: "Couldn't reach the render service." });
  }
});

/* ── POST /api/lead ──
   Real lead capture. Recomputes price server-side (never trusts client price),
   stores it, emails the owner via Resend if configured, fires a CRM webhook if configured. */
app.post('/api/lead', leadLimiter, async (req, res) => {
  const { name, email, phone, postcode, claddingId, trimId, roofId, footprintM2, trimLengthM, measurementSource, detections, renderUrl, notes } = req.body || {};
  if (!name || !email) return res.status(400).json({ error: 'name and email are required.' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email address.' });

  const price = computePrice({ claddingId, trimId, roofId, footprintM2, trimLengthM });

  const lead = {
    ts: new Date().toISOString(),
    id: `LD-${Math.floor(2000 + Math.random() * 9000)}`,
    name, email, phone: phone || '', postcode: postcode || '',
    selections: price.selections,
    price: price.total,
    priceBreakdown: price,
    measurementSource: measurementSource || 'default_footprint',
    detectionCount: Array.isArray(detections) ? detections.length : 0,
    renderUrl: renderUrl || null,
    notes: (notes || '').slice(0, 2000),
    status: 'New lead'
  };
  await store.append('leads', lead);

  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const { Resend } = require('resend');
      const resend = new Resend(resendKey);
      await resend.emails.send({
        from: 'Facet Pro <onboarding@resend.dev>',
        to: process.env.LEAD_NOTIFY_EMAIL || email,
        subject: `New lead: ${name} — ${postcode || 'no postcode'}`,
        html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#0F1012">
          <h2 style="font-size:20px;margin-bottom:16px">New lead from Facet Pro</h2>
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <tr><td style="padding:8px 0;color:#6B6E78;width:120px">Name</td><td style="padding:8px 0;font-weight:600">${name}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6E78">Email</td><td style="padding:8px 0"><a href="mailto:${email}">${email}</a></td></tr>
            <tr><td style="padding:8px 0;color:#6B6E78">Phone</td><td style="padding:8px 0">${phone || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6E78">Postcode</td><td style="padding:8px 0">${postcode || '—'}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6E78">Selections</td><td style="padding:8px 0">${price.selections.cladding} / ${price.selections.trim} / ${price.selections.roof}</td></tr>
            <tr><td style="padding:8px 0;color:#6B6E78">Quote total</td><td style="padding:8px 0;font-weight:600">£${price.total.toLocaleString()}</td></tr>
          </table>
        </div>`
      });
    } catch (e) { console.error('Lead email error:', e.message); }
  }

  const crmWebhook = process.env.CRM_WEBHOOK_URL;
  if (crmWebhook) {
    fetch(crmWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lead)
    }).catch(e => console.error('CRM webhook error:', e.message));
  }

  res.json({ ok: true, lead });
});

/* ── GET /api/leads ──
   Real leads captured so far, newest first. */
app.get('/api/leads', async (req, res) => {
  const leads = await store.readAll('leads');
  res.json({ leads: leads.slice().reverse() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Facet Pro server running on http://localhost:${PORT}`));
