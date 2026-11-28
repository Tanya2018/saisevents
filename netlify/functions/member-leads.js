// Lead Hunter inside MatchMarket, part 1: takes a member's search.
// POST { query, country } with the member's Supabase access token in the Authorization header.
// Checks the member, gives the free credits they are due, checks their balance and limits,
// then queues the search. member-leads-worker runs it within about a minute.
// Who can use it is set by LEADS_OPEN_TO: "vip" (default, VIP members and SAIS admins only) or "all".
// Needs: SUPABASE_SERVICE_ROLE_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const WELCOME = 5;      // free leads for every vetted company, once
const VIP_MONTH = 50;   // leads each calendar month for VIP members
const PER_DAY = 3;      // searches per company per day

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function h(sk, extra) {
  return { apikey: sk, ...(sk.startsWith("sb_") ? {} : { Authorization: `Bearer ${sk}` }), "Content-Type": "application/json", ...(extra || {}) };
}
async function get(sk, path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: h(sk) });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}
async function post(sk, table, row, prefer) {
  return fetch(`${SB}/rest/v1/${table}`, { method: "POST", headers: h(sk, { Prefer: prefer || "return=minimal" }), body: JSON.stringify(row) });
}
async function balance(sk, cid) {
  const rows = await get(sk, `lead_credits?select=amount&company_id=eq.${cid}`);
  return rows.reduce((a, r) => a + (Number(r.amount) || 0), 0);
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false });
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sk) return json(200, { ok: false, msg: "Lead search is not available right now." });
  try {
    const token = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) return json(401, { ok: false, msg: "Please log in again." });
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: sk, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return json(401, { ok: false, msg: "Please log in again." });
    const user = await ur.json();

    // The member's company: their own, or SAIS Events for team admins (my_company handles both).
    const mc = await fetch(`${SB}/rest/v1/rpc/my_company`, { method: "POST", headers: { apikey: sk, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: "{}" });
    const cid = mc.ok ? await mc.json() : null;
    if (!cid || typeof cid !== "string") return json(200, { ok: false, msg: "Add your company to MatchMarket first." });
    const [co] = await get(sk, `companies?select=id,name,status&id=eq.${cid}`);
    if (!co || co.status !== "approved") return json(200, { ok: false, msg: "Lead search opens after SAIS vets your company." });

    const admin = (await get(sk, `admins?select=user_id&user_id=eq.${user.id}`)).length > 0;
    const [plan] = await get(sk, `member_plans?select=vip&company_id=eq.${cid}`);
    const vip = !!(plan && plan.vip);
    const openTo = (process.env.LEADS_OPEN_TO || "vip").toLowerCase();
    if (openTo !== "all" && !vip && !admin) return json(200, { ok: false, vipOnly: true, msg: "Lead search is open to VIP members first. It opens to all members soon." });

    // Free credits they are due. The unique index stops double grants.
    const have = await get(sk, `lead_credits?select=reason,period&company_id=eq.${cid}&reason=in.(welcome,vip_month)`);
    if (!have.some((x) => x.reason === "welcome")) await post(sk, "lead_credits", { company_id: cid, amount: WELCOME, reason: "welcome", note: "Free leads for vetted members" });
    const period = new Date().toISOString().slice(0, 7);
    if (vip && !have.some((x) => x.reason === "vip_month" && x.period === period)) await post(sk, "lead_credits", { company_id: cid, amount: VIP_MONTH, reason: "vip_month", period, note: "VIP monthly leads" });

    const b = JSON.parse(event.body || "{}");
    if (b.action === "balance") return json(200, { ok: true, balance: await balance(sk, cid), vip });

    const query = String(b.query || "").replace(/\s+/g, " ").trim().slice(0, 160);
    const country = String(b.country || "").trim().slice(0, 60);
    if (query.length < 5) return json(200, { ok: false, msg: "Tell us what customers you want, in a few words." });
    if (country.length < 2) return json(200, { ok: false, msg: "Choose a country." });

    const bal = await balance(sk, cid);
    if (bal <= 0) return json(200, { ok: false, noCredits: true, msg: "You have used all your leads. Get more leads to keep searching." });

    const busy = await get(sk, `member_lead_searches?select=id&company_id=eq.${cid}&status=in.(queued,running)`);
    if (busy.length) return json(200, { ok: false, msg: "Your last search is still running. Your leads will appear in a minute." });
    const since = new Date(Date.now() - 864e5).toISOString();
    const today = await get(sk, `member_lead_searches?select=id&company_id=eq.${cid}&created_at=gt.${since}`);
    if (today.length >= PER_DAY) return json(200, { ok: false, msg: `You can run ${PER_DAY} searches a day. Please try again tomorrow.` });

    const ins = await post(sk, "member_lead_searches", { company_id: cid, query, country }, "return=representation");
    if (!ins.ok) throw new Error("insert " + ins.status);
    const [row] = await ins.json();
    return json(200, { ok: true, search: row, balance: bal, msg: "Our agent is searching. Your leads will appear here in about 2 minutes, and we will email them to you." });
  } catch (e) {
    console.log("member-leads error", e && e.message);
    return json(200, { ok: false, msg: "Something went wrong. Please try again in a minute." });
  }
};
