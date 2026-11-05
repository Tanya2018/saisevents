// SAIS lead hunter, step 1: the Finder.
// Runs every 3 hours (see netlify.toml). Each run takes ONE search from "lead_hunts"
// (for example: AFROPLAST 2027, cosmetics manufacturers, Uganda), asks Claude to search
// the web for real companies that fit, and saves them in "leads" for Kate to call.
// A search is repeated only after 14 days. A repeat that finds nothing new switches itself off,
// so the agent stops spending on searches that have run dry.
// Only public business contacts from the company's own site or a business directory are kept.
// Needs: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const MODEL = "claude-sonnet-5-5";
const REPEAT_DAYS = 14;
const MIN_SCORE = 60; // weaker fits are not saved, so the list and the digest stay clean

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
async function sbPatch(path, body) {
  const r = await sbFetch(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Supabase patch ${r.status}: ${await r.text()}`);
}
async function sbInsertNew(table, rows, conflict) {
  const r = await sbFetch(`${table}?on_conflict=${conflict}`, {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify(rows),
  });
  if (!r.ok) throw new Error(`Supabase insert ${table} ${r.status}: ${await r.text()}`);
  return r.json();
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
const key = (s) => String(s || "").toLowerCase().replace(/\b(ltd|limited|plc|co|company|group|industries|industry|products|enterprises|international|the)\b/g, "").replace(/[^a-z0-9]/g, "");
const clean = (s, n) => (s == null ? null : String(s).trim().slice(0, n) || null);
const site = (s) => { s = clean(s, 200); if (!s) return null; return /^https?:\/\//i.test(s) ? s : "https://" + s; };

async function hunt(h, known, camp) {
  const c = camp || {};
  const brief = [c.city || c.country ? `Where and when: ${[c.city, c.country].filter(Boolean).join(", ")}${c.starts_on ? ", from " + c.starts_on : ""}` : "", c.buyer_criteria ? `Who qualifies (organiser's criteria): ${c.buyer_criteria}` : ""].filter(Boolean).join("\n");
  const skip = known.slice(0, 120).join("; ");
  const text = await claude({
    model: MODEL,
    max_tokens: 1800,
    tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
    system:
      "You find real companies to invite as hosted buyer delegates to trade expos. SAIS Events recruits company owners, managers and buyers from Africa and the Middle East. " +
      "Be strict: a wrong company wastes a sales call. Only list a company if its MAIN business matches the 'Find' line exactly and it is based in the requested country. " +
      "Leave out traders, shops, consultants, NGOs, government bodies, schools, media, event companies and foreign suppliers, unless the 'Find' line asks for them. " +
      "Only list companies you found in search results that are active. Use only public business contacts shown on the company's own website or a business directory. " +
      "Never guess or invent a phone number, email or website: leave it empty if you did not see it. It is fine to return fewer companies, or none. Reply with JSON only.",
    messages: [{ role: "user", content: `Expo: ${h.expo}\n${brief ? brief + "\n" : ""}Find: ${h.sector}\nCountry: ${h.country}\n\nSearch tips: look for member lists of the industry association in ${h.country}, government or export directories, and company websites, for example "${h.sector} ${h.country} members directory".\n\nFind up to 6 companies whose main business is "${h.sector}" in ${h.country}, that would buy machines, materials or supplies at this expo and fit the organiser's criteria. Prefer medium and large companies that make or grow their own products.\nSkip these, we already have them: ${skip || "none"}\n\nScore honestly: 80+ means a clear match for the Find line and the expo; below 60 means a weak or doubtful match.\n\nReply with JSON only:\n{"leads":[{"name":"","country":"","city":"","makes":"what they make, short","fit_reason":"one plain sentence on why they should attend ${h.expo}","score":0-100,"website":"","phone":"","email":"","source_url":"page where you found them"}]}` }],
  }, 23000);
  const out = (parseJSON(text).leads || []).filter((l) => l && l.name);
  const rows = [];
  const seen = new Set(known.map(key));
  const wantCountry = String(h.country || "").toLowerCase();
  let dropped = 0;
  for (const l of out) {
    const k = key(l.name);
    if (!k || seen.has(k)) continue;
    const score = Math.round(Number(l.score) || 0);
    const inCountry = !l.country || String(l.country).toLowerCase().includes(wantCountry) || wantCountry.includes(String(l.country).toLowerCase());
    const reachable = l.website || l.phone || l.email;
    if (score < MIN_SCORE || !inCountry || !reachable) { dropped++; continue; }
    seen.add(k);
    rows.push({
      name: clean(l.name, 160), name_key: k, country: h.country, city: clean(l.city, 80), sector: h.sector, expo: h.expo,
      makes: clean(l.makes, 300), fit_reason: clean(l.fit_reason, 400), score: Math.max(0, Math.min(100, Math.round(Number(l.score) || 0))),
      website: site(l.website), phone: clean(l.phone, 60), email: clean(l.email, 120), source_url: site(l.source_url), hunt_id: h.id,
    });
  }
  const saved = rows.length ? await sbInsertNew("leads", rows, "name_key") : [];
  // A repeat run that finds nothing new means this search has run dry: switch it off.
  const dry = !saved.length && !!h.last_run_at;
  await sbPatch(`lead_hunts?id=eq.${h.id}`, dry ? { found: h.found || 0, active: false } : { found: (h.found || 0) + saved.length });
  return `${h.expo} | ${h.sector} | ${h.country}: ${saved.length} new leads, ${dropped} weak fits left out${dry ? ", search switched off (ran dry)" : ""}`;
}

exports.handler = async () => {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    const since = new Date(Date.now() - REPEAT_DAYS * 864e5).toISOString();
    const due = await sbGet(`lead_hunts?select=*&active=is.true&or=(last_run_at.is.null,last_run_at.lt."${since}")&order=last_run_at.asc.nullsfirst,id.asc&limit=1`);
    if (!due.length) return { statusCode: 200, body: "nothing to hunt" };
    const h = due[0]; // h.last_run_at is the previous run (null on the first run)
    // Mark first, so one slow or failed search does not block the rest of the list.
    await sbPatch(`lead_hunts?id=eq.${h.id}`, { last_run_at: new Date().toISOString() });
    const known = (await sbGet(`leads?select=name&country=eq.${encodeURIComponent(h.country)}&order=created_at.desc&limit=300`)).map((r) => r.name);
    const camp = (await sbGet(`campaigns?select=city,country,starts_on,buyer_criteria&name=eq.${encodeURIComponent(h.expo)}`).catch(() => []))[0];
    const msg = await hunt(h, known, camp);
    console.log(msg);
    return { statusCode: 200, body: msg };
  } catch (e) {
    console.log("lead-hunter error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
