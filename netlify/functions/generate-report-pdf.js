// netlify/functions/generate-report-pdf.js
import fetch from "node-fetch";

function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
  };
}

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL; // Netlify sets this
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

export const handler = async (event) => {
  try {
    // Preflight
    if (event.httpMethod === "OPTIONS") {
      return { statusCode: 204, headers: corsHeaders(), body: "" };
    }

    if (event.httpMethod !== "POST" && event.httpMethod !== "GET") {
      return json(
        405,
        { success: false, error: "Method not allowed" },
        corsHeaders()
      );
    }

    let reportId = "";

    if (event.httpMethod === "GET") {
      reportId = event.queryStringParameters?.report_id || "";
    } else {
      const body = event.body ? JSON.parse(event.body) : {};
      reportId = body?.report_id || "";
    }

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" }, corsHeaders());
    }

    const DOCRAPTOR_API_KEY = process.env.DOCRAPTOR_API_KEY || "";
    if (!DOCRAPTOR_API_KEY) {
      return json(500, { success: false, error: "DOCRAPTOR_API_KEY missing" }, corsHeaders());
    }

    const baseUrl = getBaseUrl(event);

    // IMPORTANT: render the server-built HTML doc (no JS)
    const documentUrl = `${baseUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(
      reportId
    )}`;

    // DocRaptor Create Doc endpoint (PDF)
    const apiUrl = "https://docraptor.com/docs";

    const payload = {
      doc: {
        document_type: "pdf",
        name: `${reportId}.pdf`,
        document_url: documentUrl,
        // critical: don’t run JS (avoids Promise error entirely)
        javascript: false,
        // give it time if needed
        // (DocRaptor will still fetch quickly because our HTML is server-rendered)
        test: process.env.DOCRAPTOR_TEST === "true",
      },
    };

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${DOCRAPTOR_API_KEY}:`).toString("base64"),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[generate-report-pdf] DocRaptor error:", res.status, txt);
      return json(
        422,
        {
          success: false,
          error: "DocRaptor error",
          status: res.status,
          reportPageUrl: documentUrl,
          details: txt,
        },
        corsHeaders()
      );
    }

    const pdfBuffer = Buffer.from(await res.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[generate-report-pdf] error:", err);
    return json(500, { success: false, error: "Unexpected server error" }, corsHeaders());
  }
};