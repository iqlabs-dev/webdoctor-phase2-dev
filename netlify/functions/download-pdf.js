// netlify/functions/download-pdf.js
// iQWEB — Download cached PDF if available; otherwise generate it the same way as generate-report-pdf.

const { createClient } = require("@supabase/supabase-js");

function getFetch() {
  if (typeof fetch === "function") return fetch;
  // eslint-disable-next-line global-require
  return require("node-fetch");
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  const fetchFn = getFetch();

  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: JSON.stringify({ error: "Method not allowed" }) };
    }

    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return { statusCode: 400, body: JSON.stringify({ error: "Invalid JSON body" }) };
    }

    const reportId = body.reportId || body.report_id || null;
    if (!reportId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing reportId" }) };
    }

    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Missing Supabase server config",
          missing: {
            SUPABASE_URL: !SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_ROLE_KEY,
          },
        }),
      };
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1) If cached PDF exists, return it
    const { data, error } = await supabaseAdmin
      .from("scan_results")
      .select("pdf_base64")
      .eq("report_id", reportId)
      .maybeSingle();

    if (error) {
      console.log("[PDF] scan_results read error (non-fatal):", error.message || error);
    }

    if (data?.pdf_base64) {
      return {
        statusCode: 200,
        isBase64Encoded: true,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
          "Cache-Control": "no-store",
        },
        body: data.pdf_base64,
      };
    }

    // 2) Otherwise call generate-report-pdf (same origin)
    const host = event.headers.host;
    const proto =
      event.headers["x-forwarded-proto"] ||
      event.headers["X-Forwarded-Proto"] ||
      "https";
    const url = `${proto}://${host}/.netlify/functions/generate-report-pdf`;

    const genResp = await fetchFn(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // forward auth if present (your generate function might not need it, but harmless)
        ...(event.headers.authorization ? { Authorization: event.headers.authorization } : {}),
      },
      body: JSON.stringify({ reportId }),
    });

    if (!genResp.ok) {
      const txt = await genResp.text().catch(() => "");
      console.error("[PDF] generate-report-pdf failed", genResp.status, txt.slice(0, 500));
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "PDF generation failed", status: genResp.status }),
      };
    }

    // genResp will be base64 PDF body (Netlify function response)
    const pdfBase64 = await genResp.text();

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBase64,
    };
  } catch (err) {
    console.error("[PDF] download-pdf crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Unknown error" }) };
  }
};
