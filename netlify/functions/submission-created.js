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
  "agroexpo-2027-registration": {
    expo: "AGROEXPO 2027",
    when: "2 to 6 February 2027",
    where: "Fuar İzmir, Türkiye",
    vet: "https://saisevents.com/market.html?expo=AGROEXPO%202027",
    perks: "Approved hosted buyers get 2 nights in a 3-star hotel, shuttle between hotel and fair, VIP entry and VIP Lounge access, the İzmir Bay networking dinner cruise, and pre-arranged B2B meetings. Buyers pay their own flights, and air tickets, a company tax certificate and a business or chamber of commerce registration must reach the organisers by 18 December 2026.",
    passport: "6 August 2027",
  },
  "aluminium-china-2027-registration": {
    expo: "ALUMINIUM CHINA 2027",
    when: "7 to 9 July 2027",
    where: "Shanghai New International Expo Centre, Shanghai, China",
    vet: "https://saisevents.com/market.html?expo=ALUMINIUM%20CHINA%202027",
    perks: "Qualified hosted buyers get up to 3 nights hotel with breakfast, shuttle to the venue, lunch vouchers, airport pickup for groups of 10 or more, and B2B matchmaking with exhibitors.",
    passport: "9 January 2028",
  },
  "kenya-homes-expo-2026-registration": {
    expo: "Kenya Homes Expo 2026",
    when: "19 to 22 November 2026",
    where: "Kenyatta International Convention Centre (KICC), Nairobi, Kenya",
    vet: "https://saisevents.com/market.html?expo=Kenya%20Homes%20Expo%202026",
    type: "exhibitor",
    perks: "Our team will call you with the available stands and the booking form. Stands are confirmed by the organisers once payment is received.",
  },
  "mombasa-saccos-expo-2026-registration": {
    expo: "Mombasa SACCOs and SMEs Expo 2026",
    when: "26 to 29 November 2026",
    where: "Mama Ngina Waterfront, Mombasa, Kenya",
    vet: "https://saisevents.com/market.html?expo=Mombasa%20SACCOs%20Expo%202026",
    type: "exhibitor",
    perks: "Our team will send you the exhibitor packages and help you book your stand. Stands are confirmed by the organisers once payment is received.",
  },
  "global-tea-fair-2026-registration": {
    expo: "Global Tea Fair 2026",
    when: "17 to 21 December 2026",
    where: "Shenzhen Convention and Exhibition Center, Shenzhen, China",
    vet: "https://saisevents.com/market.html?expo=Global%20Tea%20Fair%202026",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "wci-forum-kenya-2027-registration": {
    expo: "WCI Forum Kenya 2027",
    when: "27 to 28 January 2027",
    where: "Nairobi, Kenya",
    vet: "https://saisevents.com/market.html?expo=WCI%20Forum%20Kenya%202027",
    type: "visitor",
    perks: "If you have not done it yet, complete your registration on the official WCI Forum Kenya form here: https://docs.google.com/forms/d/e/1FAIpQLScnN5c7pqlj_xY0KVpYmMpZb_pgVCropYZxJa1-kcl4XDQ1hA/viewform . SAIS Events helps with B2B meetings at the forum, and with the Kenya eTA, hotels and transfers for visitors from outside Kenya.",
  },
  "expo-west-2027-registration": {
    expo: "Expo West 2027",
    when: "2 to 5 March 2027",
    where: "Anaheim Convention Center, Anaheim, USA",
    vet: "https://saisevents.com/market.html?expo=Expo%20West%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "india-mattresstech-2027-registration": {
    expo: "India Mattresstech Expo 2027",
    when: "3 to 6 March 2027",
    where: "India Expo Mart, Greater Noida, India",
    vet: "https://saisevents.com/market.html?expo=India%20Mattresstech%20Expo%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "hotelex-shanghai-2027-registration": {
    expo: "HOTELEX Shanghai 2027",
    when: "30 March to 2 April 2027",
    where: "National Exhibition and Convention Center, Shanghai, China",
    vet: "https://saisevents.com/market.html?expo=HOTELEX%20Shanghai%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "inter-foodtech-2027-registration": {
    expo: "Inter FoodTech 2027",
    when: "15 to 17 April 2027",
    where: "Bombay Exhibition Centre, Mumbai, India",
    vet: "https://saisevents.com/market.html?expo=Inter%20FoodTech%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "sial-canada-2027-registration": {
    expo: "SIAL Canada 2027",
    when: "27 to 29 April 2027",
    where: "Enercare Centre, Toronto, Canada",
    vet: "https://saisevents.com/market.html?expo=SIAL%20Canada%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "fi-africa-2027-registration": {
    expo: "Fi Africa 2027",
    when: "1 to 3 June 2027",
    where: "Egypt International Exhibition Center, Cairo, Egypt",
    vet: "https://saisevents.com/market.html?expo=Fi%20Africa%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "propak-china-2027-registration": {
    expo: "ProPak China 2027",
    when: "22 to 24 June 2027",
    where: "National Exhibition and Convention Center, Shanghai, China",
    vet: "https://saisevents.com/market.html?expo=ProPak%20China%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "cosmoprof-las-vegas-2027-registration": {
    expo: "Cosmoprof Las Vegas 2027",
    when: "13 to 15 July 2027",
    where: "Mandalay Bay Convention Center, Las Vegas, USA",
    vet: "https://saisevents.com/market.html?expo=Cosmoprof%20Las%20Vegas%202027",
    type: "visitor",
    perks: "SAIS Events helps with visa invitation letters, visa processing, flights, hotels and B2B meetings at the show.",
  },
  "woc-dubai-2027-registration": {
    expo: "World of Coffee Dubai 2027",
    when: "26 to 28 January 2027",
    where: "Dubai World Trade Centre, Dubai, UAE",
    vet: "https://saisevents.com/market.html?expo=World%20of%20Coffee%20Dubai%202027",
    perks: "If you have not done it yet, complete your visitor registration with the organiser here: https://woc.dxblive.com/event/05bad6ba-cab3-44fc-ba13-4206fca76d72/register?RefId=Visitor&rp=873e0e71-cf13-4ddf-af7b-c00401571de8&utm_source=saisevents&utm_medium=partner&utm_campaign=sais-woc-dubai-2027 . Our team will contact you about UAE visa processing, flights, hotels and buyer meetings.",
  },
  "ifco-2027-registration": {
    expo: "IFCO 2027",
    when: "3 to 6 February 2027",
    where: "Istanbul Expo Center, Istanbul, Turkey",
    vet: "https://saisevents.com/market.html?expo=IFCO%202027",
    perks: "Buyer places are reviewed by the organiser's committee, and any travel or hotel support is decided by the organiser. We will request your passport details for the visa invitation letter once your place is confirmed.",
  },
  "ie-expo-2027-registration": {
    expo: "IE expo 2027",
    campaign: "IE expo China 2027",
    when: "20 to 22 April 2027",
    where: "Shanghai New International Expo Centre, Shanghai, China",
    vet: "https://saisevents.com/market.html?expo=IE%20expo%202027",
    perks: "We will put your company forward to the organisers and plan your meetings. We will request your passport details for the visa invitation letter once your place is confirmed.",
  },
};

const esc = (v) =>
  String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Saves a delegate registration into the SAIS pipeline (Supabase). Passport fields are never sent.
async function saveToPipeline(show, d) {
  const sk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sk || show.type === "exhibitor") return;
  const pick = (k) => (d[k] == null ? "" : String(d[k]).slice(0, 600));
  const answers = {};
  ["established", "activities", "activity_other", "products", "interests", "interest_other", "meetings", "turnover", "imports",
   "imported_from", "imported_products", "visa_letter", "description"].forEach((k) => { if (pick(k)) answers[k] = pick(k); });
  const body = { p: {
    campaign: show.campaign || show.expo, company: pick("company"), country: pick("country"), city: pick("city"), website: pick("website"),
    activities: [pick("activities"), pick("activity_other")].filter(Boolean).join(", "), products: pick("products"),
    contact_name: pick("name"), job_title: pick("jobtitle"), whatsapp: pick("whatsapp"), email: pick("email"),
    consent: pick("consent_share"), answers,
  } };
  const r = await fetch("https://hbobppslyikleonzvzxp.supabase.co/rest/v1/rpc/form_application", {
    method: "POST",
    headers: { apikey: sk, ...(sk.startsWith("sb_") ? {} : { Authorization: `Bearer ${sk}` }), "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) console.log("pipeline save failed", r.status, (await r.text()).slice(0, 300));
}

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
    if (!show) return { statusCode: 200, body: "skipped" };

    const d = payload.data || {};
    try { await saveToPipeline(show, d); } catch (e) { console.log("pipeline save error", e && e.message); }
    if (!key) return { statusCode: 200, body: "saved, no email key" };
    const first = String(d.name || "").trim().split(/\s+/)[0] || "there";
    const email = String(d.email || "").trim();

    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      const html = `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;color:#0D1411;max-width:560px">
<p>Dear ${esc(first)},</p>
<p>Thank you for registering for <b>${show.expo}</b>, ${show.when}, at the ${show.where}. We have received your details for <b>${esc(d.company)}</b>.</p>
<p><b>What happens next</b></p>
${show.type === "visitor" ? `<ol>
<li>Create your free company profile on SAIS MatchMarket so we can vet your company and plan your B2B meetings: <a href="${show.vet}">${show.vet}</a></li>
<li>Our team will contact you on WhatsApp or email to confirm your trip and your registration with the organisers.</li>
<li>We will guide you on your visa, flights and hotel.</li>
</ol>` : show.type === "exhibitor" ? `<ol>
<li>Our team will contact you on WhatsApp or by phone about your stand.</li>
<li>Create your free company profile on SAIS MatchMarket so buyers and partners can find you: <a href="${show.vet}">${show.vet}</a></li>
</ol>` : `<ol>
<li>Create your free company profile on SAIS MatchMarket so we can vet your company and request your B2B meetings: <a href="${show.vet}">${show.vet}</a></li>
<li>Our team reviews your registration and submits your application to the organisers, who make the final decision.</li>
<li>We will contact you about your visa and flights.</li>
</ol>`}
<p>${show.perks}</p>
${show.passport ? `<p>Please keep your passport valid until at least ${show.passport}.</p>` : ""}
<p>If you have any questions, simply reply to this email or WhatsApp us on +254 722 170 385.</p>
<p>Warm regards,<br>Catherine Kinyanjui<br>SAIS Events, MICE, International Trade &amp; Business Events<br><a href="https://saisevents.com">saisevents.com</a></p>
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
      ["Meetings", d.meetings], ["Stand", d.stand], ["Booking timing", d.budget_ready], ["Turnover 2025", d.turnover], ["Imports 2025", d.imports],
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
