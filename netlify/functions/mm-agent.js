// SAIS MatchMarket AI agent. Runs every 15 minutes (see netlify.toml).
// Each run does ONE job so it finishes inside Netlify's 30 second limit:
//   1. Vet the oldest pending company that has not been checked yet (writes a note for the admin).
//   2. Otherwise, find matches for one approved company (writes rows into "matches").
// It never approves or declines anyone. Kate makes that decision in the admin panel.
// Needs: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY. Optional: RESEND_API_KEY for an email alert.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const ADMIN = "info@saisevents.com";
const VET_MODEL = "claude-sonnet-5-5";
const MATCH_MODEL = "claude-haiku-5-5";
const REMATCH_DAYS = 7;

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
async function sbUpsert(table, rows, conflict) {
  const r = await sbFetch(`${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Supabase upsert ${table} ${r.status}: ${await r.text()}`);
}

async function claude(body, ms) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`Claude ${r.status}: ${await r.text()}`);
    const j = await r.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } finally {
    clearTimeout(t);
  }
}
function parseJSON(text) {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("No JSON in reply: " + text.slice(0, 200));
  return JSON.parse(m[0]);
}
const card = (c) =>
  [`Name: ${c.name}`, `Type: ${c.role}`, `Location: ${[c.city, c.country].filter(Boolean).join(", ")}`, `Sells or offers: ${c.sells || ""}`,
   `Wants: ${c.wants || ""}`, `Target markets: ${c.markets || ""}`, `Deal size: ${c.deal_size || ""}`, `Website: ${c.website || "none"}`,
   `Expos: ${(c.expos || []).join(", ") || "none"}`, `Open to joint ventures: ${c.jv_open ? "yes" : "no"}`].join("\n");

async function vet(c) {
  const req = {
    model: VET_MODEL,
    max_tokens: 900,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    system: "You vet companies that apply to join SAIS MatchMarket, a B2B platform that matches importers, exporters, manufacturers, suppliers, buyers and expo organisers across Africa and the Middle East. Check whether the company looks real and active using its website or social page and a quick web search. Be fair to small businesses: a working social media page is acceptable. Reply with JSON only.",
    messages: [{ role: "user", content: `Vet this company.\n\n${card(c)}\n\nReply with JSON only: {"score": 0-100 (how confident you are it is a genuine, active business that fits the platform), "verdict": "approve" | "review" | "decline", "note": "2 to 3 plain sentences for the admin: what you found, any red flags, and what to check"}` }],
  };
  let text;
  try { text = await claude(req, 17000); }
  catch (e) { console.log("vet with web search failed, retrying without:", e.message); delete req.tools; text = await claude(req, 9000); }
  const v = parseJSON(text);
  const score = Math.max(0, Math.min(100, Math.round(Number(v.score) || 0)));
  const verdict = ["approve", "review", "decline"].includes(v.verdict) ? v.verdict : "review";
  await sbUpsert("company_reviews", [{ company_id: c.id, score, verdict, note: String(v.note || "").slice(0, 1200), checked_at: new Date().toISOString() }], "company_id");
  const rk = process.env.RESEND_API_KEY;
  if (rk) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "SAIS Events <info@saisevents.com>", to: [ADMIN],
        subject: `AI vetting: ${c.name} (${verdict}, ${score}%)`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p><b>${c.name}</b>, ${c.role}, ${[c.city, c.country].filter(Boolean).join(", ")}</p><p>Agent recommends: <b>${verdict}</b> (${score}%)</p><p>${String(v.note || "").replace(/</g, "&lt;")}</p><p>Approve or decline in the admin panel: <a href="https://saisevents.com/market.html#admin">saisevents.com/market.html#admin</a></p></div>`,
      }),
    }).catch(() => {});
  }
  return `vetted ${c.name}: ${verdict} ${score}`;
}

async function match(c, others) {
  if (!others.length) {
    await sbUpsert("company_reviews", [{ company_id: c.id, matched_at: new Date().toISOString() }], "company_id");
    return `no candidates for ${c.name}`;
  }
  const list = others.slice(0, 150).map((o, i) => `[${i}] ${o.name} | ${o.role} | ${[o.city, o.country].filter(Boolean).join(", ")} | sells: ${(o.sells || "").slice(0, 160)} | wants: ${(o.wants || "").slice(0, 160)} | expos: ${(o.expos || []).join(", ")}`).join("\n");
  const text = await claude({
    model: MATCH_MODEL,
    max_tokens: 1500,
    system: "You are the matchmaker for SAIS MatchMarket. You find real business fits: one side sells what the other wants, they share an expo, a supplier and a buyer in the same sector, or a good joint venture. Do not match on location alone. Reply with JSON only.",
    messages: [{ role: "user", content: `Find the best partners for this company.\n\n${card(c)}\n\nCandidates:\n${list}\n\nReply with JSON only: {"matches": [{"i": candidate number, "score": 50-100, "reason": "one sentence to ${c.name} on why they should meet", "reason_back": "one sentence to the candidate on why they should meet ${c.name}"}]}. Up to 6 matches, best first. Only include real fits with score 60 or more. An empty list is fine.` }],
  }, 26000);
  const out = parseJSON(text).matches || [];
  const rows = [];
  for (const m of out) {
    const o = others[Number(m.i)];
    const score = Math.max(0, Math.min(100, Math.round(Number(m.score) || 0)));
    if (!o || score < 60) continue;
    rows.push({ for_company: c.id, match_company: o.id, score, reason: String(m.reason || "Good fit").slice(0, 400) });
    rows.push({ for_company: o.id, match_company: c.id, score, reason: String(m.reason_back || m.reason || "Good fit").slice(0, 400) });
  }
  if (rows.length) await sbUpsert("matches", rows, "for_company,match_company");
  await sbUpsert("company_reviews", [{ company_id: c.id, matched_at: new Date().toISOString() }], "company_id");
  return `matched ${c.name}: ${rows.length / 2}`;
}

exports.handler = async () => {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    const [cos, reviews] = await Promise.all([
      sbGet("companies?select=id,name,role,city,country,sells,wants,markets,deal_size,website,expos,jv_open,status,created_at&status=neq.declined&order=created_at.asc"),
      sbGet("company_reviews?select=company_id,checked_at,matched_at"),
    ]);
    const rev = new Map(reviews.map((r) => [r.company_id, r]));
    const pending = cos.find((c) => c.status === "pending" && !(rev.get(c.id) || {}).checked_at);
    if (pending) { const msg = await vet(pending); console.log(msg); return { statusCode: 200, body: msg }; }
    const approved = cos.filter((c) => c.status === "approved");
    const stale = Date.now() - REMATCH_DAYS * 864e5;
    const due = approved.find((c) => { const m = (rev.get(c.id) || {}).matched_at; return !m || new Date(m).getTime() < stale; });
    if (due) { const msg = await match(due, approved.filter((o) => o.id !== due.id)); console.log(msg); return { statusCode: 200, body: msg }; }
    return { statusCode: 200, body: "nothing to do" };
  } catch (e) {
    console.log("mm-agent error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
