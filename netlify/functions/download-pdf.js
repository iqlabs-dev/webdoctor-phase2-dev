// netlify/functions/download-pdf.j
// iQWEB PDF Download Orchestrator — v2 (binary-safe)
// - Accepts { reportId } or { report_id }
// - Calls generate-report-pdf to build the PDF (DocRaptor)
// - Returns the PDF as binary (base64 encoded) to the browser
// - Does NOT read/write any scan_results.pdf_base64 column

const { Buffer } = require("buffer");

exports.handler = async (event) => {
  try {
    // Only allow POST
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ success: false, error: "Method not allowed" }),
      };
    }

    const body = safeJson(event.body);
    const reportId = (body.reportId || body.report_id || "").trim();

    if (!reportId) {
      return json(400, { success: false, error: "Missing reportId" });
    }

    // IMPORTANT:
    // Call your internal PDF generator function endpoint.
    // Use the internal Netlify path (works in production and locally on Netlify)
    const baseUrl = getBaseUrl(event);
    const genUrl = `${baseUrl}/.netlify/functions/generate-report-pdf`;

    const genRes = await fetch(genUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportId }),
    });

    if (!genRes.ok) {
      const txt = await genRes.text().catch(() => "");
      console.error("[download-pdf] generate-report-pdf failed:", genRes.status, txt);
      return json(502, { success: false, error: "PDF generation failed" });
    }

    // generate-report-pdf should return a PDF binary body.
    // Read it as ArrayBuffer and return it as base64-encoded binary.
    const buf = Buffer.from(await genRes.arrayBuffer());

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
  } catch (err) {
    console.error("[download-pdf] fatal:", err);
    return json(500, { success: false, error: "Server error" });
  }
};

function safeJson(s) {
  try {
    return s ? JSON.parse(s) : {};
  } catch {
    return {};
  }
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

// Works for prod + deploy previews + local netlify dev
function getBaseUrl(event) {
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}
