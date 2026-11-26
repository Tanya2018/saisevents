// SAIS lead hunter, step 1b: the research analyst.
// Runs every 30 minutes (see netlify.toml). Takes up to 2 new leads the finder saved and checks each one:
//   1. Is the company real and still active?
//   2. Is its main business really the category we searched for?
//   3. Does it have a mobile number that can be used on WhatsApp (listed as WhatsApp, a wa.me link,
//      or a mobile number on its own site or business listing)?
// It gives each lead a verification score (0 to 100). A lead goes into the morning list only when
// the category matches, the score is 30 or more, and a WhatsApp ready mobile number was found.
// Nobody can confirm a WhatsApp account from outside without messaging it, so "WhatsApp ready" means
// a public mobile number in the right format, preferably one the company itself labels as WhatsApp.
// Needs: ANTHROPIC_API_KEY, SUPABASE_SERVICE_ROLE_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const MODEL = "claude-sonnet-5-5"; // same model as the finder, which runs web search reliably
const PER_RUN = 2;
const PASS_SCORE = 30;

// Mobile number rules per country: country code and the first digit(s) after it that mean a mobile line.
const MOBILE = {
  Kenya: ["254", /^(7|1)\d{8}$/],
  Uganda: ["256", /^7\d{8}$/],
  Tanzania: ["255", /^(6|7)\d{8}$/],
  Rwanda: ["250", /^7\d{8}$/],
  Ethiopia: ["251", /^(9|7)\d{8}$/],
  Burundi: ["257", /^(6|7)\d{7}$/],
  "South Sudan": ["211", /^9\d{8}$/],
  Somalia: ["252", /^6\d{8}$/],
  "DR Congo": ["243", /^(8|9)\d{8}$/],
  Egypt: ["20", /^1\d{9}$/],
  Nigeria: ["234", /^(7|8|9)\d{9}$/],
  Ghana: ["233", /^(2|5)\d{8}$/],
  "South Africa": ["27", /^(6|7|8)\d{8}$/],
  "United Arab Emirates": ["971", /^5\d{8}$/],
  UAE: ["971", /^5\d{8}$/],
  "Saudi Arabia": ["966", /^5\d{8}$/],
  Oman: ["968", /^(7|9)\d{7}$/],
  Qatar: ["974", /^(3|5|6|7)\d{7}$/],
};

// Returns the number as international digits (e.g. 254712345678) if it is a mobile line, else "".
function mobileNumber(raw, country) {
  const rule = MOBILE[country];
  if (!rule) return "";
  const [cc, re] = rule;
  for (const part of String(raw || "").split(/[,/;|]| or /i)) {
    let d = part.replace(/[^\d+]/g, "");
    if (!d) continue;
    if (d.startsWith("+")) d = d.slice(1);
    else if (d.startsWith("00")) d = d.slice(2);
    let local = d.startsWith(cc) ? d.slice(cc.length) : d.replace(/^0/, "");
    if (re.test(local)) return cc + local;
  }
  return "";
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
async function sbPatch(path, body) {
  const r = await sbFetch(path, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Supabase patch ${r.status}: ${await r.text()}`);
}

async function check(l) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 24000);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: ctl.signal,
      headers: { "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 900,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
        system:
          "You are a careful research analyst checking sales leads before a sales team calls them. Use web search. " +
          "Never guess or invent a phone number. Only report a number you actually saw on the company's own website, its Google or business directory listing, or its official social media page. Reply with JSON only.",
        messages: [{
          role: "user",
          content:
            `Company: ${l.name}\nCountry: ${l.country}${l.city ? ", " + l.city : ""}\nWebsite we have: ${l.website || "none"}\nPhone we have: ${l.phone || "none"}\n` +
            `We are inviting it as a buyer for ${l.expo} because it should be one of: "${l.sector}".\n\n` +
            `Check:\n1. Is this a real, currently active company in ${l.country}?\n2. What is its main business? Does it truly match "${l.sector}"? A company in a nearby but different industry does not match.\n` +
            `3. Find a mobile number the company uses for WhatsApp: a number it labels WhatsApp, a wa.me link, or a mobile number on its own site or listing.\n\n` +
            `Give verify_score 0 to 100 for how sure you are that this is a real, active company in the right category that we can reach on WhatsApp.\n\n` +
            `Reply with JSON only: {"active":true,"main_business":"","category_match":"exact or close or no","whatsapp":"number as shown, or empty","whatsapp_source":"where you saw it","verify_score":0,"note":"one short sentence"}`,
        }],
      }),
    });
    if (!r.ok) throw new Error(`Claude ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = await r.json();
    const text = (j.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON");
    return JSON.parse(m[0]);
  } finally {
    clearTimeout(t);
  }
}

async function verify(l) {
  let a = {};
  try {
    a = await check(l);
  } catch (e) {
    // A failed check is retried on a later run, up to 3 days after the lead was found.
    if (Date.now() - new Date(l.created_at).getTime() < 3 * 864e5) {
      await sbPatch(`leads?id=eq.${l.id}`, { analyst_note: `Check failed, will retry: ${String(e.message).slice(0, 250)}` }).catch(() => {});
      return `${l.name}: check failed, will retry (${e.message})`;
    }
    a = { note: "Could not be checked" };
  }
  const match = String(a.category_match || "").toLowerCase().trim();
  const score = Math.max(0, Math.min(100, Math.round(Number(a.verify_score) || 0)));
  const wa = mobileNumber(a.whatsapp, l.country) || mobileNumber(l.phone, l.country);
  const pass = a.active !== false && match === "exact" && score >= PASS_SCORE && !!wa;
  const why = !wa ? "no WhatsApp ready mobile number found" : match !== "exact" ? `category ${match || "unclear"}` : score < PASS_SCORE ? `score ${score} below ${PASS_SCORE}` : a.active === false ? "not active" : "passed";
  await sbPatch(`leads?id=eq.${l.id}`, {
    analyst_checked_at: new Date().toISOString(),
    analyst_pass: pass,
    verify_score: score,
    whatsapp: wa ? "+" + wa : null,
    main_business: String(a.main_business || l.main_business || "").slice(0, 300) || null,
    analyst_note: `${why}. ${String(a.note || "").slice(0, 250)}${a.whatsapp_source ? " WhatsApp seen on: " + String(a.whatsapp_source).slice(0, 120) : ""}`.trim(),
  });
  return `${l.name}: ${pass ? "PASS" : "rejected"} (${why}, score ${score})`;
}

exports.handler = async () => {
  if (!process.env.ANTHROPIC_API_KEY || !process.env.SUPABASE_SERVICE_ROLE_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    const queue = await sbGet(`leads?select=*&status=eq.new&digest_sent_at=is.null&analyst_checked_at=is.null&order=score.desc.nullslast,created_at.asc&limit=${PER_RUN}`);
    if (!queue.length) return { statusCode: 200, body: "nothing to check" };
    const out = await Promise.all(queue.map((l) => verify(l).catch((e) => `${l.name}: error ${e.message}`)));
    console.log(out.join(" | "));
    return { statusCode: 200, body: out.join("\n") };
  } catch (e) {
    console.log("lead-analyst error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
