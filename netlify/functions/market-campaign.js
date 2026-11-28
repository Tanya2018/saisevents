// Enquiries for paid market campaigns (market-campaigns.html).
// POST JSON from the page. Saves the enquiry to campaign_enquiries, emails SAIS Events,
// and sends the company a short confirmation.
// Needs: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const FROM = "SAIS Events <info@saisevents.com>";
const NAMES = { entry: "Africa Market Entry Campaign", export: "Africa Export Campaign" };
const FIELDS = { company: 160, contact_name: 120, job_title: 120, email: 160, whatsapp: 40, country: 80, website: 300, products: 1500, target_markets: 300, expos: 300, timeline: 60, budget: 60, message: 2000 };
const REQUIRED = ["company", "contact_name", "email", "whatsapp", "country", "products"];

const json = (code, body) => ({ statusCode: code, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function mail(rk, to, subject, html, replyTo) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${rk}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [to], reply_to: replyTo || "info@saisevents.com", subject, html }),
  });
  return r.ok;
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { ok: false });
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY, rk = process.env.RESEND_API_KEY;
  if (!sk || !rk) return json(200, { ok: false, msg: "Enquiries are not open right now. Please WhatsApp +254 722 170 385." });
  try {
    const b = JSON.parse(event.body || "{}");
    if (b.website_url) return json(200, { ok: true }); // honeypot: quietly ignore
    const campaign = b.campaign === "export" ? "export" : b.campaign === "entry" ? "entry" : null;
    if (!campaign) return json(200, { ok: false, msg: "Choose a campaign." });
    const row = { campaign };
    for (const [k, max] of Object.entries(FIELDS)) {
      const v = String(b[k] == null ? "" : b[k]).trim().slice(0, max);
      row[k] = v || null;
    }
    for (const k of REQUIRED) if (!row[k]) return json(200, { ok: false, msg: "Please fill in every required field." });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) return json(200, { ok: false, msg: "Please check your email address." });

    const ins = await fetch(`${SB}/rest/v1/campaign_enquiries`, {
      method: "POST",
      headers: { apikey: sk, ...(sk.startsWith("sb_") ? {} : { Authorization: `Bearer ${sk}` }), "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
    if (!ins.ok) {
      console.log("market-campaign insert", ins.status, await ins.text());
      return json(200, { ok: false, msg: "Something went wrong. Please try again, or WhatsApp +254 722 170 385." });
    }

    const name = NAMES[campaign];
    const lines = [
      ["Campaign", name], ["Company", row.company], ["Country", row.country], ["Contact", row.contact_name], ["Job title", row.job_title],
      ["Email", row.email], ["WhatsApp", row.whatsapp], ["Website", row.website], ["Products", row.products],
      ["Target markets", row.target_markets], ["Expos", row.expos], ["Start", row.timeline], ["Budget", row.budget], ["Message", row.message],
    ].filter(([, v]) => v);
    const table = `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:15px">${lines.map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#46524D;vertical-align:top"><b>${esc(k)}</b></td><td style="padding:6px 0;white-space:pre-line">${esc(v)}</td></tr>`).join("")}</table>`;
    await mail(rk, "info@saisevents.com", `New campaign enquiry: ${row.company} (${name})`,
      `<div style="font-family:Arial,sans-serif;color:#0D1411"><p>A new market campaign enquiry came in from saisevents.com.</p>${table}<p>Reply within 2 working days.</p></div>`, row.email);

    await mail(rk, row.email, `We received your enquiry: ${name}`,
      `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(row.contact_name)},</p>
<p>Thank you for your interest in working with SAIS Events, and for telling us about ${esc(row.company)}.</p>
<p>We have received your enquiry for the <b>${esc(name)}</b>. Our team will study your products and target markets, and contact you within 2 working days on WhatsApp or email to arrange a short call.</p>
<p>While you wait, you can register ${esc(row.company)} for free on SAIS MatchMarket: <a href="https://saisevents.com/market.html">saisevents.com/market.html</a></p>
<p>Warm regards,<br>SAIS Events, MICE, International Trade &amp; Business Events<br><a href="https://saisevents.com">saisevents.com</a></p></div>`);

    return json(200, { ok: true });
  } catch (e) {
    console.log("market-campaign error", e && e.message);
    return json(200, { ok: false, msg: "Something went wrong. Please try again, or WhatsApp +254 722 170 385." });
  }
};
