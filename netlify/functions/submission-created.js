// Runs automatically after every verified Netlify Forms submission.
// Sends a confirmation email to the registrant from info@saisevents.com,
// and a short alert to info@saisevents.com. Uses Resend (resend.com).
// Needs the RESEND_API_KEY environment variable in Netlify. Without it, this does nothing
// and the form still saves normally.

const FROM = "SAIS Events <info@saisevents.com>";
const ADMIN = "info@saisevents.com";

const SHOWS = {
  "afroplast-2027-registration": {
    expo: "AFROPLAST 2027",
    when: "9 to 12 January 2027",
    where: "Egypt International Exhibition Center, Cairo, Egypt",
    vet: "https://saisevents.com/market.html?expo=AFROPLAST%202027",
    perks: "Approved hosted buyers get complimentary hotel accommodation for 3 days during the exhibition, airport and exhibition day transfers, and onsite B2B matchmaking with exhibitors.",
    passport: "12 July 2027",
  },
  "aluminium-china-2027-registration": {
    expo: "ALUMINIUM CHINA 2027",
    when: "7 to 9 July 2027",
    where: "Shanghai New International Expo Centre, Shanghai, China",
    vet: "https://saisevents.com/market.html?expo=ALUMINIUM%20CHINA%202027",
    perks: "Qualified hosted buyers get up to 3 nights hotel with breakfast, shuttle to the venue, lunch vouchers, airport pickup for groups of 10 or more, and B2B matchmaking with exhibitors.",
    passport: "9 January 2028",
  },
};

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function send(key, msg) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(msg),
  });
  if (!r.ok) console.log("Resend error", r.status, await r.text());
}

exports.handler = async (event) => {
  try {
    const key = process.env.RESEND_API_KEY;
    const payload = JSON.parse(event.body || "{}").payload || {};
    const show = SHOWS[payload.form_name];
    if (!show || !key) return { statusCode: 200, body: "skipped" };

    const d = payload.data || {};
    const first = String(d.name || "").trim().split(/\s+/)[0] || "there";
    const email = String(d.email || "").trim();

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(first)},</p>
<p>Thank you for registering for <b>${show.expo}</b>, ${show.when}, at the ${show.where}. We have received your details for <b>${esc(d.company)}</b>.</p>
<p><b>What happens next</b></p>
<ol>
<li>Create your free company profile on SAIS MatchMarket so we can vet your company and request your B2B meetings: <a href="${show.vet}">${show.vet}</a></li>
<li>Our team reviews your registration and submits your hosted buyer application to the organisers, who make the final decision.</li>
<li>If you asked for a visa invitation letter, we will contact you about your visa and flights.</li>
</ol>
<p>${show.perks}</p>
<p>Please keep your passport valid until at least ${show.passport}.</p>
<p>If you have any questions, simply reply to this email or WhatsApp us on +254 722 170 385.</p>
<p>Warm regards,<br>Catherine Kinyanjui<br>SAIS Events, official delegate sourcing agent for East Africa<br><a href="https://saisevents.com">saisevents.com</a></p>
</div>`;
      await send(key, {
        from: FROM,
        to: [email],
        reply_to: ADMIN,
        subject: `Your ${show.expo} registration is received`,
        html,
      });
    }

    // Alert for SAIS. Passport number and file stay in Netlify Forms, not in email.
    const rows = [
      ["Company", d.company], ["Contact", d.name], ["Job title", d.jobtitle], ["Email", d.email],
      ["WhatsApp", d.whatsapp], ["Country", d.country], ["City", d.city], ["Website", d.website],
      ["Established", d.established], ["Activities", [d.activities, d.activity_other].filter(Boolean).join(", ")],
      ["Makes or sells", d.products], ["Wants to source", [d.interests, d.interest_other].filter(Boolean).join(", ")],
      ["Meetings", d.meetings], ["Turnover 2025", d.turnover], ["Imports 2025", d.imports],
      ["Imported from", d.imported_from], ["Imported products", d.imported_products], ["Visa letter", d.visa_letter],
    ].map(([k, v]) => `<tr><td style="padding:4px 10px 4px 0;color:#46524D">${k}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("");
    await send(key, {
      from: FROM,
      to: [ADMIN],
      reply_to: email || ADMIN,
      subject: `New ${show.expo} registration: ${String(d.company || "").slice(0, 80)}`,
      html: `<div style="font-family:Arial,sans-serif;font-size:15px"><p>New registration for ${show.expo}.</p><table>${rows}</table><p>Passport details and the passport file are in Netlify, under Forms, ${payload.form_name}.</p></div>`,
    });
  } catch (e) {
    console.log("submission-created error", e && e.message);
  }
  return { statusCode: 200, body: "ok" };
};
