// SAIS MatchMarket AI agent. Runs every 15 minutes (see netlify.toml).
// Each run does ONE job so it finishes inside Netlify's 30 second limit:
//   1. Vet the oldest pending company that has not been checked yet (writes a note for the admin).
//      Every vetting first runs free website checks (site reachable, domain age, parked or scam wording,
//      free hosting, phone prefix vs country, shared website or phone) and gives the facts to Claude,
//      which searches for scam reports and checks the site matches the business. Result: low, medium or high risk.
//   1b. Then re-checks approved companies that never had the website checks (one per run).
//   2. Otherwise, find matches for one approved company (writes rows into "matches").
// It never approves or declines anyone. Kate makes that decision in the admin panel.
// Needs: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY. Optional: RESEND_API_KEY for an email alert.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const ADMIN = "info@saisevents.com";
const VET_MODEL = "claude-sonnet-5-5";
const MATCH_MODEL = "claude-haiku-5-5";
const REMATCH_DAYS = 7;
const DIAL = { kenya: "254", uganda: "256", tanzania: "255", rwanda: "250", burundi: "257", ethiopia: "251", "south sudan": "211", somalia: "252", "dr congo": "243", nigeria: "234", ghana: "233", "south africa": "27", zambia: "260", malawi: "265", zimbabwe: "263", egypt: "20", morocco: "212", "united arab emirates": "971", uae: "971", "saudi arabia": "966", qatar: "974", oman: "968", kuwait: "965", bahrain: "973", turkey: "90", "türkiye": "90", china: "86", "hong kong": "852", india: "91", pakistan: "92", "united kingdom": "44", "united states": "1", germany: "49", italy: "39", france: "33" };
const FREE_HOSTS = /(wixsite\.com|blogspot\.|weebly\.com|sites\.google\.com|netlify\.app|vercel\.app|github\.io|wordpress\.com|godaddysites\.com|business\.site|carrd\.co|linktr\.ee)/i;
const SOCIAL = /(facebook\.com|instagram\.com|linkedin\.com|tiktok\.com|x\.com|twitter\.com|wa\.me|whatsapp\.com)/i;
const BAD_WORDS = [
  [/lorem ipsum/i, "placeholder text (lorem ipsum)"], [/domain (is )?for sale|buy this domain|parked free/i, "parked or for-sale domain"],
  [/coming soon|under construction/i, "site says coming soon or under construction"],
  [/western union|moneygram|gift card|advance fee|processing fee before|guaranteed (profit|returns)|double your/i, "scam payment or profit wording"],
  [/bitcoin|usdt|crypto ?wallet|forex signals|investment plan/i, "crypto or investment wording on a trade site"],
];

const host = (u) => { try { return new URL(/^https?:\/\//i.test(u) ? u : "https://" + u).hostname.replace(/^www\./, "").toLowerCase(); } catch (e) { return ""; } };
// Registered domain: shop.example.co.ke -> example.co.ke, www.example.com -> example.com
const regDomain = (h) => { const p = h.split("."); return p.length > 2 && /^(co|com|org|net|ac|go|or|ne|gov|edu)$/.test(p[p.length - 2]) ? p.slice(-3).join(".") : p.slice(-2).join("."); };
async function timed(url, ms, opts = {}) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal, redirect: "follow" }); } finally { clearTimeout(t); }
}
// Free checks, no API cost. Returns { facts: [...], flags: [...] }
async function siteChecks(c, all, phones) {
  const facts = [], flags = [];
  const site = String(c.website || "").trim();
  const h = host(site);
  if (!site) flags.push("no website or social page given");
  else if (SOCIAL.test(h)) facts.push("uses a social media page instead of a website");
  else if (FREE_HOSTS.test(h)) flags.push("website on a free host (" + h + ")");
  const jobs = [];
  if (site && !SOCIAL.test(h)) {
    jobs.push(timed(/^https?:/i.test(site) ? site : "https://" + site, 6000, { headers: { "User-Agent": "Mozilla/5.0 (SAIS MatchMarket vetting)" } }).then(async (r) => {
      const finalHost = host(r.url || site);
      facts.push(`website answered ${r.status}${finalHost && finalHost !== h ? ", redirects to " + finalHost : ""}`);
      if (!r.ok) flags.push("website does not load (status " + r.status + ")");
      if (finalHost && finalHost !== h && !finalHost.endsWith(h) && !h.endsWith(finalHost)) flags.push("website redirects to a different domain: " + finalHost);
      const html = (await r.text()).slice(0, 300000);
      const title = (html.match(/<title[^>]*>([^<]{0,140})/i) || [])[1] || "";
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      facts.push(`page title: "${title.trim()}"`, `page text sample: "${text.slice(0, 700)}"`);
      if (text.length < 200) flags.push("website has almost no text");
      for (const [re, why] of BAD_WORDS) if (re.test(text)) flags.push(why);
      const nameWord = String(c.name || "").toLowerCase().split(/\s+/).find((w) => w.length > 3) || "";
      if (nameWord && !text.toLowerCase().includes(nameWord) && !title.toLowerCase().includes(nameWord) && !h.includes(nameWord)) flags.push("company name not found on its own website");
    }).catch((e) => { flags.push("website could not be reached"); }));
    jobs.push(timed("https://rdap.org/domain/" + regDomain(h), 5000).then(async (r) => {
      if (!r.ok) return;
      const j = await r.json();
      const reg = (j.events || []).find((e) => e.eventAction === "registration");
      if (reg && reg.eventDate) {
        const days = Math.round((Date.now() - new Date(reg.eventDate).getTime()) / 864e5);
        facts.push(`domain registered ${reg.eventDate.slice(0, 10)} (${days} days ago)`);
        if (days < 180) flags.push(`domain is new, only ${days} days old`);
      }
    }).catch(() => {}));
  }
  await Promise.all(jobs);
  const wa = String(phones.get(c.id) || "").replace(/[^\d+]/g, "");
  const want = DIAL[String(c.country || "").toLowerCase()];
  if (wa && want && wa.startsWith("+") && !wa.startsWith("+" + want)) flags.push(`phone prefix does not match ${c.country} (+${want})`);
  if (h && !SOCIAL.test(h)) { const twin = all.find((o) => o.id !== c.id && host(o.website || "") === h); if (twin) flags.push("same website as another company: " + twin.name); }
  if (wa) { for (const [id, p] of phones) if (id !== c.id && String(p).replace(/[^\d+]/g, "") === wa) { const o = all.find((x) => x.id === id); flags.push("same phone as another company: " + (o ? o.name : "unknown")); break; } }
  return { facts, flags };
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

async function vet(c, all, phones) {
  const chk = await siteChecks(c, all, phones);
  const req = {
    model: VET_MODEL,
    max_tokens: 900,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
    system: "You vet companies that apply to join SAIS MatchMarket, a B2B platform that matches importers, exporters, manufacturers, suppliers, buyers and expo organisers across Africa and the Middle East. Check whether the company looks real and active using its website or social page and a quick web search. Be fair to small businesses: a working social media page is acceptable. You are also the scam check: search the company name with words like scam, fraud or complaint, check the website content matches the business it claims, look for copied text or stolen photos, and check whether it is registered or listed in a real directory. Treat the automatic check results as facts. Reply with JSON only.",
    messages: [{ role: "user", content: `Vet this company.\n\n${card(c)}\n\nAutomatic website checks:\n${chk.facts.map((f) => "- " + f).join("\n") || "- none"}\nRed flags found automatically:\n${chk.flags.map((f) => "- " + f).join("\n") || "- none"}\n\nReply with JSON only: {"score": 0-100 (how confident you are it is a genuine, active business that fits the platform), "verdict": "approve" | "review" | "decline", "risk": "low" | "medium" | "high" (scam or fake risk), "flags": ["short red flags you found, empty if none"], "note": "2 to 3 plain sentences for the admin: what you found, any red flags, and what to check"}` }],
  };
  let text;
  try { text = await claude(req, 15000); }
  catch (e) { console.log("vet with web search failed, retrying without:", e.message); delete req.tools; text = await claude(req, 7000); }
  const v = parseJSON(text);
  const score = Math.max(0, Math.min(100, Math.round(Number(v.score) || 0)));
  let verdict = ["approve", "review", "decline"].includes(v.verdict) ? v.verdict : "review";
  const flags = [...new Set([...chk.flags, ...(Array.isArray(v.flags) ? v.flags : [])].map((f) => String(f).slice(0, 160)).filter(Boolean))].slice(0, 12);
  let risk = ["low", "medium", "high"].includes(v.risk) ? v.risk : (chk.flags.length >= 3 ? "high" : chk.flags.length ? "medium" : "low");
  if (chk.flags.some((f) => /scam|parked|crypto|same website|same phone/i.test(f)) && risk === "low") risk = "medium";
  if (risk === "high" && verdict === "approve") verdict = "review";
  const now = new Date().toISOString();
  await sbUpsert("company_reviews", [{ company_id: c.id, score, verdict, risk, flags, note: String(v.note || "").slice(0, 1200), checked_at: now, site_checked_at: now }], "company_id");
  const rk = process.env.RESEND_API_KEY;
  if (rk && (c.status === "pending" || risk !== "low")) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: "SAIS Events <info@saisevents.com>", to: [ADMIN],
        subject: `${risk === "high" ? "SCAM RISK: " : "AI vetting: "}${c.name} (${verdict}, ${score}%, ${risk} risk)`,
        html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p><b>${c.name}</b>, ${c.role}, ${[c.city, c.country].filter(Boolean).join(", ")}</p><p>Agent recommends: <b>${verdict}</b> (${score}%). Scam risk: <b>${risk}</b></p>${flags.length ? "<p>Red flags:<br>" + flags.map((f) => "&bull; " + String(f).replace(/</g, "&lt;")).join("<br>") + "</p>" : ""}<p>${String(v.note || "").replace(/</g, "&lt;")}</p><p>Approve or decline in the admin panel: <a href="https://saisevents.com/market.html#admin">saisevents.com/market.html#admin</a></p></div>`,
      }),
    }).catch(() => {});
  }
  return `vetted ${c.name}: ${verdict} ${score}, ${risk} risk, ${flags.length} flags`;
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

// Step 4b: score one registered delegate application against the organiser's buyer criteria.
// The score is advice for SAIS. A person decides who is sent to the organiser.
async function precheck(a) {
  const b = a.businesses || {}, c = a.campaigns || {};
  const answers = Object.entries(a.checklist || {}).map(([k, v]) => `${k}: ${v}`).join("\n");
  const text = await claude({
    model: MATCH_MODEL,
    max_tokens: 500,
    system: "You check whether a company qualifies as a hosted buyer delegate for a trade expo, using only the organiser's criteria and the company's own answers. Be fair to small businesses. Never invent facts. Reply with JSON only.",
    messages: [{ role: "user", content: `Expo: ${c.name}\nOrganiser's buyer criteria: ${c.buyer_criteria}\n\nCompany: ${b.name}\nLocation: ${[b.city, b.country].filter(Boolean).join(", ")}\nActivities: ${b.sector || ""}\nMakes or sells: ${b.makes || ""}\nWebsite: ${b.website || "none"}\nRegistration answers:\n${answers || "none"}\n\nReply with JSON only: {"score": 0-100 (how well it fits the criteria), "reasons": "2 short plain sentences: why it fits or not, and what SAIS should confirm before sending it to the organiser"}` }],
  }, 20000);
  const v = parseJSON(text);
  const score = Math.max(0, Math.min(100, Math.round(Number(v.score) || 0)));
  const r = await sbFetch(`applications?id=eq.${a.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ai_score: score, ai_reasons: String(v.reasons || "").slice(0, 600), ai_checked_at: new Date().toISOString() }) });
  if (!r.ok) throw new Error(`Supabase patch applications ${r.status}: ${await r.text()}`);
  return `prechecked ${b.name} for ${c.name}: ${score}`;
}

exports.handler = async () => {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    const [cos, reviews, priv] = await Promise.all([
      sbGet("companies?select=id,name,role,city,country,sells,wants,markets,deal_size,website,expos,jv_open,status,created_at&status=neq.declined&order=created_at.asc"),
      sbGet("company_reviews?select=company_id,checked_at,matched_at,site_checked_at"),
      sbGet("company_private?select=company_id,whatsapp").catch(() => []),
    ]);
    const rev = new Map(reviews.map((r) => [r.company_id, r]));
    const pending = cos.find((c) => c.status === "pending" && !(rev.get(c.id) || {}).checked_at);
    const phones = new Map((priv || []).filter((p) => p.whatsapp).map((p) => [p.company_id, p.whatsapp]));
    if (pending) { const msg = await vet(pending, cos, phones); console.log(msg); return { statusCode: 200, body: msg }; }
    // Approved companies that joined before the website checks existed get one deep check each
    const unchecked = cos.find((c) => c.status === "approved" && !(rev.get(c.id) || {}).site_checked_at);
    if (unchecked) { const msg = await vet(unchecked, cos, phones); console.log(msg); return { statusCode: 200, body: msg }; }
    const apps = await sbGet("applications?select=id,checklist,businesses(name,country,city,sector,makes,website),campaigns!inner(name,buyer_criteria)&ai_checked_at=is.null&stage=in.(registered,submitted)&campaigns.buyer_criteria=not.is.null&order=created_at.asc&limit=1").catch((e) => { console.log("precheck query skipped:", e.message); return []; });
    if (apps.length) { const msg = await precheck(apps[0]); console.log(msg); return { statusCode: 200, body: msg }; }
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
