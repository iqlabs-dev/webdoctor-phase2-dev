// netlify/functions/generate-report-pdf.js
//
// Generates PDF via DocRaptor by rendering the REAL on-screen report page
// (report.html + report-data.js), so PDF matches what users see.
//
// Requires env:
// - DOC_RAPTOR_API_KEY (recommended)
//   (We also support DOCRAPTOR_API_KEY to avoid Netlify env mismatches)
//
// This function now renders:
//   ${siteUrl}/report.html?report_id=...&from=history&pdf=1
//
// IMPORTANT:
// - Your report page MUST call window.docraptorJavaScriptFinished()
//   and return true once fully rendered (you already have this gate in report_template.html).
// - Your report page should expand evidence when pdf=1 (you already do this).

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
  // Netlify provides process.env.URL for the production domain
  if (process.env.URL) return process.env.URL;

  // Fallback for preview/local-ish contexts
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") return corsPreflight();

  // Enforce POST
  if (event.httpMethod !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { success: false, error: "Invalid JSON body" });
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    if (!reportId) return json(400, { success: false, error: "Missing reportId" });

    // ✅ Support BOTH env var names to prevent Netlify mismatch 500s
    const apiKey = process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) return json(500, { success: false, error: "DocRaptor API key is not set" });

    const siteUrl = getSiteUrl(event);

    // ✅ Render the REAL on-screen report page, in PDF mode
    // - from=history ensures the page hides Back/Refresh and shows PDF-related behaviors (your template already does this)
    // - pdf=1 triggers PDF mode (opens evidence, etc.)
    //
    // NOTE: adjust "report.html" if your actual report page path differs.
    const reportPageUrl =
      `${siteUrl}/report.html` +
      `?report_id=${encodeURIComponent(reportId)}` +
      `&from=history` +
      `&pdf=1`;

    // ✅ Hard check: make sure the report page returns 200 BEFORE calling DocRaptor
    const probe = await fetch(reportPageUrl, { method: "GET" });
    const probeText = await probe.text().catch(() => "");
    if (!probe.ok) {
      return json(500, {
        success: false,
        error: "Report page URL failed (DocRaptor would fail too)",
        status: probe.status,
        url: reportPageUrl,
        details: probeText.slice(0, 1500),
      });
    }

    // Call DocRaptor: render URL with JS enabled and wait for your gate
    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `${reportId}.pdf`,
          test: false,
          document_type: "pdf",
          document_url: reportPageUrl,

          // ✅ MUST be true to allow report-data.js to render the full on-screen report
          javascript: true,

          // ✅ Wait for window.docraptorJavaScriptFinished() to return true
          // (DocRaptor supports this convention when javascript is enabled)
          wait_for_javascript: true,

          // Give the report time to fetch PSI + render evidence
          // (Your page also has a 30s hard-safety to prevent infinite hang)
          // DocRaptor-specific timeout (seconds)
          // NOTE: If your plan enforces a max, keep this reasonable.
          // You can remove this field if you want default behavior.
          // timeout: 60,

          prince_options: {
            media: "print",
          },
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
