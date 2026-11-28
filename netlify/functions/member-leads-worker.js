// Lead Hunter inside MatchMarket, part 2: runs members' searches.
// Runs every minute (see netlify.toml) and works the oldest queued search, one per run.
// Asks Claude to search the web for real companies that fit, keeps strong fits only,
// saves them for that member, takes 1 credit per lead, and emails the member.
// Only public business contacts from the company's own site or a business directory are kept.
// A search that finds nothing costs the member nothing.
// Needs: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY (email is skipped without it).

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const MODEL = "claude-sonnet-5-5";
const MAX_LEADS = 8;
const MIN_SCORE = 70;
const APP = "https://saisevents.com/market.html";

function h(sk, extra) {
  return { apikey: sk, ...(sk.startsWith("sb_") ? {} : { Authorization: `Bearer ${sk}` }), "Content-Type": "application/json", ...(extra || {}) };
}
async function get(sk, path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: h(sk) });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
async function patch(sk, path, body) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { method: "PATCH", headers: h(sk, { Prefer: "return=minimal" }), body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`patch ${path} ${r.status}`);
}
async function post(sk, table, rows) {
  const r = await fetch(`${SB}/rest/v1/${table}`, { method: "POST", headers: h(sk, { Prefer: "return=minimal" }), body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`insert ${table} ${r.status}: ${await r.text()}`);
}

async function claude(body, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } finally { clearTimeout(t); }
}
const key = (s) => String(s || "").toLowerCase().replace(/\b(ltd|limited|plc|co|company|group|the)\b/g, "").replace(/[^a-z0-9]/g, "");
const clean = (s, n) => (s == null ? null : String(s).trim().slice(0, n) || null);
const site = (s) => { s = clean(s, 200); if (!s) return null; return /^https?:\/\//i.test(s) ? s : "https://" + s; };
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function find(s, me, known, limit) {
  const text = await claude({
    model: MODEL,
    max_tokens: 2000,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    system:
      "You find real companies a business can sell to or buy from. Be strict: a wrong company wastes the member's time. " +
      "Only list a company if its MAIN business matches what the member asked for and it is based in the requested country. " +
      "Only list companies you found in search results that are active. Use only public business contacts shown on the company's own website or a business directory: " +
      "company emails and office or business phone numbers, never personal details. Never guess or invent a phone number, email or website: leave it empty if you did not see it. " +
      "It is fine to return fewer companies, or none. Reply with JSON only.",
    messages: [{
      role: "user",
      content:
        `The member: ${me.name || "a company"}${me.sells ? ", which sells " + me.sells : ""}${me.country ? ", based in " + me.country : ""}.\n` +
        `They want: ${s.query}\nCountry: ${s.country}\n\n` +
        `Search tips: business directories, industry association member lists and company websites in ${s.country}.\n` +
        (known.length ? `Leave out these companies they already have: ${known.slice(0, 80).join("; ")}\n` : "") +
        `\nFind up to ${limit} companies. Reply with JSON only: {"leads":[{"name":"","city":"","country":"","main_business":"","fit_reason":"one short sentence","website":"","email":"","phone":"","source_url":"","score":0}]} ` +
        `where score is 0 to 100 for how well the company fits what the member asked for.`,
    }],
  }, 23000);
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  try { return (JSON.parse(m[0]).leads || []).filter((l) => l && l.name); } catch { return []; }
}

async function emailMember(sk, rk, s, me, rows) {
  if (!rk || !me.owner) return;
  const ur = await fetch(`${SB}/auth/v1/admin/users/${me.owner}`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } });
  if (!ur.ok) return;
  const email = (await ur.json()).email;
  if (!email) return;
  const list = rows.map((l) => `<li style="margin-bottom:10px"><b>${esc(l.name)}</b>${l.city ? ", " + esc(l.city) : ""}<br><span style="color:#46524D">${esc(l.main_business || "")}</span></li>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(me.name)} team,</p>
<p>Thank you for using the SAIS Lead Hunter. Your search is ready.</p>
<p><b>You asked for:</b> ${esc(s.query)}, in ${esc(s.country)}<br><b>Leads found:</b> ${rows.length}</p>
<ol>${list}</ol>
<p>Open MatchMarket to see the website, email and phone for each lead, and to download them: <a href="${APP}">${APP}</a></p>
<p>Warm regards,<br>SAIS Events, MICE, International Trade &amp; Business Events</p></div>`;
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "SAIS MatchMarket <info@saisevents.com>", to: [email], reply_to: "info@saisevents.com", subject: `Your leads are ready: ${s.query}`.slice(0, 140), html }),
  }).catch(() => {});
}

exports.handler = async () => {
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY, ak = process.env.ANTHROPIC_API_KEY, rk = process.env.RESEND_API_KEY;
  if (!sk || !ak) return { statusCode: 200, body: "missing keys" };
  let s;
  try {
    // A search stuck in "running" for 5 minutes failed mid way: release it.
    const stale = new Date(Date.now() - 5 * 60e3).toISOString();
    await patch(sk, `member_lead_searches?status=eq.running&started_at=lt.${stale}`, { status: "failed", note: "Timed out. Nothing was charged.", finished_at: new Date().toISOString() });

    [s] = await get(sk, "member_lead_searches?select=*&status=eq.queued&order=created_at.asc&limit=1");
    if (!s) return { statusCode: 200, body: "nothing queued" };
    await patch(sk, `member_lead_searches?id=eq.${s.id}&status=eq.queued`, { status: "running", started_at: new Date().toISOString() });

    const [me] = await get(sk, `companies?select=id,name,sells,country,owner&id=eq.${s.company_id}`);
    const bal = (await get(sk, `lead_credits?select=amount&company_id=eq.${s.company_id}`)).reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const limit = Math.min(MAX_LEADS, bal);
    if (limit <= 0) {
      await patch(sk, `member_lead_searches?id=eq.${s.id}`, { status: "failed", note: "No leads left. Nothing was charged.", finished_at: new Date().toISOString() });
      return { statusCode: 200, body: "no credits" };
    }
    const known = (await get(sk, `member_leads?select=name&company_id=eq.${s.company_id}&order=created_at.desc&limit=300`)).map((r) => r.name);
    const seen = new Set(known.map(key));
    const out = await find(s, me || {}, known, limit);
    const rows = [];
    for (const l of out) {
      const k = key(l.name);
      if (!k || seen.has(k)) continue;
      if (Math.round(Number(l.score) || 0) < MIN_SCORE) continue;
      if (!(l.website || l.email || l.phone)) continue;
      seen.add(k);
      rows.push({
        search_id: s.id, company_id: s.company_id, name: clean(l.name, 160), city: clean(l.city, 80), country: clean(l.country, 80) || s.country,
        main_business: clean(l.main_business, 300), fit_reason: clean(l.fit_reason, 400),
        website: site(l.website), email: clean(l.email, 120), phone: clean(l.phone, 60), source_url: site(l.source_url),
      });
      if (rows.length >= limit) break;
    }
    if (rows.length) {
      await post(sk, "member_leads", rows);
      await post(sk, "lead_credits", { company_id: s.company_id, amount: -rows.length, reason: "spend", note: `Search: ${s.query}`.slice(0, 200) });
    }
    await patch(sk, `member_lead_searches?id=eq.${s.id}`, {
      status: "done", found: rows.length, finished_at: new Date().toISOString(),
      note: rows.length ? null : "No strong matches this time. Try different words or another country. Nothing was charged.",
    });
    if (rows.length) await emailMember(sk, rk, s, me || {}, rows);
    const msg = `${s.query} | ${s.country}: ${rows.length} leads`;
    console.log(msg);
    return { statusCode: 200, body: msg };
  } catch (e) {
    console.log("member-leads-worker error", e && e.message);
    if (s) await patch(sk, `member_lead_searches?id=eq.${s.id}`, { status: "failed", note: "Search failed. Nothing was charged. Please try again.", finished_at: new Date().toISOString() }).catch(() => {});
    return { statusCode: 200, body: "error" };
  }
};
