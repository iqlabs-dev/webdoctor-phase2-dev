// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  try {
    const reportId =
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.reportId;

    if (!reportId) {
      return { statusCode: 400, body: "Missing report_id" };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const resp = await fetch(dataUrl);
    if (!resp.ok) {
      return { statusCode: 500, body: "Failed to fetch report data" };
    }

    const json = await resp.json();

    /* ---------------- Helpers ---------------- */

    const esc = (s) =>
      String(s ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");

    const formatDateTime = (iso) => {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d)) return "";
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
      });
    };

    const lineify = (v) =>
      Array.isArray(v) ? v.filter(Boolean) : [];

    /* ---------------- Data ---------------- */

    const header = json.header || {};
    const narrative = json.narrative || {};
    const execLines = lineify(narrative?.overall?.lines);

    /* ---------------- HTML ---------------- */

    const css = `
      @page { size: A4; margin: 14mm; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
      }

      .brand {
        font-weight: 700;
        font-size: 14px;
      }

      .sub {
        font-size: 10px;
        color: #555;
        margin-top: 2px;
      }

      .website {
        font-size: 10px;
        margin-top: 6px;
        word-break: break-all;
      }

      .meta {
        font-size: 10px;
        text-align: right;
        line-height: 1.4;
      }

      .hr { border-top: 1px solid #ddd; margin: 12px 0; }

      .footer {
        margin-top: 18px;
        font-size: 9px;
        color: #666;
        display: flex;
        justify-content: space-between;
      }
    `;

    const executiveSection =
      execLines.length > 0
        ? `
        <h2>Executive Narrative</h2>
        <ul>
          ${execLines.map((l) => `<li>${esc(l)}</li>`).join("")}
        </ul>
      `
        : "";

    const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>iQWEB Website Report — ${esc(header.report_id || reportId)}</title>
<style>${css}</style>
</head>
<body>

<div class="topbar">
  <div>
    <div class="brand">iQWEB</div>
    <div class="sub">Powered by Λ i Q™</div>
    ${
      header.website
        ? `<div class="website">Website: ${esc(header.website)}</div>`
        : ""
    }
  </div>

  <div class="meta">
    <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
    <div><strong>Report Date:</strong> ${esc(
      formatDateTime(header.created_at)
    )}</div>
  </div>
</div>

<div class="hr"></div>

${executiveSection}

<div class="footer">
  <div>© 2025 iQWEB — All rights reserved.</div>
  <div>${esc(header.report_id || reportId)}</div>
</div>

</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: html,
    };
  } catch (err) {
    console.error(err);
    return { statusCode: 500, body: "PDF render error" };
  }
};
