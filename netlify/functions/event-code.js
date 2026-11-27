// One time access codes for hosted buyer registrations (first used for Advantage Healthcare India 2027).
// POST {action:"issue", event, email}: checks the email belongs to a SAIS MatchMarket company that has
//   ticked the event, then emails that company its own code (one code per company per event).
// POST {action:"redeem", event, code}: if the code is valid and unused, marks it used and returns the
//   official registration link. A code works once.
// Needs: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const EVENTS = {
  "Advantage Healthcare India 2027": {
    prefix: "AHCI",
    link: "https://ahcindia.ficci.in/registrations/ahci-hosted-foreign-delegate-registration.php",
    page: "https://saisevents.com/advantage-healthcare-india-2027.html#register",
  },
};
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0, O, 1, I, L

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function sb(path, opts = {}) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return fetch(`${SB}${path}`, { ...opts, headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }), "Content-Type": "application/json", ...(opts.headers || {}) } });
}
function newCode(prefix) {
  const b = require("crypto").randomBytes(6);
  return prefix + "-" + Array.from(b, (x) => ALPHABET[x % ALPHABET.length]).join("");
}

async function issue(ev, name, email) {
  const r = await sb("/rest/v1/rpc/company_by_email", { method: "POST", body: JSON.stringify({ e: email }) });
  const rows = r.ok ? await r.json() : [];
  const c = rows[0];
  if (!c) return json(200, { ok: false, msg: "We could not find a SAIS MatchMarket company with this email. Please register on MatchMarket first, using this email." });
  if (c.status === "declined") return json(200, { ok: false, msg: "This company is not approved on SAIS MatchMarket. Please contact info@saisevents.com." });
  if (!(c.expos || []).includes(name)) return json(200, { ok: false, msg: `Please open your MatchMarket profile, tick "${name}" under the expos you want to attend, fill in every field and press Save. Then try again.` });

  const ex = await (await sb(`/rest/v1/event_codes?select=code,used_at&event=eq.${encodeURIComponent(name)}&company_id=eq.${c.company_id}`)).json();
  let code;
  if (ex[0]) {
    if (ex[0].used_at) return json(200, { ok: false, msg: "Your code has already been used to open the registration form. If you need help, contact info@saisevents.com or WhatsApp +254 722 170 385." });
    code = ex[0].code;
  } else {
    for (let i = 0; i < 5 && !code; i++) {
      const tryCode = newCode(ev.prefix);
      const ins = await sb("/rest/v1/event_codes", { method: "POST", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ event: name, code: tryCode, company_id: c.company_id, email: email.toLowerCase() }) });
      if (ins.ok) code = tryCode;
    }
    if (!code) return json(200, { ok: false, msg: "Something went wrong. Please try again in a minute." });
  }

  const who = c.contact || `${c.name} Team`;
  const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(who)},</p>
<p>Thank you for your interest in ${esc(name)}, and for registering ${esc(c.name)} on SAIS MatchMarket.</p>
<p><b>MatchMarket confirmed:</b> ${esc(c.name)} is registered on SAIS MatchMarket.</p>
<p><b>Your one time access code:</b></p>
<p style="font-family:monospace;font-size:26px;font-weight:bold;letter-spacing:3px;background:#04211A;color:#F0D28A;display:inline-block;padding:10px 18px;border-radius:8px">${code}</p>
<p>This code is for your registration only and works once. Please do not share it.</p>
<p><b>How to register</b></p>
<ol>
<li>Open <a href="${ev.page}">the registration page</a>.</li>
<li>Enter your code in step 3 and tap <b>Unlock form</b>.</li>
<li>Fill in <b>every field</b> on the official form. Write your name exactly as in your passport, and upload a passport size photo and clear passport scans.</li>
<li>Under <b>"Nominated / Recommended to FICCI for Advantage Healthcare India by"</b>, choose <b>Others (please specify)</b> and type <b>SAIS Events</b>.</li>
<li>Submit, then send us a screenshot on WhatsApp: +254 722 170 385.</li>
</ol>
<p>Registration is free. The organiser makes the final selection. Please do not book flights until your place and visa are confirmed.</p>
<p>Warm regards,<br>SAIS Events, MICE, International Trade &amp; Business Events<br><a href="https://saisevents.com">saisevents.com</a></p></div>`;
  const m = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "SAIS Events <info@saisevents.com>", to: [email], reply_to: "info@saisevents.com", subject: `Your one time access code: ${name}`, html }),
  });
  if (!m.ok) return json(200, { ok: false, msg: "We could not send the email. Please try again, or WhatsApp +254 722 170 385." });
  const [u, d] = email.split("@");
  return json(200, { ok: true, msg: `Your code has been sent to ${u.slice(0, 2)}***@${d}. Check your inbox and spam folder, then enter the code below.` });
}

async function redeem(ev, name, code) {
  const r = await sb(`/rest/v1/event_codes?select=id,used_at&event=eq.${encodeURIComponent(name)}&code=eq.${encodeURIComponent(code)}`);
  const row = (await r.json())[0];
  if (!row) return json(200, { ok: false, msg: "That code is not correct. Get your code with your MatchMarket email above." });
  if (row.used_at) return json(200, { ok: false, msg: "This code has already been used. Each code works once. Contact info@saisevents.com if you need help." });
  await sb(`/rest/v1/event_codes?id=eq.${row.id}&used_at=is.null`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ used_at: new Date().toISOString() }) });
  return json(200, { ok: true, link: ev.link });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false });
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY) return json(200, { ok: false, msg: "Registration is not available right now. Please WhatsApp +254 722 170 385." });
  try {
    const b = JSON.parse(event.body || "{}");
    const name = String(b.event || "");
    const ev = EVENTS[name];
    if (!ev) return json(400, { ok: false, msg: "Unknown event." });
    if (b.action === "issue") {
      const email = String(b.email || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json(200, { ok: false, msg: "Please enter a valid email address." });
      return await issue(ev, name, email);
    }
    if (b.action === "redeem") {
      const code = String(b.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").replace(/^([A-Z]+?)([A-Z0-9]{6})$/, "$1-$2");
      return await redeem(ev, name, code);
    }
    return json(400, { ok: false });
  } catch (e) {
    console.log("event-code error", e && e.message);
    return json(200, { ok: false, msg: "Something went wrong. Please try again in a minute." });
  }
};
