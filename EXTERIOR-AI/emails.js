/* Email templates. Pure functions — no sending, no I/O — so the wording and
   the escaping can be tested directly. server.js owns delivery.

   Two audiences, and they must not be confused:

   - leadNotification  -> you. Internal. Contact details and the quote total.
   - designPack        -> the homeowner. Their design, their estimate, and
                          what happens next. Never contains anything internal.

   Everything interpolated is escaped: a lead's name arrives from a public
   form, and unescaped markup in an email is at best a broken layout and at
   worst a phishing vector in your own inbox. */

'use strict';

const escapeHtml = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const money = (n) => `£${Math.round(Number(n) || 0).toLocaleString('en-GB')}`;

// Only allow URLs we'd be happy putting in an email — no javascript:, no data:.
function safeUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(String(url));
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') ? parsed.href : null;
  } catch (_) {
    return null;
  }
}

const row = (label, value) =>
  `<tr><td style="padding:8px 0;color:#6B6E78;width:150px">${label}</td><td style="padding:8px 0">${value}</td></tr>`;

const priceRow = (label, value, strong) =>
  `<tr><td style="padding:6px 0;color:${strong ? '#0F1012' : '#6B6E78'}">${label}</td>` +
  `<td style="padding:6px 0;text-align:right${strong ? ';font-weight:600' : ''}">${money(value)}</td></tr>`;

/* ── internal: new lead notification ── */

function leadNotificationHtml(lead, price) {
  return `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;color:#0F1012">
    <h2 style="font-size:20px;margin-bottom:16px">New lead from Facet Pro</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row('Reference', escapeHtml(lead.id))}
      ${row('Name', `<strong>${escapeHtml(lead.name)}</strong>`)}
      ${row('Email', `<a href="mailto:${encodeURIComponent(lead.email)}">${escapeHtml(lead.email)}</a>`)}
      ${row('Phone', escapeHtml(lead.phone) || '—')}
      ${row('Postcode', escapeHtml(lead.postcode) || '—')}
      ${row('Selections', escapeHtml(`${price.selections.cladding} / ${price.selections.trim} / ${price.selections.roof}`))}
      ${row('Wall area', `${escapeHtml(price.footprintM2)} m² (${escapeHtml(lead.measurementSource)})`)}
      ${row('Quote total', `<strong>${money(price.total)}</strong>`)}
    </table>
  </div>`;
}

/* ── homeowner: their design pack ──
   Deliberately restrained. It confirms what they chose, shows the estimate
   with the same build-up as the site, repeats the planning-estimate caveat
   rather than burying it, and tells them how to get their data removed. */

function designPackHtml(lead, price, siteUrl) {
  const site = safeUrl(siteUrl) || 'https://facetpro.co.uk';
  const base = site.replace(/\/$/, '');
  // renderUrl is now a path on our own site, so make it absolute for email.
  const render = lead.renderUrl && lead.renderUrl.startsWith('/')
    ? base + lead.renderUrl
    : safeUrl(lead.renderUrl);

  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0F1012;background:#FBF8F3;padding:28px 24px">

    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8A8A8F">Facet Pro</div>
    <h1 style="font-size:26px;line-height:1.2;margin:12px 0 0;font-weight:600">Your home, as you designed it</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:14px 0 0">
      Hello ${escapeHtml(lead.name)}, here's the design you saved${lead.postcode ? ` for ${escapeHtml(lead.postcode)}` : ''}.
      Your reference is <strong>${escapeHtml(lead.id)}</strong>.
    </p>

    ${render ? `<img src="${escapeHtml(render)}" alt="Your home with the finishes you chose"
      style="width:100%;border-radius:12px;margin:22px 0 0;display:block">` : ''}

    <h2 style="font-size:15px;margin:26px 0 8px;font-weight:600">What you chose</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px">
      ${row('Walls &amp; cladding', escapeHtml(price.selections.cladding))}
      ${row('Fascia, soffit &amp; guttering', escapeHtml(price.selections.trim))}
      ${row('Roof', escapeHtml(price.selections.roof))}
    </table>

    <h2 style="font-size:15px;margin:26px 0 8px;font-weight:600">Your estimate</h2>
    <table style="width:100%;border-collapse:collapse;font-size:14px;background:#fff;border-radius:12px;padding:8px">
      ${priceRow('Walls &amp; cladding, fitted', price.cladding)}
      ${priceRow('Roof, fitted', price.roof)}
      ${priceRow('Fascia, soffit &amp; guttering', price.trim)}
      ${priceRow('Scaffolding', price.scaffolding)}
      ${priceRow('Waste allowance', price.waste)}
      ${priceRow('VAT (20%)', price.vat)}
      <tr><td colspan="2" style="border-top:1px solid #e4e4e7;padding:0"></td></tr>
      ${priceRow('Estimated total', price.total, true)}
    </table>
    <p style="font-size:12px;line-height:1.6;color:#6B6E78;margin:10px 0 0">
      Based on a wall area of ${escapeHtml(price.footprintM2)} m².
    </p>

    <div style="background:#FFF7ED;border:1px solid #FCD34D;border-radius:12px;padding:14px 16px;margin:22px 0 0">
      <p style="font-size:13px;line-height:1.6;margin:0;color:#7c5b12">
        <strong>This is a planning estimate, not a fixed quote.</strong> Your final price depends on
        the condition of your walls and roof, access, and what an installer finds when they survey
        your home. Colours vary between screens, and the image above is a guide rather than a
        photograph of the finished work.
      </p>
    </div>

    <h2 style="font-size:15px;margin:26px 0 8px;font-weight:600">What happens next</h2>
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0">
      You agreed we could pass your design to installers, so one may contact you to talk it through
      and arrange a survey. There's no obligation to go ahead at any point.
    </p>

    <p style="font-size:12px;line-height:1.6;color:#6B6E78;margin:26px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">
      You're receiving this because you saved a design at <a href="${escapeHtml(base)}/" style="color:#6B6E78">${escapeHtml(base.replace(/^https?:\/\//, ''))}</a>.
      You can withdraw your consent and ask us to delete your details at any time — see our
      <a href="${escapeHtml(base)}/privacy" style="color:#6B6E78">privacy notice</a>.
      Our <a href="${escapeHtml(base)}/terms" style="color:#6B6E78">terms</a> explain how estimates work.
    </p>
  </div>`;
}

// Plain-text alternative. Improves deliverability and is what text-only
// clients show instead of a wall of stripped markup.
function designPackText(lead, price, siteUrl) {
  const base = (safeUrl(siteUrl) || 'https://facetpro.co.uk').replace(/\/$/, '');
  return [
    `Your home, as you designed it`,
    ``,
    `Hello ${lead.name}, here's the design you saved${lead.postcode ? ` for ${lead.postcode}` : ''}.`,
    `Your reference is ${lead.id}.`,
    ``,
    `WHAT YOU CHOSE`,
    `  Walls & cladding:              ${price.selections.cladding}`,
    `  Fascia, soffit & guttering:    ${price.selections.trim}`,
    `  Roof:                          ${price.selections.roof}`,
    ``,
    `YOUR ESTIMATE (wall area ${price.footprintM2} m²)`,
    `  Walls & cladding, fitted       ${money(price.cladding)}`,
    `  Roof, fitted                   ${money(price.roof)}`,
    `  Fascia, soffit & guttering     ${money(price.trim)}`,
    `  Scaffolding                    ${money(price.scaffolding)}`,
    `  Waste allowance                ${money(price.waste)}`,
    `  VAT (20%)                      ${money(price.vat)}`,
    `  Estimated total                ${money(price.total)}`,
    ``,
    `THIS IS A PLANNING ESTIMATE, NOT A FIXED QUOTE. Your final price depends on the`,
    `condition of your walls and roof, access, and what an installer finds when they`,
    `survey your home.`,
    ``,
    `WHAT HAPPENS NEXT`,
    `You agreed we could pass your design to installers, so one may contact you to`,
    `talk it through and arrange a survey. There's no obligation to go ahead.`,
    ``,
    `You're receiving this because you saved a design at ${base}/`,
    `Withdraw consent or ask us to delete your details: ${base}/privacy`,
    `How estimates work: ${base}/terms`,
  ].join('\n');
}

const designPackSubject = (lead) => `Your Facet Pro design — reference ${lead.id}`;

module.exports = {
  leadNotificationHtml,
  designPackHtml,
  designPackText,
  designPackSubject,
  escapeHtml,
  safeUrl,
};
