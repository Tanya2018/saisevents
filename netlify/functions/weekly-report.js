// SAIS weekly expo reports. Runs every Friday at 8am Nairobi time (05:00 UTC, see netlify.toml).
// Sends info@saisevents.com:
//   1. One summary email: every active expo in one table, with this week's numbers and 3 next actions each.
//   2. One clean report per expo, ready to forward to the organiser as it is: headline numbers,
//      countries and sectors covered, and the delegate list sorted by profile score, with a CSV attached.
//      Cindy gets a copy of the reports for her expos.
// Profile scores come from the registration scorer (company_scores). Contact phones and emails appear
// only where the delegate gave consent.
// Needs: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const ADMIN = "info@saisevents.com";
const CINDY = { to: "cindy@saisevents.com", expos: ["ALUMINIUM CHINA 2027", "IE expo China 2027", "WCI Forum Kenya 2027"] };
const STAGES = [["found", "Found"], ["contacted", "Contacted"], ["interested", "Interested"], ["not_interested", "Not interested"],
  ["registered", "Registered"], ["submitted", "Sent to organiser"], ["approved", "Approved"], ["declined", "Declined"], ["attended", "Attended"]];
const DELEGATE = ["registered", "submitted", "approved", "declined", "attended"];
const GREEN = "#04211A", GOLD = "#8a6a12", LINE = "#e3ddd2";

async function sbGet(path) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: { apikey: key, ...(key.startsWith("sb_") ? {} : { Authorization: `Bearer ${key}` }) } });
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${await r.text()}`);
  return r.json();
}
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const stageName = (k) => (STAGES.find((x) => x[0] === k) || [k, k])[1];
const consented = (t) => t && ["given", "public_business_contact"].includes(t.consent_status);
const day = (d) => new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Nairobi" });
const slug = (s) => String(s).replace(/[^A-Za-z0-9]+/g, "-");
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Count values and list the most common first: "Kenya (12), Uganda (4)"
function tally(list, max = 8) {
  const m = new Map();
  list.map((v) => String(v || "").trim()).filter(Boolean).forEach((v) => m.set(v, (m.get(v) || 0) + 1));
  const top = [...m.entries()].sort((a, b) => b[1] - a[1]);
  return top.slice(0, max).map(([k, n]) => `${esc(k)} (${n})`).join(", ") + (top.length > max ? `, and ${top.length - max} more` : "");
}

const gradeOf = (a) => (a.sc ? a.sc.grade : "");
const rankOf = (a) => (a.sc ? a.sc.score : -1);
const gradePill = (a) => {
  if (!a.sc) return `<span style="color:#999;font-size:12px">Not scored</span>`;
  const bg = { A: "#dff3e6", B: "#fdf3d7", C: "#f8e1dc" }[a.sc.grade], fg = { A: "#1d6b3a", B: "#7a5a00", C: "#9b2c1c" }[a.sc.grade];
  return `<span style="display:inline-block;background:${bg};color:${fg};font-weight:bold;border-radius:999px;padding:2px 9px;font-size:12px">${a.sc.grade} · ${a.sc.score}</span>`;
};

function csvFor(c, apps) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Company", "Country", "City", "Business", "Makes or sells", "Profile score", "Grade", "Status", "Contact", "Job title", "Contact phone", "Contact email", "Website"];
  const rows = apps.map((a) => { const b = a.businesses || {}, t = a.contacts;
    return [b.name, b.country, b.city, b.sector, b.makes, a.sc ? a.sc.score : "", gradeOf(a), stageName(a.stage), t && t.full_name, t && t.job_title,
      consented(t) ? t.phone : "", consented(t) ? t.email : "", b.website]; });
  return "﻿" + [head].concat(rows).map((r) => r.map(q).join(",")).join("\n");
}

function stat(n, label) {
  return `<td style="padding:10px 6px;border:1px solid ${LINE};text-align:center;width:20%"><b style="font-size:22px;color:${GREEN}">${n}</b><br><span style="font-size:12px;color:#666">${label}</span></td>`;
}

// The report the organiser sees. No internal notes.
function organiserReport(c, x) {
  const rows = x.delegates.slice(0, 80).map((a) => { const b = a.businesses || {}, t = a.contacts;
    return `<tr><td style="padding:7px 8px;border-bottom:1px solid #eee"><b>${esc(b.name)}</b><br><span style="color:#666;font-size:12px">${esc([b.city, b.country].filter(Boolean).join(", "))}${b.sector ? " · " + esc(b.sector) : ""}</span></td>
<td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:13px">${esc(t ? t.full_name + (t.job_title ? ", " + t.job_title : "") : "")}</td>
<td style="padding:7px 8px;border-bottom:1px solid #eee">${gradePill(a)}</td>
<td style="padding:7px 8px;border-bottom:1px solid #eee;font-size:13px">${esc(stageName(a.stage))}</td></tr>`; }).join("");
  return `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;max-width:700px;margin:auto;color:#1a1714">
<div style="background:${GREEN};color:#fff;border-radius:12px 12px 0 0;padding:18px 20px">
<p style="margin:0;color:#e9d9a6;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">SAIS Events delegate report</p>
<h1 style="margin:4px 0 2px;font-size:22px">${esc(c.name)}</h1>
<p style="margin:0;color:#cfd8d4;font-size:13px">Week ending ${day(Date.now())}${c.city ? " · " + esc(c.city) : ""}${c.starts_on ? " · expo starts " + day(c.starts_on + "T00:00:00Z") : ""}</p></div>
<div style="border:1px solid ${LINE};border-top:0;border-radius:0 0 12px 12px;padding:18px 20px">
<table style="border-collapse:collapse;width:100%;margin:0 0 16px"><tr>${stat(c.target_delegates || "Open", "Target")}${stat(x.delegates.length, "Registered")}${stat(x.n("submitted") + x.n("approved") + x.n("attended"), "Sent to you")}${stat(x.n("approved") + x.n("attended"), "Approved")}${stat(x.newThisWeek, "New this week")}</tr></table>
<p style="margin:0 0 6px"><b>Profile quality:</b> ${x.grades.A} grade A (complete and verified), ${x.grades.B} grade B, ${x.grades.C} grade C.</p>
${x.delegates.length ? `<p style="margin:0 0 6px"><b>Countries:</b> ${tally(x.delegates.map((a) => (a.businesses || {}).country))}</p>
<p style="margin:0 0 16px"><b>Sectors:</b> ${tally(x.delegates.map((a) => (a.businesses || {}).sector), 6)}</p>` : ""}
${rows ? `<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="text-align:left;color:#666;font-size:12px;text-transform:uppercase;letter-spacing:.5px"><th style="padding:6px 8px">Company</th><th style="padding:6px 8px">Contact</th><th style="padding:6px 8px">Profile</th><th style="padding:6px 8px">Status</th></tr>${rows}</table>
<p style="margin:12px 0 0;color:#666;font-size:13px">Full list attached as ${esc(slug(c.name))}-delegates.csv. Profile score is out of 100 and checks that every registration detail is filled, the website opens and the WhatsApp number is a valid mobile line.</p>`
    : `<p style="color:#666">Recruitment is in progress. Registered delegates will appear here.</p>`}
<p style="margin:16px 0 0;font-size:13px;color:#666">SAIS Events, MICE, International Trade &amp; Business Events · <a href="https://saisevents.com" style="color:${GREEN}">saisevents.com</a></p>
</div></div>`;
}

// Up to 3 next actions for Kate, most urgent first.
function nextActions(c, x) {
  const acts = [];
  const left = c.registration_deadline ? Math.ceil((new Date(c.registration_deadline + "T23:59:59Z") - Date.now()) / 864e5) : null;
  if (left != null && left >= 0 && left <= 21) acts.push(`Registration closes on ${day(c.registration_deadline + "T00:00:00Z")}, ${plural(left, "day", "days")} left.`);
  const readyA = x.delegates.filter((a) => a.stage === "registered" && gradeOf(a) === "A").length;
  if (readyA) acts.push(`Send ${plural(readyA, "grade A delegate", "grade A delegates")} to the organiser.`);
  const notOn = x.delegates.filter((a) => !a.sc).length;
  if (notOn) acts.push(`Ask ${plural(notOn, "delegate", "delegates")} to register on MatchMarket.`);
  const weak = x.delegates.filter((a) => ["B", "C"].includes(gradeOf(a)) && ["registered", "submitted"].includes(a.stage)).length;
  if (weak) acts.push(`Chase ${plural(weak, "delegate", "delegates")} to complete their profiles.`);
  if (x.leadsPassed) acts.push(`Call ${plural(x.leadsPassed, "verified lead", "verified leads")} from this week's morning lists.`);
  const warm = x.n("interested");
  if (warm) acts.push(`Help ${plural(warm, "interested company", "interested companies")} register.`);
  const gap = (c.target_delegates || 0) - x.delegates.length;
  if (gap > 0) acts.push(`${plural(gap, "more delegate", "more delegates")} needed to reach the target of ${c.target_delegates}.`);
  return acts.slice(0, 3);
}

async function send(body) {
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: "SAIS Events <info@saisevents.com>", reply_to: ADMIN, ...body }),
  });
  if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
}

exports.handler = async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    const weekAgo = Date.now() - 7 * 864e5;
    const since = new Date(weekAgo).toISOString();
    const [camps, cos, scores, leads] = await Promise.all([
      sbGet("campaigns?select=id,name,organiser,city,country,starts_on,target_delegates,registration_deadline&status=in.(recruiting,planning)&order=starts_on.asc.nullslast"),
      sbGet("companies?select=id,business_id"),
      sbGet("company_scores?select=company_id,score,grade"),
      sbGet(`leads?select=expo,analyst_pass&created_at=gte.${since}`),
    ]);
    const scoreBy = new Map(scores.map((s) => [s.company_id, s]));
    const scoreByBiz = new Map(cos.filter((c) => c.business_id && scoreBy.has(c.id)).map((c) => [c.business_id, scoreBy.get(c.id)]));

    const summary = [];
    let reports = 0;
    for (const c of camps) {
      const apps = await sbGet(`applications?select=stage,business_id,stage_changed_at,businesses(name,country,city,sector,makes,website),contacts!applications_contact_id_fkey(full_name,job_title,phone,email,consent_status)&campaign_id=eq.${c.id}`);
      const myLeads = leads.filter((l) => l.expo === c.name);
      if (!apps.length && !myLeads.length) continue;
      apps.forEach((a) => (a.sc = scoreByBiz.get(a.business_id)));
      const n = (k) => apps.filter((a) => a.stage === k).length;
      const delegates = apps.filter((a) => DELEGATE.includes(a.stage) && a.stage !== "declined")
        .sort((a, b) => rankOf(b) - rankOf(a) || DELEGATE.indexOf(b.stage) - DELEGATE.indexOf(a.stage));
      const grades = { A: 0, B: 0, C: 0 };
      delegates.forEach((a) => { if (a.sc) grades[a.sc.grade]++; });
      const x = { n, delegates, grades, newThisWeek: delegates.filter((a) => new Date(a.stage_changed_at).getTime() >= weekAgo).length,
        leadsFound: myLeads.length, leadsPassed: myLeads.filter((l) => l.analyst_pass).length, pipeline: n("found") + n("contacted") + n("interested") };
      const acts = nextActions(c, x);
      summary.push({ c, x, acts });

      if (!delegates.length) continue;
      const to = [ADMIN].concat(CINDY.expos.includes(c.name) ? [CINDY.to] : []);
      await send({ to, subject: `${c.name}: delegate report, week ending ${day(Date.now())}`, html: organiserReport(c, x),
        attachments: [{ filename: `${slug(c.name)}-delegates.csv`, content: Buffer.from(csvFor(c, delegates), "utf8").toString("base64") }] });
      reports++;
    }
    if (!summary.length) return { statusCode: 200, body: "no campaign activity" };

    // One card per expo: numbers, then the next actions. Cards stack well on a phone.
    const cards = summary.map(({ c, x, acts }) => `<div style="border:1px solid ${LINE};border-left:4px solid ${GOLD};border-radius:10px;padding:12px 14px;margin:0 0 12px">
<b style="font-size:16px;color:${GREEN}">${esc(c.name)}</b>
<p style="margin:4px 0 0;font-size:14px">Delegates <b>${x.delegates.length}</b>${c.target_delegates ? ` of ${c.target_delegates}` : ""}${x.newThisWeek ? ` <span style="color:#1d6b3a">(+${x.newThisWeek} this week)</span>` : ""} · Grade A <b>${x.grades.A}</b>, B <b>${x.grades.B}</b>, C <b>${x.grades.C}</b></p>
<p style="margin:2px 0 0;font-size:14px">Sent to organiser <b>${x.n("submitted") + x.n("approved") + x.n("attended")}</b> · In pipeline <b>${x.pipeline}</b> · Leads <b>${x.leadsFound}</b> found, <b>${x.leadsPassed}</b> verified</p>
${acts.length ? `<ol style="margin:8px 0 0;padding-left:20px;font-size:14px">${acts.map((a) => `<li>${esc(a)}</li>`).join("")}</ol>` : ""}</div>`).join("");
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;max-width:720px;margin:auto;color:#1a1714">
<div style="background:${GREEN};color:#fff;border-radius:12px;padding:18px 20px;margin:0 0 18px">
<p style="margin:0;color:#e9d9a6;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Internal summary, do not forward</p>
<h1 style="margin:4px 0 2px;font-size:22px">All expos this week</h1>
<p style="margin:0;color:#cfd8d4;font-size:13px">Week ending ${day(Date.now())} · ${plural(reports, "organiser report", "organiser reports")} sent in separate emails, ready to forward</p></div>
<h2 style="font-size:18px;margin:0 0 12px;color:${GREEN}">Numbers and next actions</h2>
${cards}
<p style="margin:8px 0 0;color:#666;font-size:12px">New this week counts delegates who registered or moved up in the last 7 days. Leads are from the finder and analyst over the same 7 days.</p>
</div>`;
    await send({ to: [ADMIN], subject: `Weekly expo summary: ${day(Date.now())}`, html });
    return { statusCode: 200, body: `summary + ${reports} reports` };
  } catch (e) {
    console.log("weekly-report error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
