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
      ${row('Email', `<a href="mailto:${encodeURI(String(lead.email || ''))}">${escapeHtml(lead.email)}</a>`)}
      ${row('Phone', escapeHtml(lead.phone) || '—')}
      ${row('Postcode', escapeHtml(lead.postcode) || '—')}
      ${row('Selections', escapeHtml(`${price.selections.cladding} / ${price.selections.trim} / ${price.selections.roof}`))}
      ${row('Wall area', `${escapeHtml(price.footprintM2)} m² (${escapeHtml(lead.measurementSource)})`)}
      ${row('Quote total', `<strong>${money(price.total)}</strong>`)}
    </table>
  </div>`;
}

/* The notice says "we will tell you which installers received your details".
   That is a promise, so it is kept in the email rather than only on request.

   Present tense, deliberately. This email goes out before delivery does — the
   homeowner should not wait on three third-party webhooks for their
   confirmation — so at the moment they read it, these are the installers
   their enquiry is going to, not ones that have it. Delivery can still fail,
   and when it does the withdrawal page reads the delivery log and would
   correctly say nobody received anything. Two artefacts, one homeowner: they
   must not contradict each other, and the one written first is the one that
   has to be careful. */
function installerList(recipients) {
  const list = (recipients || []).filter(r => r && r.name);
  if (!list.length) return '';
  return `<p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0">
      We're passing your details and your design to:
    </p>
    <ul style="font-size:14px;line-height:1.7;color:#3f3f46;margin:8px 0 0;padding-left:20px">
      ${list.map(r => `<li>${escapeHtml(r.name)}</li>`).join('')}
    </ul>
    <p style="font-size:12px;line-height:1.6;color:#6B6E78;margin:8px 0 0">
      If we can't reach any of them we'll let you know.
    </p>`;
}

/* ── homeowner: their design pack ──
   Deliberately restrained. It confirms what they chose, shows the estimate
   with the same build-up as the site, repeats the planning-estimate caveat
   rather than burying it, and tells them how to get their data removed. */

function designPackHtml(lead, price, siteUrl, withdrawToken, recipients) {
  const site = safeUrl(siteUrl) || 'https://facetpro.co.uk';
  const base = site.replace(/\/$/, '');
  /* The notice promises "the link in any email we send you", so this has to
     be a link that does something, not a pointer at the notice. */
  const withdrawLink = withdrawToken ? `${base}/withdraw?t=${encodeURIComponent(withdrawToken)}` : null;
  // renderUrl is now a path on our own site, so make it absolute for email.
  const render = lead.renderUrl && lead.renderUrl.startsWith('/')
    ? base + lead.renderUrl
    : safeUrl(lead.renderUrl);
  /* Read from the consent record on the lead, not from whether anyone happens
     to have been named. The "what happens next" paragraph below used to be
     unconditional, so somebody who deliberately left the sharing box unticked
     received written confirmation that they had ticked it — contradicting our
     own stored consent record in the one artefact they keep. */
  const shared = lead.consent?.installerQuotes === true;
  const named = (recipients || []).filter(r => r && r.name);
  /* Three states, not two. Asking for quotes and nobody covering you is not
     the same as not asking — and it used to render as "They may contact you"
     with nothing above it for "they" to refer to, while the text version said
     outright that we were passing details to installers who cover the area,
     when the caller had already established that none do. */
  const nextSteps = !shared
    ? 'We haven\'t passed your details to anyone. If you would like quotes from installers, reply to this email and we will arrange it — and if you would rather we didn\'t, you need do nothing.'
    : named.length
      ? 'They may contact you by email or telephone to talk it through and arrange a survey. There is no obligation to go ahead at any point.'
      : 'We don\'t currently have an installer covering your area, so we haven\'t passed your details to anyone. We\'ll let you know if that changes — your design and your estimate are saved either way.';

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
    ${shared && named.length ? installerList(named) : ''}
    <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:${shared && named.length ? '10px 0 0' : '0'}">
      ${nextSteps}
    </p>

    <p style="font-size:12px;line-height:1.6;color:#6B6E78;margin:26px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">
      You're receiving this because you saved a design at <a href="${escapeHtml(base)}/" style="color:#6B6E78">${escapeHtml(base.replace(/^https?:\/\//, ''))}</a>.
      ${withdrawLink
        ? `You can <a href="${escapeHtml(withdrawLink)}" style="color:#6B6E78">change your mind or ask us to delete your details</a> at any time — see our <a href="${escapeHtml(base)}/privacy" style="color:#6B6E78">privacy notice</a>.`
        : `You can withdraw your consent and ask us to delete your details at any time — see our <a href="${escapeHtml(base)}/privacy" style="color:#6B6E78">privacy notice</a>.`}
      Our <a href="${escapeHtml(base)}/terms" style="color:#6B6E78">terms</a> explain how estimates work.
    </p>
  </div>`;
}

/* The same three states as the HTML, kept beside it so they cannot drift.
   The text version was the worse of the two: it carried the sentence "we are
   passing your details to installers who cover your area" for exactly the
   people nobody covered. */
function whatHappensNextText(lead, recipients) {
  const shared = lead.consent?.installerQuotes === true;
  const named = (recipients || []).filter(r => r && r.name);
  if (!shared) {
    return ["We haven't passed your details to anyone. If you would like quotes from",
            'installers, reply to this email and we will arrange it.'];
  }
  if (!named.length) {
    return ["We don't currently have an installer covering your area, so we haven't",
            "passed your details to anyone. We'll let you know if that changes — your",
            'design and your estimate are saved either way.'];
  }
  return ["We're passing your details and your design to:",
          ...named.map(r => `  ${r.name}`),
          "If we can't reach any of them we'll let you know.",
          'They may contact you by email or telephone to talk it through and arrange a',
          'survey. There is no obligation to go ahead at any point.'];
}

// Plain-text alternative. Improves deliverability and is what text-only
// clients show instead of a wall of stripped markup.
function designPackText(lead, price, siteUrl, withdrawToken, recipients) {
  const base = (safeUrl(siteUrl) || 'https://facetpro.co.uk').replace(/\/$/, '');
  const withdrawLink = withdrawToken ? `${base}/withdraw?t=${encodeURIComponent(withdrawToken)}` : `${base}/privacy`;
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
    ...whatHappensNextText(lead, recipients),
    ``,
    `You're receiving this because you saved a design at ${base}/`,
    `Change your mind or ask us to delete your details: ${withdrawLink}`,
    `How estimates work: ${base}/terms`,
  ].join('\n');
}

const designPackSubject = (lead) => `Your Facet Pro design — reference ${lead.id}`;

/* ── homeowner: confirmation that their details have gone to installers ──

   The design pack used to be the only email the homeowner ever received, and
   it only goes to people who asked for it. So someone who ticked "get quotes"
   but not "email me my design" had their details sent to three companies and
   received nothing at all — no record of it, and no withdrawal link. That is
   the person who most needs one.

   This is transactional, not marketing: it confirms something they asked for,
   names who received their details as the notice promises, and carries the
   link that makes Article 7(3) real. Deliberately short — the design pack is
   the one with the picture in it. */

function sharingConfirmationHtml(lead, recipients, siteUrl, withdrawToken) {
  const site = safeUrl(siteUrl) || 'https://facetpro.co.uk';
  const base = site.replace(/\/$/, '');
  const withdrawLink = withdrawToken ? `${base}/withdraw?t=${encodeURIComponent(withdrawToken)}` : null;

  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0F1012;background:#FBF8F3;padding:28px 24px">

    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8A8A8F">Facet Pro</div>
    <h1 style="font-size:24px;line-height:1.25;margin:12px 0 0;font-weight:600">Your enquiry is on its way</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:14px 0 0">
      Hello ${escapeHtml(lead.name)}, thank you for asking us to get you quotes${lead.postcode ? ` for ${escapeHtml(lead.postcode)}` : ''}.
      Your reference is <strong>${escapeHtml(lead.id)}</strong>.
    </p>

    <div style="background:#fff;border-radius:12px;padding:18px 20px;margin:22px 0 0">
      ${installerList(recipients) || `<p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0">
        We don't currently have an installer covering your area, so we haven't passed
        your details to anyone. We'll let you know if that changes.
      </p>`}
      <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:10px 0 0">
        They may contact you by email or telephone to talk it through and arrange a survey.
        There is no obligation to go ahead at any point, and each of them is responsible
        for its own use of your details.
      </p>
    </div>

    ${withdrawLink ? `<p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:22px 0 0">
      Changed your mind? You can
      <a href="${escapeHtml(withdrawLink)}" style="color:#0F1012"><strong>stop this at any time</strong></a>
      — we will tell the installers, and you can ask us to delete your details altogether.
    </p>` : ''}

    <p style="font-size:12px;line-height:1.6;color:#6B6E78;margin:26px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">
      You're receiving this because you asked us for quotes at
      <a href="${escapeHtml(base)}/" style="color:#6B6E78">${escapeHtml(base.replace(/^https?:\/\//, ''))}</a>.
      It is not a marketing email and you will not be added to a list. Our
      <a href="${escapeHtml(base)}/privacy" style="color:#6B6E78">privacy notice</a> explains what we do with your details.
    </p>
  </div>`;
}

function sharingConfirmationText(lead, recipients, siteUrl, withdrawToken) {
  const base = (safeUrl(siteUrl) || 'https://facetpro.co.uk').replace(/\/$/, '');
  const named = (recipients || []).filter(r => r && r.name);
  return [
    'Your enquiry is on its way',
    '',
    `Hello ${lead.name}, thank you for asking us to get you quotes${lead.postcode ? ` for ${lead.postcode}` : ''}.`,
    `Your reference is ${lead.id}.`,
    '',
    ...(named.length
      ? ["We're passing your details and your design to:", ...named.map(r => `  ${r.name}`)]
      : ["We don't currently have an installer covering your area, so we haven't passed",
         "your details to anyone. We'll let you know if that changes."]),
    '',
    'They may contact you by email or telephone to talk it through and arrange a survey.',
    'There is no obligation to go ahead at any point.',
    '',
    `Changed your mind? Stop this at any time: ${withdrawToken ? `${base}/withdraw?t=${encodeURIComponent(withdrawToken)}` : `${base}/privacy`}`,
    '',
    `You asked us for quotes at ${base}/ — this is not a marketing email.`,
    `What we do with your details: ${base}/privacy`,
  ].join('\n');
}

const sharingConfirmationSubject = (lead) => `We've sent your enquiry on — reference ${lead.id}`;

/* ── homeowner: they asked for quotes, and nobody covers them ──

   The site tells them this before they ask — /api/coverage answers "we don't
   have an installer covering SW11 yet" — but the box is still tickable, and
   someone who ticks it anyway has made a request we should honour with an
   honest answer rather than a cheerful one.

   The email they must not receive is the one headed "we've sent your enquiry
   on", which is what they used to get: installerList([]) rendered nothing, so
   the template fell through to "we are passing your details to installers who
   cover your area" while the code already knew nobody did. Their withdrawal
   page, reading the delivery log, would then correctly say nothing had been
   shared. Two artefacts, one homeowner, and the cheerful one arrives first.

   The consent still stands and is still recorded — they asked, and that is a
   fact worth keeping — so this carries the withdrawal link like the others. */

function noInstallersHtml(lead, siteUrl, withdrawToken) {
  const site = safeUrl(siteUrl) || 'https://facetpro.co.uk';
  const base = site.replace(/\/$/, '');
  const withdrawLink = withdrawToken ? `${base}/withdraw?t=${encodeURIComponent(withdrawToken)}` : null;
  const where = lead.postcode ? ` covering ${escapeHtml(lead.postcode)}` : ' in your area';

  return `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#0F1012;background:#FBF8F3;padding:28px 24px">

    <div style="font-size:12px;letter-spacing:2px;text-transform:uppercase;color:#8A8A8F">Facet Pro</div>
    <h1 style="font-size:24px;line-height:1.25;margin:12px 0 0;font-weight:600">Your design is saved</h1>
    <p style="font-size:15px;line-height:1.6;color:#3f3f46;margin:14px 0 0">
      Hello ${escapeHtml(lead.name)}, thank you for asking us to get you quotes.
      Your reference is <strong>${escapeHtml(lead.id)}</strong>.
    </p>

    <div style="background:#fff;border-radius:12px;padding:18px 20px;margin:22px 0 0">
      <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:0">
        We don't currently have an installer${where}, so <strong>we haven't passed your
        details to anyone</strong> and nothing has been shared.
      </p>
      <p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:10px 0 0">
        We'll let you know if that changes. Your design and your estimate are saved
        either way, and you're welcome to take them to any installer you like.
      </p>
    </div>

    ${withdrawLink ? `<p style="font-size:14px;line-height:1.6;color:#3f3f46;margin:22px 0 0">
      You can <a href="${escapeHtml(withdrawLink)}" style="color:#0F1012"><strong>ask us to delete your details</strong></a>
      at any time.
    </p>` : ''}

    <p style="font-size:12px;line-height:1.6;color:#6B6E78;margin:26px 0 0;border-top:1px solid #e4e4e7;padding-top:16px">
      You're receiving this because you asked us for quotes at
      <a href="${escapeHtml(base)}/" style="color:#6B6E78">${escapeHtml(base.replace(/^https?:\/\//, ''))}</a>.
      It is not a marketing email and you will not be added to a list. Our
      <a href="${escapeHtml(base)}/privacy" style="color:#6B6E78">privacy notice</a> explains what we do with your details.
    </p>
  </div>`;
}

function noInstallersText(lead, siteUrl, withdrawToken) {
  const base = (safeUrl(siteUrl) || 'https://facetpro.co.uk').replace(/\/$/, '');
  return [
    'Your design is saved',
    '',
    `Hello ${lead.name}, thank you for asking us to get you quotes.`,
    `Your reference is ${lead.id}.`,
    '',
    `We don't currently have an installer${lead.postcode ? ` covering ${lead.postcode}` : ' in your area'}, so we`,
    "haven't passed your details to anyone and nothing has been shared.",
    '',
    "We'll let you know if that changes. Your design and your estimate are saved",
    'either way, and you are welcome to take them to any installer you like.',
    '',
    `Ask us to delete your details at any time: ${withdrawToken ? `${base}/withdraw?t=${encodeURIComponent(withdrawToken)}` : `${base}/privacy`}`,
    '',
    `You asked us for quotes at ${base}/ — this is not a marketing email.`,
  ].join('\n');
}

const noInstallersSubject = (lead) => `Your Facet Pro design — reference ${lead.id}`;

module.exports = {
  leadNotificationHtml,
  designPackHtml,
  designPackText,
  designPackSubject,
  sharingConfirmationHtml,
  sharingConfirmationText,
  sharingConfirmationSubject,
  noInstallersHtml,
  noInstallersText,
  noInstallersSubject,
  escapeHtml,
  safeUrl,
};
