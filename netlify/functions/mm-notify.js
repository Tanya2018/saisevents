// Emails the other company when a new MatchMarket message is sent.
// Called by market.html right after a message is saved: POST { message_id, subject? }
// with the sender's Supabase access token in the Authorization header.
// Checks the caller really sent that message, then emails the recipient through Resend.
// A custom subject is allowed only for SAIS admins (used for messages to delegates).
// Ordinary chats send at most one email per conversation every 30 minutes.
// Needs: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const FROM = "SAIS MatchMarket <info@saisevents.com>";
const APP = "https://saisevents.com/market.html";

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function headers(sk, extra) {
  return { apikey: sk, ...(sk.startsWith("sb_") ? {} : { Authorization: `Bearer ${sk}` }), ...(extra || {}) };
}
async function sbGet(sk, path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: headers(sk) });
  if (!r.ok) throw new Error(`${path} ${r.status}`);
  return r.json();
}

exports.handler = async (event) => {
  const res = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  try {
    if (event.httpMethod !== "POST") return res(405, { error: "POST only" });
    const sk = process.env.SUPABASE_SERVICE_ROLE_KEY, rk = process.env.RESEND_API_KEY;
    if (!sk || !rk) return res(200, { skipped: "missing keys" });
    const token = String(event.headers.authorization || event.headers.Authorization || "").replace(/^Bearer\s+/i, "");
    const { message_id, subject } = JSON.parse(event.body || "{}");
    if (!token || !/^[0-9a-f-]{36}$/i.test(String(message_id || ""))) return res(400, { error: "bad request" });

    // Who is calling?
    const ur = await fetch(`${SB}/auth/v1/user`, { headers: { apikey: sk, Authorization: `Bearer ${token}` } });
    if (!ur.ok) return res(401, { error: "not signed in" });
    const user = await ur.json();

    const [msg] = await sbGet(sk, `messages?id=eq.${message_id}&select=id,conversation_id,sender_company,body,created_at`);
    if (!msg) return res(404, { error: "no message" });
    if (Date.now() - new Date(msg.created_at).getTime() > 10 * 60 * 1000) return res(200, { skipped: "old message" });
    const [sender] = await sbGet(sk, `companies?id=eq.${msg.sender_company}&select=id,name,owner`);
    if (!sender || sender.owner !== user.id) return res(403, { error: "not your message" });
    const admin = (await sbGet(sk, `admins?user_id=eq.${user.id}&select=user_id`)).length > 0;

    const [conv] = await sbGet(sk, `conversations?id=eq.${msg.conversation_id}&select=id,company_a,company_b,notified_at`);
    if (!conv) return res(404, { error: "no conversation" });
    if (!admin && conv.notified_at && Date.now() - new Date(conv.notified_at).getTime() < 30 * 60 * 1000) return res(200, { skipped: "recently notified" });
    const otherId = conv.company_a === sender.id ? conv.company_b : conv.company_a;
    const [other] = await sbGet(sk, `companies?id=eq.${otherId}&select=id,name,owner`);
    if (!other) return res(404, { error: "no recipient" });
    const ar = await fetch(`${SB}/auth/v1/admin/users/${other.owner}`, { headers: headers(sk) });
    if (!ar.ok) return res(200, { skipped: "no recipient email" });
    const to = (await ar.json()).email;
    if (!to) return res(200, { skipped: "no recipient email" });

    const subj = admin && subject ? String(subject).slice(0, 140) : `New message from ${sender.name} on SAIS MatchMarket`;
    const body = esc(msg.body).replace(/\n/g, "<br>");
    const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(other.name)},</p>
<p>You have a new message from <b>${esc(sender.name)}</b> on SAIS MatchMarket.</p>
<div style="border-left:4px solid #d6a63c;background:#F7F2E6;padding:14px 16px;border-radius:0 10px 10px 0;margin:16px 0">${body}</div>
<p><a href="${APP}" style="display:inline-block;background:#04211A;color:#fff;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Reply on MatchMarket</a></p>
<p style="font-size:14px;color:#46524D">Log in with ${esc(to)} and open Messages. If you have forgotten your password, choose "Forgot password" on the login page.</p>
<p>Warm regards,<br>SAIS Events, MICE, International Trade &amp; Business Events<br><a href="https://saisevents.com">saisevents.com</a></p></div>`;
    const sr = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], reply_to: "info@saisevents.com", subject: subj, html }),
    });
    if (!sr.ok) { console.log("Resend error", sr.status, await sr.text()); return res(200, { skipped: "email failed" }); }
    await fetch(`${SB}/rest/v1/conversations?id=eq.${conv.id}`, {
      method: "PATCH", headers: headers(sk, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ notified_at: new Date().toISOString() }),
    });
    return res(200, { sent: true });
  } catch (e) {
    console.log("mm-notify error", e && e.message);
    return res(200, { skipped: "error" });
  }
};
