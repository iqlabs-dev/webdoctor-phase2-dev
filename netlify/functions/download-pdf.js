// netlify/functions/download-pdf.js
import fetch from "node-fetch";

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const reportId = event.queryStringParameters?.report_id || "";
    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const baseUrl = getBaseUrl(event);

    const res = await fetch(
      `${baseUrl}/.netlify/functions/generate-report-pdf`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }), // ✅ FIX
      }
    );

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[download-pdf] generate-report-pdf failed:", res.status, txt);
      return json(502, { success: false, error: "Failed to generate PDF" });
    }

    const pdfBuffer = Buffer.from(await res.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[download-pdf] error:", err);
    return json(500, { success: false, error: "Unexpected server error" });
  }
};
