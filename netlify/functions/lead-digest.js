// SAIS lead hunter, step 2: the 7am list.
// Every morning at 7am Nairobi time (04:00 UTC, see netlify.toml) this takes the 10 best
// new leads that have not been sent before, writes a tailored opening for each in Kate's
// approved email format, and emails the list to info@saisevents.com.
// Each lead has two buttons: "Email them" opens a ready email, "WhatsApp" opens a ready message.
// Needs: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY. ANTHROPIC_API_KEY is optional (better openings).

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const ADMIN = "info@saisevents.com";
const MODEL = "claude-haiku-5-5";
const PER_DAY = 10;

const EXPOS = {
  "AFROPLAST 2027": {
    when: "taking place in Cairo, Egypt, from 9 to 12 January 2027",
    link: "https://saisevents.com/afroplast-2027.html#register",
    hosting: "three days of hosted programme benefits, including five-star hotel accommodation, local transportation in Cairo and pre-arranged B2B meetings with participating manufacturers and suppliers",
    shortHost: "3 days of five-star hotel accommodation, local transport in Cairo and pre-arranged B2B meetings with machinery, mould and resin suppliers",
    bullets: ["Plastic processing machinery and production lines", "Injection and blow moulding equipment", "Moulds and tooling solutions", "Raw materials, resins and polymers", "New technologies for improving production efficiency"],
  },
};

const GENERIC_BULLETS = ["Machinery and production lines", "Raw materials and inputs", "Equipment, tools and spare parts", "Automation and new technology", "Direct factory suppliers"];
const EAST = ["Kenya", "Uganda", "Tanzania", "Rwanda", "Ethiopia", "Burundi", "South Sudan", "Somalia", "DR Congo"];
const MIDEAST = ["United Arab Emirates", "UAE", "Saudi Arabia", "Qatar", "Oman", "Kuwait", "Bahrain", "Jordan", "Lebanon", "Iraq"];
const region = (c) => (EAST.includes(c) ? "East African" : MIDEAST.includes(c) ? "Middle Eastern" : "African");
const DAYFMT = (d) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const plain = (t) => String(t || "").trim().replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase());

// Email wording for a campaign. Kate's approved AFROPLAST text wins where it exists.
function campaignText(name, camp) {
  if (EXPOS[name]) return EXPOS[name];
  const c = camp || {};
  const place = [c.city, c.country].filter(Boolean).join(", ");
  const dates = c.starts_on ? (c.ends_on && c.ends_on !== c.starts_on ? `from ${DAYFMT(c.starts_on)} to ${DAYFMT(c.ends_on)}` : `on ${DAYFMT(c.starts_on)}`) : "";
  const hb = plain(c.hosted_benefits);
  return {
    when: `taking place${place ? " in " + place : ""}${dates ? ", " + dates : ""}`,
    link: c.register_url || `https://saisevents.com/market.html?expo=${encodeURIComponent(name)}`,
    hosting: hb ? `hosted programme benefits from the organiser, including ${hb}` : "hosted programme benefits from the organiser",
    shortHost: hb || "hosted programme benefits from the organiser",
    bullets: GENERIC_BULLETS,
  };
}

function sbFetch(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", ...(opts.headers || {}) },
  });
}
async function sbGet(path) {
  const r = await sbFetch(path);
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}

async function openings(leads) {
  if (!process.env.ANTHROPIC_API_KEY) return [];
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 18000);
  try {
    const list = leads.map((l, i) => `[${i}] ${l.name} | ${l.country} | makes: ${l.makes || l.sector} | expo: ${l.expo}`).join("\n");
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system: "You write invitation emails for SAIS Events, which recruits hosted buyer delegates for trade expos. Professional, warm, plain English. No dashes of any kind. No emojis. Reply with JSON only.",
        messages: [{ role: "user", content: `For each company write:\n- "q": one curiosity question that opens the email, about what their business could gain if the right suppliers for what they make were all in one place, ready to meet them. Example: "What could your next production upgrade look like if the right machinery manufacturers, mould specialists and resin suppliers were all in one place, ready to meet you?"\n- "given": finishes the sentence "Given ..." with one short line on their business, e.g. "your established presence in Kenya's plastics manufacturing sector and your injection and blow moulding operations"\n- "bullets": 5 short supplier categories most useful to them at the expo\n\n${list}\n\nReply with JSON only: {"items":[{"i":0,"q":"","given":"","bullets":["","","","",""]}]}` }],
      }),
    });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    const j = await r.json();
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]).items || [] : [];
  } catch (e) {
    console.log("openings failed, using default text:", e.message);
    return [];
  } finally {
    clearTimeout(t);
  }
}

const noDash = (s) => String(s || "").replace(/\s*[–—]\s*/g, ", ");
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const firstEmail = (s) => (String(s || "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i) || [""])[0];
function waNumber(phone, country) {
  let d = String(phone || "").split(/[,/;]/)[0].replace(/[^\d+]/g, "");
  if (!d) return "";
  const cc = { Kenya: "254", Uganda: "256", Tanzania: "255", Ethiopia: "251", Rwanda: "250", "South Africa": "27", Egypt: "20", "United Arab Emirates": "971", "Saudi Arabia": "966" }[country] || "";
  if (d.startsWith("+")) return d.slice(1);
  if (d.startsWith("00")) return d.slice(2);
  if (d.startsWith("0") && cc) return cc + d.slice(1);
  if (cc && d.length <= 9) return cc + d;
  return d;
}

function emailText(l, x, ai) {
  const q = noDash(ai.q) || "What could your next production upgrade look like if the right manufacturers and suppliers for your business were all in one place, ready to meet you?";
  const given = noDash(ai.given) || `your work in ${l.country}'s manufacturing sector`;
  const bullets = (ai.bullets && ai.bullets.length ? ai.bullets : x.bullets).slice(0, 6).map((b) => "• " + noDash(b)).join("\n");
  const subject = `${l.name}: shortlisted for the ${l.expo} Hosted Buyer Programme`;
  const body = `Dear ${l.name} Team,

${q}

That's the opportunity we would like to bring to ${l.name}.

SAIS Events is currently selecting a limited number of ${region(l.country)} companies for the ${l.expo} Hosted Buyer Programme, ${x.when}.

${l.name} has been shortlisted for consideration.

Given ${given}, we believe this programme could offer valuable opportunities to connect directly with international suppliers of:

${bullets}

Selected hosted buyers will receive ${x.hosting}.

This is an opportunity to explore new technologies, compare supplier solutions, establish direct factory relationships and identify potential ways to strengthen your production capabilities.

We are finalising our ${region(l.country)} shortlist, and hosted buyer places are limited. Registration is free, subject to qualification and final approval.

Register your interest here:
${x.link}

Could we arrange a brief 10-minute call this week? I'd be happy to introduce the programme, explain the selection process and discuss how ${l.name} could benefit.

Kind regards,`;
  return { subject, body };
}

function waText(l, x, ai) {
  const q = noDash(ai.q) || "What could your business gain if the right suppliers were all in one place, ready to meet you?";
  return `Good day, ${l.name} team.

${q}

SAIS Events is selecting a limited number of ${region(l.country)} companies for the ${l.expo} Hosted Buyer Programme, ${x.when.replace("taking place ", "")}. ${l.name} has been shortlisted. Your invitation card is above.

Selected hosted buyers get ${x.shortHost}.

Hosted places are limited. Registration is free, subject to approval:
${x.link}

Could we arrange a brief 10 minute call this week?

Kate, SAIS Events`;
}

exports.handler = async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    // Up to 10 leads a day, shared fairly between campaigns (best score first within each)
    const pool = await sbGet("leads?select=*&status=eq.new&digest_sent_at=is.null&order=score.desc.nullslast,created_at.asc&limit=200");
    if (!pool.length) return { statusCode: 200, body: "no new leads" };
    const queues = new Map();
    pool.forEach((l) => { if (!queues.has(l.expo)) queues.set(l.expo, []); queues.get(l.expo).push(l); });
    const picked = [];
    while (picked.length < PER_DAY && [...queues.values()].some((q) => q.length)) for (const q of queues.values()) if (q.length && picked.length < PER_DAY) picked.push(q.shift());
    const leads = picked.sort((a, b) => String(a.expo).localeCompare(String(b.expo)) || (b.score || 0) - (a.score || 0));
    const camps = await sbGet("campaigns?select=name,city,country,starts_on,ends_on,hosted_benefits,register_url").catch(() => []);
    const campBy = new Map(camps.map((c) => [c.name, c]));
    const ai = await openings(leads);
    const byI = new Map(ai.map((a) => [Number(a.i), a]));
    const left = pool.length - leads.length;

    const blocks = leads.map((l, i) => {
      const x = campaignText(l.expo, campBy.get(l.expo));
      const a = byI.get(i) || {};
      const em = emailText(l, x, a);
      const to = firstEmail(l.email);
      const wa = waNumber(l.phone, l.country);
      const mail = to ? `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}&su=${encodeURIComponent(em.subject)}&body=${encodeURIComponent(em.body)}` : "";
      const whats = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(waText(l, x, a))}` : "";
      const btn = (href, label, bg) => `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:bold;padding:10px 16px;border-radius:8px;margin:6px 6px 0 0">${label}</a>`;
      const head = i === 0 || leads[i - 1].expo !== l.expo ? `<h3 style="margin:22px 0 10px;color:#8a6a12;font-size:14px;letter-spacing:1px;text-transform:uppercase">${esc(l.expo)}</h3>` : "";
      return head + `<div style="border:1px solid #e3ddd2;border-radius:12px;padding:16px;margin:0 0 14px">
<div style="font-size:12px;color:#8a7a5c;font-weight:bold">#${i + 1} &nbsp; SCORE ${l.score ?? "?"} &nbsp; ${esc(l.country)}${l.city ? ", " + esc(l.city) : ""}</div>
<div style="font-size:18px;font-weight:bold;margin:4px 0">${esc(l.name)}</div>
<div style="color:#444">${esc(l.makes || l.sector)}</div>
<div style="color:#1d6b3a;margin:6px 0">${esc(l.fit_reason || "")}</div>
<div style="font-size:14px;color:#333">${l.phone ? "Phone: " + esc(l.phone) + "<br>" : ""}${l.email ? "Email: " + esc(l.email) + "<br>" : ""}${l.website ? `Website: <a href="${esc(l.website)}">${esc(l.website.replace(/^https?:\/\//, ""))}</a>` : ""}</div>
${whats ? btn(whats, "WhatsApp them", "#1FA855") : ""}${mail ? btn(mail, "Email them", "#B8955F") : ""}
</div>`;
    });

    const date = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Africa/Nairobi" });
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;max-width:640px;margin:auto;color:#1a1714">
<h2 style="margin:0 0 4px">Your ${leads.length} calls for today</h2>
<p style="margin:0 0 16px;color:#666">${date}. Best first. Tap WhatsApp or Email to open a ready message. Send the invitation card first on WhatsApp.</p>
${blocks.join("\n")}
<p style="color:#666;font-size:13px">After each call, move the company to its new stage in the campaign pipeline on MatchMarket. ${left > 0 ? left + (left === 1 ? " more new lead is" : " more new leads are") + " waiting for the next mornings." : ""}</p>
</div>`;

    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "SAIS Events <info@saisevents.com>", to: [ADMIN], subject: `Today's ${leads.length} delegate calls: ${[...new Set(leads.map((l) => l.expo))].join(", ")}`, html }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);

    const ids = leads.map((l) => l.id).join(",");
    const p = await sbFetch(`leads?id=in.(${ids})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ digest_sent_at: new Date().toISOString() }) });
    if (!p.ok) throw new Error(`Supabase patch ${p.status}: ${await p.text()}`);
    return { statusCode: 200, body: `sent ${leads.length} leads` };
  } catch (e) {
    console.log("lead-digest error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
