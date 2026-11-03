// SAIS weekly campaign report. Runs every Friday at 8am Nairobi time (05:00 UTC, see netlify.toml).
// Emails info@saisevents.com one section per recruiting campaign, ready to forward to the organiser,
// with a CSV of that campaign's registered delegates attached.
// Contact phones and emails are included only where the person gave consent.
// Needs: SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY.

const SB = "https://hbobppslyikleonzvzxp.supabase.co";
const ADMIN = "info@saisevents.com";
const STAGES = [["found", "Found"], ["contacted", "Contacted"], ["interested", "Interested"], ["not_interested", "Not interested"],
  ["registered", "Registered"], ["submitted", "Sent to organiser"], ["approved", "Approved"], ["declined", "Declined"], ["attended", "Attended"]];
const DELEGATE = ["registered", "submitted", "approved", "declined", "attended"];

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

function csvFor(apps) {
  const q = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const head = ["Company", "Country", "City", "Activities", "Makes or sells", "Stage", "Contact", "Job title", "Contact phone", "Contact email", "Website", "Decision date"];
  const rows = apps.map((a) => { const b = a.businesses || {}, t = a.contacts; return [b.name, b.country, b.city, b.sector, b.makes, stageName(a.stage),
    t && t.full_name, t && t.job_title, consented(t) ? t.phone : "", consented(t) ? t.email : "", b.website, a.decision_at]; });
  return "﻿" + [head].concat(rows).map((r) => r.map(q).join(",")).join("\n");
}

exports.handler = async () => {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.RESEND_API_KEY) return { statusCode: 200, body: "missing keys" };
  try {
    const camps = await sbGet("campaigns?select=id,name,organiser,city,country,starts_on,target_delegates,report_day&status=eq.recruiting&order=starts_on.asc.nullslast");
    const weekAgo = Date.now() - 7 * 864e5;
    const sections = [], attachments = [];
    for (const c of camps) {
      const apps = await sbGet(`applications?select=stage,created_at,stage_changed_at,decision_at,businesses(name,country,city,sector,makes,website),contacts!applications_contact_id_fkey(full_name,job_title,phone,email,consent_status)&campaign_id=eq.${c.id}`);
      if (!apps.length) continue;
      const n = (k) => apps.filter((a) => a.stage === k).length;
      const delegates = apps.filter((a) => DELEGATE.includes(a.stage)).sort((a, b) => DELEGATE.indexOf(b.stage) - DELEGATE.indexOf(a.stage));
      const newThisWeek = delegates.filter((a) => new Date(a.stage_changed_at).getTime() >= weekAgo).length;
      const counts = STAGES.filter(([k]) => DELEGATE.includes(k) && n(k)).map(([k, l]) => `<td style="padding:6px 10px;border:1px solid #e3ddd2;text-align:center"><b style="font-size:18px">${n(k)}</b><br><span style="font-size:12px;color:#666">${l}</span></td>`).join("");
      const rows = delegates.slice(0, 60).map((a) => { const b = a.businesses || {}, t = a.contacts;
        return `<tr><td style="padding:5px 8px;border-bottom:1px solid #eee"><b>${esc(b.name)}</b><br><span style="color:#666;font-size:12px">${esc([b.city, b.country].filter(Boolean).join(", "))}</span></td><td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(t ? t.full_name + (t.job_title ? ", " + t.job_title : "") : "")}</td><td style="padding:5px 8px;border-bottom:1px solid #eee">${esc(stageName(a.stage))}</td></tr>`; }).join("");
      sections.push(`<div style="border:1px solid #e3ddd2;border-radius:12px;padding:18px;margin:0 0 22px">
<p style="margin:0;color:#8a6a12;font-size:12px;font-weight:bold;letter-spacing:1px;text-transform:uppercase">Forward this section to ${esc(c.organiser || "the organiser")}</p>
<h2 style="margin:6px 0 2px">${esc(c.name)}: weekly delegate report</h2>
<p style="margin:0 0 12px;color:#555">Week ending ${day(Date.now())}${c.city ? " · " + esc(c.city) : ""}${c.starts_on ? " · expo starts " + day(c.starts_on + "T00:00:00Z") : ""}</p>
<p style="margin:0 0 10px"><b>${delegates.length}</b> delegate registrations so far${c.target_delegates ? ` against a target of <b>${c.target_delegates}</b>` : ""}, <b>${newThisWeek}</b> new or updated this week. <b>${n("approved") + n("attended")}</b> approved.</p>
<table style="border-collapse:collapse;margin:0 0 14px"><tr>${counts}</tr></table>
${rows ? `<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="text-align:left;color:#666;font-size:12px"><th style="padding:5px 8px">Company</th><th style="padding:5px 8px">Contact</th><th style="padding:5px 8px">Status</th></tr>${rows}</table>` : `<p style="color:#666">No registrations yet. Recruitment is in progress.</p>`}
<p style="margin:12px 0 0;color:#666;font-size:13px">Full list attached as ${esc(c.name.replace(/[^A-Za-z0-9]+/g, "-"))}-delegates.csv.</p>
</div>`);
      if (delegates.length) attachments.push({ filename: `${c.name.replace(/[^A-Za-z0-9]+/g, "-")}-delegates.csv`, content: Buffer.from(csvFor(delegates), "utf8").toString("base64") });
    }
    if (!sections.length) return { statusCode: 200, body: "no campaign activity" };
    const html = `<div style="font-family:Arial,sans-serif;font-size:15px;max-width:680px;margin:auto;color:#1a1714">
<p style="color:#666;margin:0 0 16px">Your Friday campaign reports. Check each one, then forward its section and CSV to the organiser. Contact phones and emails appear only where the delegate gave consent.</p>
${sections.join("\n")}</div>`;
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: "SAIS Events <info@saisevents.com>", to: [ADMIN], subject: `Weekly delegate reports: ${day(Date.now())}`, html, attachments }),
    });
    if (!r.ok) throw new Error(`Resend ${r.status}: ${await r.text()}`);
    return { statusCode: 200, body: `sent ${sections.length} reports` };
  } catch (e) {
    console.log("weekly-report error", e && e.message);
    return { statusCode: 200, body: "error" };
  }
};
