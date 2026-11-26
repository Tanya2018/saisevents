// SAIS registration scorer. Runs every 30 minutes (see netlify.toml).
// 1. Scores every MatchMarket company profile out of 100 whenever it is new or has changed:
//    all fields filled, a clear description, a website that opens, a WhatsApp ready mobile number,
//    the contact person, trade figures, expos and expo categories, and the company profile document.
//    Grade A is 80 or more (ready to send to an organiser), B is 60 to 79, C is below 60.
// 2. Reminds companies that still have gaps: once 3 days after they registered and once after 7 days,
//    listing exactly what is missing. Only companies that registered from 26 Nov 2026 get reminders.
// No AI is used, so it costs nothing to run. Results go into the company_scores table.
// Needs: SUPABASE_SERVICE_ROLE_KEY. Optional: RESEND_API_KEY for the reminders.

const crypto = require("crypto");
const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const FROM = "SAIS Events <info@saisevents.com>";
const ADMIN = "info@saisevents.com";
const PER_RUN = 8;
const NUDGE_FROM = "2026-11-26";
const SOCIAL = /(facebook\.com|fb\.com|instagram\.com|linkedin\.com|tiktok\.com|x\.com|twitter\.com|wa\.me|whatsapp\.com|youtube\.com)/i;

const MOBILE = {
  Kenya: ["254", /^(7|1)\d{8}$/], Uganda: ["256", /^7\d{8}$/], Tanzania: ["255", /^(6|7)\d{8}$/], Rwanda: ["250", /^7\d{8}$/],
  Ethiopia: ["251", /^(9|7)\d{8}$/], Burundi: ["257", /^(6|7)\d{7}$/], "South Sudan": ["211", /^9\d{8}$/], Somalia: ["252", /^6\d{8}$/],
  "DR Congo": ["243", /^(8|9)\d{8}$/], Egypt: ["20", /^1\d{9}$/], Nigeria: ["234", /^(7|8|9)\d{9}$/], Ghana: ["233", /^(2|5)\d{8}$/],
  "South Africa": ["27", /^(6|7|8)\d{8}$/], "United Arab Emirates": ["971", /^5\d{8}$/], UAE: ["971", /^5\d{8}$/],
  "Saudi Arabia": ["966", /^5\d{8}$/], Oman: ["968", /^(7|9)\d{7}$/], Qatar: ["974", /^(3|5|6|7)\d{7}$/],
};
function whatsappOk(raw, country) {
  let d = String(raw || "").replace(/[^\d+]/g, "");
  if (!d) return false;
  if (d.startsWith("+")) d = d.slice(1); else if (d.startsWith("00")) d = d.slice(2);
  const rule = MOBILE[country];
  if (!rule) return d.length >= 9 && d.length <= 15;
  const [cc, re] = rule;
  return re.test(d.startsWith(cc) ? d.slice(cc.length) : d.replace(/^0/, ""));
}

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const txt = (v) => String(v == null ? "" : v).trim();
const has = (v) => txt(v).length > 0;

function sbFetch(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SB}${path}`, { ...opts, headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", ...(opts.headers || {}) } });
}
async function sbGet(path) {
  const r = await sbFetch(`/rest/v1/${path}`);
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}
async function sbUpsert(table, rows) {
  const r = await sbFetch(`/rest/v1/${table}`, { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`Supabase upsert ${r.status}: ${await r.text()}`);
}
async function ownerEmail(id) {
  const r = await sbFetch(`/auth/v1/admin/users/${id}`);
  if (!r.ok) return "";
  const j = await r.json();
  return txt(j.email || (j.user && j.user.email));
}

// Does the website open? Social pages are not fetched (they block robots) and count as a page, not a website.
async function siteCheck(url) {
  const u = txt(url);
  if (!/[.\/]/.test(u)) return "none";
  if (SOCIAL.test(u)) return "social";
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(/^https?:\/\//i.test(u) ? u : "https://" + u, { redirect: "follow", signal: ctl.signal, headers: { "User-Agent": "Mozilla/5.0 (SAIS MatchMarket profile check)" } });
    return r.status < 500 && r.status !== 404 && r.status !== 410 ? "works" : "broken";
  } catch (e) {
    return "broken";
  } finally {
    clearTimeout(t);
  }
}

// Each check: [points, earned, what to tell the company if it is missing]
function score(c, pv, site) {
  // The description can be in "About" (newer profiles) or a long "What we sell" (older profiles).
  const about = [txt(c.about), txt(c.sells)].sort((a, b) => b.length - a.length)[0], wa = c._whatsapp;
  const det = c.expo_details || {}, expos = c.expos || [];
  const items = [
    ["Company basics", 10, [c.name, c.role, c.city, c.country].filter(has).length * 2.5, "your company name, type, city and country"],
    ["Description", 15, about.length >= 120 ? 15 : about.length >= 40 ? 7 : 0, "a full company description (at least 2 or 3 sentences)"],
    ["Products and needs", 10, (has(c.sells) ? 5 : 0) + (has(c.wants) ? 5 : 0), "what you sell and what you want to buy"],
    ["Markets and deal size", 5, (has(c.markets) ? 3 : 0) + (has(c.deal_size) ? 2 : 0), "your target markets and usual deal size"],
    ["Website", 15, site === "works" ? 15 : site === "social" ? 10 : 0, site === "broken" ? "a website link that opens (yours did not open when we checked)" : site === "social" ? "your company website, if you have one" : "your website or social media page"],
    ["WhatsApp", 15, whatsappOk(wa, c.country) ? 15 : has(wa) ? 5 : 0, has(wa) ? "a WhatsApp mobile number in full, with the country code" : "your WhatsApp number"],
    ["Contact person", 10, [pv.surname, pv.first_name, pv.job_title].filter(has).length * (10 / 3), "the contact person's names and job title"],
    ["Year established", 3, has(c.established) ? 3 : 0, "the year your company was established"],
    ["Trade figures 2025", 7, (has(pv.turnover_2025) ? 3 : 0) + (has(pv.imports_2025) ? 2 : 0) + (has(pv.imported_from) || has(pv.imported_products) ? 2 : 0), "your 2025 turnover and imports"],
    ["Expos and categories", 5, expos.length ? (expos.some((n) => det[n]) ? 5 : 3) : 0, expos.length ? "your categories for each expo you ticked" : "the expos you want to attend"],
    ["Company profile document", 5, has(c.profile_file) ? 5 : 0, "your company profile document (PDF or Word)"],
  ];
  const total = Math.round(items.reduce((s, i) => s + i[2], 0));
  const gaps = items.filter((i) => i[2] < i[1] - 0.01).map((i) => i[3]);
  const checks = Object.fromEntries(items.map((i) => [i[0], `${Math.round(i[2])}/${i[1]}`]));
  checks.website_status = site;
  return { score: total, grade: total >= 80 ? "A" : total >= 60 ? "B" : "C", gaps, checks };
}

async function nudge(c, s, email) {
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(c.name || "MatchMarket member")} Team,</p>
<p>Thank you for being part of SAIS MatchMarket. We appreciate the work you put into growing your business.</p>
<p>Your company profile scores <b>${s.score} out of 100</b>. Organisers approve hosted buyers and book B2B meetings from these details, so a complete profile gets you more invitations.</p>
<p><b>Please add:</b></p>
<ul>${s.gaps.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>
<p><a href="https://saisevents.com/market.html#profile" style="display:inline-block;background:#04211A;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Complete my profile</a></p>
<p>Log in, open <b>My company</b>, update your details and press Save. It takes about 5 minutes.</p>
<p>Warm regards,<br>SAIS Events, MICE, International Trade &amp; Business Events<br><a href="https://saisevents.com">saisevents.com</a></p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], reply_to: ADMIN, subject: `Your MatchMarket profile scores ${s.score}/100: a few details to add`, html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

exports._score = score;
exports.handler = async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 200, body: "missing keys" };
  const out = [];
  try {
    const [cos, privs, scores] = await Promise.all([
      sbGet("companies?select=id,owner,name,role,city,country,about,sells,wants,markets,deal_size,website,whatsapp,established,expos,expo_details,profile_file,status,created_at"),
      sbGet("company_private?select=company_id,whatsapp,details"),
      sbGet("company_scores?select=company_id,sig,score,grade,gaps,nudges,nudged_at"),
    ]);
    const pmap = new Map(privs.map((p) => [p.company_id, p]));
    const smap = new Map(scores.map((s) => [s.company_id, s]));

    // 1. Score new or changed profiles.
    const todo = [];
    for (const c of cos) {
      const p = pmap.get(c.id) || {};
      c._whatsapp = p.whatsapp || c.whatsapp;
      c._pv = p.details || {};
      const sig = crypto.createHash("md5").update(JSON.stringify([c, c._pv])).digest("hex");
      const prev = smap.get(c.id);
      if (!prev || prev.sig !== sig) todo.push([c, sig, prev]);
    }
    const batch = todo.slice(0, PER_RUN);
    const rows = await Promise.all(batch.map(async ([c, sig, prev]) => {
      const s = score(c, c._pv, await siteCheck(c.website));
      smap.set(c.id, { ...(prev || { nudges: 0 }), ...s, company_id: c.id });
      out.push(`${c.name}: ${s.score} ${s.grade}`);
      return { company_id: c.id, score: s.score, grade: s.grade, gaps: s.gaps, checks: s.checks, sig, checked_at: new Date().toISOString() };
    }));
    if (rows.length) await sbUpsert("company_scores", rows);

    // 2. Remind new companies that still have gaps (day 3, then day 7).
    if (process.env.RESEND_API_KEY) {
      let sent = 0;
      for (const c of cos) {
        if (sent >= 10) break;
        const s = smap.get(c.id);
        if (!s || !s.gaps || !s.gaps.length || s.grade === "A" || c.status === "declined" || c.role === "Organiser") continue;
        if (String(c.created_at).slice(0, 10) < NUDGE_FROM) continue;
        const age = (Date.now() - new Date(c.created_at).getTime()) / 864e5;
        const n = s.nudges || 0;
        if (!((n === 0 && age >= 3) || (n === 1 && age >= 7))) continue;
        const email = await ownerEmail(c.owner);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
        try {
          await nudge(c, s, email);
          await sbUpsert("company_scores", [{ company_id: c.id, nudges: n + 1, nudged_at: new Date().toISOString() }]);
          sent++;
          out.push(`reminded ${c.name}`);
        } catch (e) {
          out.push(`reminder failed ${c.name}: ${e.message}`);
        }
      }
    }
    console.log(out.join(" | ") || "nothing to do");
    return { statusCode: 200, body: out.join("\n") || "nothing to do" };
  } catch (e) {
    console.log("reg-scorer error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
