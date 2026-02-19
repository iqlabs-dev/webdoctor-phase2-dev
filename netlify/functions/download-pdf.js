// netlify/functions/download-pdf.js
// Simple GET wrapper around generate-report-pdf.
// Returns a real PDF response (not JSON) so the browser downloads cleanly.

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

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers?.["x-forwarded-proto"] || "https";
  const host = event.headers?.host;
  return `${proto}://${host}`;
}

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const reportId = String(event.queryStringParameters?.report_id || event.queryStringParameters?.reportId || "").trim();
    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const baseUrl = getBaseUrl(event);
    const res = await fetch(`${baseUrl}/.netlify/functions/generate-report-pdf`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: reportId }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[download-pdf] generate-report-pdf failed:", res.status, txt);
      return json(502, { success: false, error: "Failed to generate PDF", status: res.status, details: txt.slice(0, 2000) });
    }

    const buf = Buffer.from(await res.arrayBuffer());
    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: buf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[download-pdf] crash:", err);
    return json(500, { success: false, error: err?.message || "Unexpected server error" });
  }
};
