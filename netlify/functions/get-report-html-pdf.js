// /.netlify/functions/get-report-html-pdf.js
import fetch from "node-fetch";

const FETCH_TIMEOUT_MS = 20000;

export async function handler(event) {
  try {
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    if (event.httpMethod !== "GET") {
      return {
        statusCode: 405,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "Method not allowed",
      };
    }

    const reportId = String(
      event.queryStringParameters?.report_id || event.queryStringParameters?.reportId || ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "Missing report_id",
      };
    }

    const siteUrl = (process.env.URL || "https://iqweb.ai").replace(/\/+$/, "");
    const dataUrl = `${siteUrl}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(
      reportId
    )}`;

    const payloadText = await fetchTextWithTimeout(dataUrl, FETCH_TIMEOUT_MS);
    const payload = JSON.parse(payloadText);

    if (!payload || payload.success !== true) {
      throw new Error("get-report-data returned success=false");
    }

    const { header, branding, delivery_signals, scores, narrative } = payload;

    const website = header.website;
    const rid = header.report_id;
    const createdAt = formatDate(header.created_at);

    const companyName = branding.agency_name || "iQWEB";
    const logoUrl = branding.agency_logo_url || "";
    const showHeaderContact = !!branding.show_header_contact;
    const showFooterContact = !!branding.show_footer_contact;
    const showPoweredBy = !!branding.show_powered_by;

    const keyFindings = buildKeyFindings(payload, scores, delivery_signals);
    const signalCards = buildSignalCards(delivery_signals);

    // HTML for PDF
    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Website Report — ${rid}</title>
<style>
  @page { size: A4 landscape; margin: 8mm; }
  body { font-family: Arial, Helvetica, sans-serif; background: #061122; color: #e8eefc; margin:0; padding:0; }
  .page { padding: 10px; width: 100%; min-height: 100%; }
  .header, .footer { width: 100%; padding: 10px 0; }
  .header { display:flex; justify-content: space-between; align-items: center; }
  .logo img { max-height: 50px; }
  .company { font-size: 14px; font-weight: bold; }
  .meta { display:flex; gap:20px; margin-top:10px; }
  .meta div { font-size:12px; }
  .section { background: #08142a; border-radius: 8px; padding: 10px; margin:10px 0; }
  .section h3 { font-size: 12px; margin: 0 0 5px 0; text-transform: uppercase; }
  .finding-row { margin-bottom:5px; font-size:11px; }
  .signals-grid { display:flex; flex-wrap:wrap; gap:10px; margin-top:10px; }
  .signal-card { flex:1 1 calc(33% - 10px); background:#0b1a37; border-radius:6px; padding:8px; font-size:10px; }
  .signal-name { font-weight: bold; margin-bottom:3px; }
  .score-bar { height:6px; background:rgba(255,255,255,0.1); border-radius:3px; margin:4px 0; }
  .score-fill { height:100%; border-radius:3px; background: linear-gradient(90deg,#29d3f1 0%,#3ac364 100%); }
  .footer { font-size: 10px; display:flex; justify-content:space-between; }
</style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="logo">${logoUrl ? `<img src="${logoUrl}" alt="${companyName}"/>` : ""}</div>
      <div class="company">${companyName}</div>
    </div>

    <div class="meta">
      <div>Website: ${website}</div>
      <div>Report ID: ${rid}</div>
      <div>Report Date: ${createdAt}</div>
    </div>

    <div class="section">
      <h3>Key Findings</h3>
      ${keyFindings
        .map(
          (f) =>
            `<div class="finding-row"><strong>${f.label}:</strong> ${f.value}</div>`
        )
        .join("")}
    </div>

    <div class="section">
      <h3>Delivery Signals</h3>
      <div class="signals-grid">${signalCards}</div>
    </div>

    <div class="footer">
      <div>${showFooterContact ? companyName : ""}</div>
      <div>${showPoweredBy ? "Powered by iQWEB" : ""}</div>
    </div>
  </div>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/html",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf]", err);
    return { statusCode: 500, headers: corsHeaders(), body: String(err) };
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  return fetch(url, { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal })
    .then((r) => r.text())
    .finally(() => clearTimeout(id));
}

function formatDate(v) {
  if (!v) return "";
  const d = new Date(v);
  return `${d.getDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getMonth()]} ${d.getFullYear()}, ${d.getHours()}:${String(d.getMinutes()).padStart(2,"0")}`;
}

function buildKeyFindings(payload, scores, delivery_signals) {
  return [
    { label: "Overall Delivery", value: scores.overall + "/100 — Good" },
    { label: "Primary Constraint", value: delivery_signals.find((s) => s.score < 60)?.label || "N/A" },
    { label: "Impact", value: delivery_signals.find((s) => s.score < 60)?.observations.map(o=>o.value).join("; ") || "No major issues detected" },
    { label: "Recommended Fix", value: delivery_signals.find((s)=>s.score<60)?.observations.map(o=>o.value).join("; ") || "No action required" },
    { label: "Next Step", value: "Review lowest scoring areas and re-scan to validate." }
  ];
}

function buildSignalCards(signals) {
  return signals
    .map((s) => `<div class="signal-card">
      <div class="signal-name">${s.label}</div>
      <div class="score-bar"><div class="score-fill" style="width:${s.score || 0}%"></div></div>
      <div>${s.score}</div>
      <div>${s.observations.map((o) => o.value).join("; ")}</div>
    </div>`)
    .join("");
}