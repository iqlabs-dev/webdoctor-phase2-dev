/* eslint-disable */
/**
 * netlify/functions/generate-report-pdf.js
 *
 * Generates PDF via DocRaptor by rendering the SAME report.html used by OSD (JS enabled).
 *
 * Inputs: { report_id } or { reportId }
 * Output: PDF bytes (base64)
 *
 * Env:
 * - DOC_RAPTOR_API_KEY
 *
 * Notes:
 * - We render /report.html?report_id=...&from=pdf&pdf=1
 * - javascript + wait_for_javascript MUST be true so the OSD JS renderer runs.
 */

function json(statusCode, obj) {
  return {
    statusCode: statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
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

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        Allow: "POST, OPTIONS",
      },
      body: JSON.stringify({ success: false, error: "method_not_allowed" }),
    };
  }

  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return json(400, { success: false, error: "invalid_json" });
    }

    const reportId = String(body.report_id || body.reportId || "").trim();
    if (!reportId) return json(400, { success: false, error: "missing_report_id" });

    const apiKey = process.env.DOC_RAPTOR_API_KEY || "";
    if (!apiKey) return json(500, { success: false, error: "DOC_RAPTOR_API_KEY_missing" });

    // Netlify runtime base URL
    const siteUrl = process.env.URL || "https://iqweb.ai";

    // ✅ Single source of truth: render the same report.html used by the online view
    // pdf=1 forces light/print-friendly mode; from=pdf hides interactive controls
    const pdfHtmlUrl = `${siteUrl}/report.html?report_id=${encodeURIComponent(reportId)}&from=pdf&pdf=1`;

    // Build DocRaptor request
    const payload = {
      user_credentials: apiKey,
      doc: {
        document_type: "pdf",
        name: `${reportId}.pdf`,
        test: false,

        // DocRaptor will fetch this URL and render it
        document_url: pdfHtmlUrl,

        // ✅ Execute JS so report.html can render the full OSD content
        javascript: true,
        wait_for_javascript: true,

        // Media for print rules (if any
        prince_options: { media: "print" },
      },
    };

    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify(payload),
    });

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      return json(500, {
        success: false,
        error: "docraptor_error",
        status: resp.status,
        details: txt.slice(0, 1500),
      });
    }

    const pdfArrayBuffer = await resp.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (e) {
    return json(500, { success: false, error: "pdf_generation_failed" });
  }
};