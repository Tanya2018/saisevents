// SAIS MatchMarket profile coach. Runs every 20 minutes (see netlify.toml), a few companies per run.
// For every registered company (not organisers or service providers):
// 1. Checks each expo the company ticked against what the company really does: good, weak or poor fit.
// 2. Suggests up to 3 upcoming expos that match the business better, from the SAIS expo list.
// 3. Lists what the profile still needs (from the registration scorer), including the logo.
// Results show on the member's "My company" page. Companies below the pass score (80), or with
// poor fit expos, also get an email: at most once every 14 days and 3 times in all.
// The expo list is read from market.html on the live site, so it is never out of date.
// Needs: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY. Optional: RESEND_API_KEY for the emails.

const crypto = require("crypto");
const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const SITE = "https://saisevents.com";
const MODEL = "claude-haiku-5-5";
const PASS = 80;
const PER_RUN = 3;
const EMAIL_GAP_DAYS = 14;
const MAX_EMAILS = 3;
const FROM = "SAIS MatchMarket <info@saisevents.com>";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function h(sk, extra) { return { apikey: sk, ...(sk.startsWith("sb_") ? {} : { Authorization: `Bearer ${sk}` }), "Content-Type": "application/json", ...(extra || {}) }; }
async function get(sk, path) { const r = await fetch(`${SB}/rest/v1/${path}`, { headers: h(sk) }); if (!r.ok) throw new Error(`${path} ${r.status}`); return r.json(); }
async function upsert(sk, table, rows) {
  const r = await fetch(`${SB}/rest/v1/${table}`, { method: "POST", headers: h(sk, { Prefer: "resolution=merge-duplicates,return=minimal" }), body: JSON.stringify(rows) });
  if (!r.ok) throw new Error(`upsert ${table} ${r.status}: ${await r.text()}`);
}
async function ownerEmail(sk, id) {
  if (!id) return "";
  const r = await fetch(`${SB}/auth/v1/admin/users/${id}`, { headers: { apikey: sk, Authorization: `Bearer ${sk}` } });
  return r.ok ? (await r.json()).email || "" : "";
}

async function expoList() {
  const r = await fetch(`${SITE}/market.html`, { headers: { "User-Agent": "SAIS-ProfileCoach" } });
  const html = await r.text();
  const m = html.match(/const EXPOS_ALL=(\[[\s\S]*?\]);/);
  if (!m) throw new Error("expo list not found");
  const today = new Date().toISOString().slice(0, 10);
  return JSON.parse(m[1]).filter((e) => !e.end || e.end >= today);
}

async function claude(body, ms) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", signal: ctl.signal, headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`Claude ${r.status}`);
    const j = await r.json();
    return (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  } finally { clearTimeout(t); }
}

async function judge(c, expos) {
  const list = expos.map((e) => `- ${e.n} | ${e.s || "general trade"} | ${e.p} | ${e.d}`).join("\n");
  const ticked = (c.expos || []).filter((n) => expos.some((e) => e.n === n));
  const text = await claude({
    model: MODEL, max_tokens: 1200,
    system: "You advise companies on which trade expos fit their business. Be honest and practical: a company should only go to expos where it can meet real buyers or suppliers for what it sells or buys. " +
      "good = the expo's sector matches the company's main products or what it wants to buy. weak = some overlap but not the core business. poor = no real link. Reply with JSON only.",
    messages: [{ role: "user", content:
      `Company: ${c.name}\nType: ${c.role || ""}\nCountry: ${c.country || ""}\nAbout: ${String(c.about || "").slice(0, 600)}\nSells: ${c.sells || ""}\nWants to buy: ${c.wants || ""}\nMarkets: ${c.markets || ""}\n\n` +
      `Expos the company ticked: ${ticked.length ? ticked.join("; ") : "none"}\n\nUpcoming SAIS expos (name | sector | place | dates):\n${list}\n\n` +
      `1. Rate every ticked expo. 2. Suggest up to 3 other expos from the list that fit well and were not ticked (none if nothing fits). Keep each reason to one short sentence a business owner understands.\n` +
      `Reply with JSON only: {"expo_fit":[{"expo":"","fit":"good|weak|poor","reason":""}],"suggest":[{"expo":"","reason":""}],"summary":"one sentence on where this company should focus"}`,
    }],
  }, 20000);
  const m = text.match(/\{[\s\S]*\}/); if (!m) throw new Error("no JSON");
  const j = JSON.parse(m[0]);
  const names = new Set(expos.map((e) => e.n));
  const fit = (j.expo_fit || []).filter((x) => x && ticked.includes(x.expo) && ["good", "weak", "poor"].includes(x.fit)).map((x) => ({ expo: x.expo, fit: x.fit, reason: String(x.reason || "").slice(0, 240) }));
  const suggest = (j.suggest || []).filter((x) => x && names.has(x.expo) && !ticked.includes(x.expo)).slice(0, 3).map((x) => ({ expo: x.expo, reason: String(x.reason || "").slice(0, 240) }));
  return { expo_fit: fit, suggest, summary: String(j.summary || "").slice(0, 300) };
}

async function sendEmail(c, sc, coach, email) {
  const FIT = { good: "Good fit", weak: "Weak fit", poor: "Poor fit" };
  const fitRows = coach.expo_fit.map((x) => `<li><b>${esc(x.expo)}</b>: ${FIT[x.fit]}. ${esc(x.reason)}${x.fit === "poor" ? " <i>We suggest you untick this expo.</i>" : ""}</li>`).join("");
  const sugRows = coach.suggest.map((x) => `<li><b>${esc(x.expo)}</b>: ${esc(x.reason)}</li>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:580px">
<p>Dear ${esc(c.name)} Team,</p>
<p>Thank you for being part of SAIS MatchMarket. We appreciate the work you put into growing your business, and we want to help organisers and buyers pick you.</p>
<p>Our matchmaker checked your company profile. It scores <b>${sc ? sc.score : "below"} out of 100</b>. Profiles that score ${PASS} or more are the ones we put forward to organisers first.</p>
${coach.todo.length ? `<p><b>1. Please add to your profile:</b></p><ul>${coach.todo.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>` : ""}
${fitRows ? `<p><b>${coach.todo.length ? "2" : "1"}. The expos you chose:</b></p><ul>${fitRows}</ul>` : ""}
${sugRows ? `<p><b>Expos that match your business:</b></p><ul>${sugRows}</ul>` : ""}
<p>Choosing only the expos that match your products means organisers take your application seriously, and you meet the right buyers.</p>
<p><a href="${SITE}/market.html#profile" style="display:inline-block;background:#04211A;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Update my profile</a></p>
<p>Log in, open <b>My company</b>, make the changes and press Save. It takes about 5 minutes.</p>
<p>Warm regards,<br>SAIS Events, MICE, International Trade &amp; Business Events<br><a href="${SITE}">saisevents.com</a></p></div>`;
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [email], reply_to: "info@saisevents.com", subject: `${c.name}: your MatchMarket profile and expo recommendations`.slice(0, 140), html }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}`);
}

exports.handler = async () => {
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sk || !process.env.ANTHROPIC_API_KEY) return { statusCode: 200, body: "missing keys" };
  const out = [];
  try {
    const [cos, scores, coaches, expos] = await Promise.all([
      get(sk, "companies?select=id,owner,name,role,country,about,sells,wants,markets,expos,logo_url,status,created_at&status=neq.declined&role=not.in.(Organiser,%22Service%20provider%22)"),
      get(sk, "company_scores?select=company_id,score,grade,gaps"),
      get(sk, "company_coach?select=company_id,sig,emailed_at,emails"),
      expoList(),
    ]);
    const smap = new Map(scores.map((x) => [x.company_id, x]));
    const cmap = new Map(coaches.map((x) => [x.company_id, x]));
    const expoSig = crypto.createHash("md5").update(expos.map((e) => e.n + e.s).join("|")).digest("hex").slice(0, 8);

    const todo = [];
    for (const c of cos) {
      const sc = smap.get(c.id);
      if (!sc) continue; // wait for the scorer first
      const sig = crypto.createHash("md5").update(JSON.stringify([expoSig, c.about, c.sells, c.wants, c.role, (c.expos || []).slice().sort(), sc.score, sc.gaps])).digest("hex");
      const prev = cmap.get(c.id);
      if (!prev || prev.sig !== sig) todo.push([c, sc, sig, prev]);
    }
    await Promise.all(todo.slice(0, PER_RUN).map(async ([c, sc, sig, prev]) => {
      try {
        const j = await judge(c, expos);
        const coach = { company_id: c.id, ...j, todo: sc.gaps || [], sig, checked_at: new Date().toISOString() };
        await upsert(sk, "company_coach", [coach]);
        out.push(`${c.name}: ${j.expo_fit.map((x) => x.fit).join(",") || "no expos"}; ${j.suggest.length} suggestions`);

        const needsHelp = (sc.score < PASS && coach.todo.length) || j.expo_fit.some((x) => x.fit === "poor") || (!(c.expos || []).length && j.suggest.length);
        const n = (prev && prev.emails) || 0;
        const last = prev && prev.emailed_at ? new Date(prev.emailed_at).getTime() : 0;
        if (process.env.RESEND_API_KEY && needsHelp && n < MAX_EMAILS && Date.now() - last > EMAIL_GAP_DAYS * 864e5) {
          const email = await ownerEmail(sk, c.owner);
          if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            await sendEmail(c, sc, coach, email);
            await upsert(sk, "company_coach", [{ company_id: c.id, emailed_at: new Date().toISOString(), emails: n + 1 }]);
            out.push(`emailed ${c.name}`);
          }
        }
      } catch (e) { out.push(`${c.name} failed: ${e.message}`); }
    }));
    console.log(out.join(" | ") || "nothing to do");
    return { statusCode: 200, body: out.join("\n") || "nothing to do" };
  } catch (e) {
    console.log("profile-coach error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
