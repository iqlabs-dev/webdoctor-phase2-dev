// netlify/functions/generate-report-pdf.js
//
// Render a dedicated PDF page (report_pdf.html) via DocRaptor with JS enabled.
// This avoids modifying OSD report.html and lets us include PDF-only polyfills safely.
//
// Env:
// - DOC_RAPTOR_API_KEY (preferred) or DOCRAPTOR_API_KEY

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

function corsPreflight() {
  return {
    statusCode: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
      "Cache-Control": "no-store",
    },
    body: "",
  };
}

function getSiteUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { success: false, error: "Invalid JSON body" });
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    if (!reportId) return json(400, { success: false, error: "Missing reportId" });

    const apiKey = process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) return json(500, { success: false, error: "DocRaptor API key is not set" });

    const siteUrl = getSiteUrl(event);

    // ✅ Dedicated PDF page (do NOT use report.html)
    const reportPageUrl =
      `${siteUrl}/report_pdf.html` +
      `?report_id=${encodeURIComponent(reportId)}` +
      `&from=history` +
      `&pdf=1`;

    // Probe first so we get a useful error if the page isn't deployed
    const probe = await fetch(reportPageUrl, { method: "GET" });
    const probeText = await probe.text().catch(() => "");
    if (!probe.ok) {
      return json(500, {
        success: false,
        error: "report_pdf.html not reachable (DocRaptor would fail too)",
        status: probe.status,
        url: reportPageUrl,
        details: probeText.slice(0, 1500),
      });
    }

    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `${reportId}.pdf`,
          test: false,
          document_type: "pdf",
          document_url: reportPageUrl,

          // Must be true so report-data.js renders the page
          javascript: true,

          // Wait for docraptorJavaScriptFinished() gate
          wait_for_javascript: true,

          prince_options: { media: "print" },
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      return json(500, {
        success: false,
        error: "DocRaptor error",
        status: drResp.status,
        details: errText.slice(0, 3000),
        reportPageUrl,
      });
    }

    const arrayBuffer = await drResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return json(500, { success: false, error: err?.message || "Unknown error" });
  }
};
