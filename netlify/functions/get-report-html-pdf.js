// netlify/functions/get-report-html-pdf.js
// Returns a fully rendered HTML document for PDF printing (NO JS required).
// DocRaptor will print this directly.
//
// This endpoint MUST support GET because:
// - Browsers hit it via GET
// - DocRaptor fetches URLs via GET
//
// It calls your JSON endpoint get-report-data-pdf to obtain data.

exports.handler = async (event) => {
  // --- CORS / preflight safety (harmless even if not needed) ---
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  // --- Enforce GET (this removes the “mystery 405” loop) ---
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Allow": "GET, OPTIONS",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const reportId =
      (event.queryStringParameters?.report_id ||
        event.queryStringParameters?.reportId ||
        "").trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Missing report_id",
      };
    }

    // Call your existing JSON endpoint (server-side)
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl = `${siteUrl}/.netlify/functions/get-report-data-pdf?report_id=${encodeURIComponent(
      reportId
    )}`;

    const resp = await fetch(dataUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      const t = await resp.text().catch(() => "");
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: `Failed to fetch report data (${resp.status}): ${t}`,
      };
    }

    const json = await resp.json();

    // Defensive reads (shape may vary depending on your endpoint)
    const header = json?.header || {};
    const scores = json?.scores || json?.metrics?.scores || {};
    const narrative =
      json?.narrative?.overall?.lines ||
      json?.narrative?.overall ||
      json?.report?.narrative?.overall?.lines ||
      [];

    const website = header.website || json?.report?.url || "";
    const createdAt = header.created_at || json?.report?.created_at || "";
    const rid = header.report_id || json?.report?.report_id || reportId;

    const lineify = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "string")
        return v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      return [];
    };

    const narrativeLines = lineify(narrative);

    const s = (k, fallback = "") => {
      const v = scores?.[k];
      if (v === 0) return "0";
      return v ? String(v) : fallback;
    };

    const esc = (str) =>
      String(str ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>iQWEB Website Report — ${esc(rid)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>

  <style>
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 0; }
    .topbar { display:flex; justify-content:space-between; align-items:flex-end; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
    .brand { font-size: 18px; font-weight: 700; letter-spacing: .2px; }
    .meta { font-size: 11px; text-align:right; line-height: 1.4; }
    .label { font-weight:700; }
    .section { margin: 14px 0; }
    .h { font-size: 13px; font-weight: 800; margin: 0 0 8px; text-transform: uppercase; letter-spacing: .6px; }
    .grid { display:grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .card { border:1px solid #111; border-radius: 8px; padding: 10px; }
    .card .t { font-size: 12px; font-weight: 800; margin-bottom: 6px; text-transform: uppercase; }
    .score { font-size: 22px; font-weight: 800; }
    .muted { font-size: 10px; color:#444; margin-top: 6px; line-height: 1.35; }
    ul { margin: 8px 0 0 18px; padding: 0; }
    li { font-size: 11px; margin: 4px 0; }
    .footer { border-top: 1px solid #111; margin-top: 16px; padding-top: 10px; font-size: 10px; color:#333; display:flex; justify-content:space-between; }
  </style>
</head>
<body>

  <div class="topbar">
    <div>
      <div class="brand">iQWEB</div>
      <div style="font-size:11px;margin-top:2px;">Powered by Λ i Q™</div>
    </div>
    <div class="meta">
      <div><span class="label">Website:</span> ${esc(website)}</div>
      <div><span class="label">Report ID:</span> ${esc(rid)}</div>
      <div><span class="label">Report Date:</span> ${esc(createdAt)}</div>
    </div>
  </div>

  <div class="section">
    <div class="h">Executive Narrative</div>
    ${
      narrativeLines.length
        ? `<ul>${narrativeLines.map((ln) => `<li>${esc(ln)}</li>`).join("")}</ul>`
        : `<div style="font-size:11px;color:#444;">Narrative not available for this report.</div>`
    }
  </div>

  <div class="section">
    <div class="h">Delivery Signals</div>
    <div class="grid">
      <div class="card">
        <div class="t">Overall</div>
        <div class="score">${esc(s("overall", "—"))}</div>
        <div class="muted">Overall delivery score (deterministic checks).</div>
      </div>
      <div class="card">
        <div class="t">Performance</div>
        <div class="score">${esc(s("performance", "—"))}</div>
        <div class="muted">Speed and performance indicators.</div>
      </div>
      <div class="card">
        <div class="t">Mobile Experience</div>
        <div class="score">${esc(s("mobile", "—"))}</div>
        <div class="muted">Mobile readiness and UX signals.</div>
      </div>
      <div class="card">
        <div class="t">SEO Foundations</div>
        <div class="score">${esc(s("seo", "—"))}</div>
        <div class="muted">Basic SEO structure and metadata.</div>
      </div>
      <div class="card">
        <div class="t">Security & Trust</div>
        <div class="score">${esc(s("security", "—"))}</div>
        <div class="muted">HTTPS and security header presence.</div>
      </div>
      <div class="card">
        <div class="t">Accessibility</div>
        <div class="score">${esc(s("accessibility", "—"))}</div>
        <div class="muted">Accessibility checks and warnings.</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div>© 2025 iQWEB — All rights reserved.</div>
    <div>${esc(rid)}</div>
  </div>

</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err?.message || "Unknown error" }),
    };
  }
};
