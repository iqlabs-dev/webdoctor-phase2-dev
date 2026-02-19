// netlify/functions/docraptor-pdf.js
// Backwards-compatible endpoint.
//
// Historically, some front-end code may POST { html, reportId } to this function.
// That approach breaks with DocRaptor's JS engine (Promise/fetch missing).
//
// New behavior:
// - If reportId is provided, we ignore html and generate via generate-report-pdf (JS disabled).
// - If only html is provided, we still support it, but we force javascript=false.

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { success: false, error: "Invalid JSON body" });
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    const html = body.html;

    // Preferred path: generate from server HTML endpoint.
    if (reportId) {
      const proto = event.headers?.["x-forwarded-proto"] || "https";
      const host = event.headers?.host || "iqweb.ai";
      const baseUrl = process.env.URL || `${proto}://${host}`;

      const resp = await fetch(`${baseUrl}/.netlify/functions/generate-report-pdf`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });

      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        return json(500, { success: false, error: "Failed to generate PDF", status: resp.status, details: txt.slice(0, 2000) });
      }

      const buf = Buffer.from(await resp.arrayBuffer());
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
          "Cache-Control": "no-store",
        },
        body: buf.toString("base64"),
      };
    }

    // Fallback path: accept raw HTML, but do NOT allow JS.
    if (!html) {
      return json(400, { success: false, error: "Missing reportId or html" });
    }

    const apiKey = process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) {
      return json(500, { success: false, error: "DOC_RAPTOR_API_KEY is not set" });
    }

    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `report.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: false,
          wait_for_javascript: false,
          prince_options: { media: "print" },
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      return json(500, { success: false, error: "DocRaptor error", status: drResp.status, details: errText.slice(0, 3000) });
    }

    const buf = Buffer.from(await drResp.arrayBuffer());
    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=report.pdf",
        "Cache-Control": "no-store",
      },
      body: buf.toString("base64"),
    };
  } catch (err) {
    console.error("[docraptor-pdf] crash:", err);
    return json(500, { success: false, error: err?.message || "Unknown error" });
  }
};
