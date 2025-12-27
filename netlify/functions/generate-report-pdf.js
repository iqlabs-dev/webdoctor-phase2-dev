// netlify/functions/generate-report-pdf.js
// Generates a PDF via DocRaptor using the server-rendered HTML from get-report-html-pdf
// Supports GET + POST to match UI fetch patterns (prevents 405)
// Returns application/pdf on success, otherwise fast JSON error (no Netlify 504 mystery timeouts)

// ✅ Accept both env var spellings (you currently have DOC_RAPTOR_API_KEY in Netlify)
const DOCRAPTOR_API_KEY =
  process.env.DOCRAPTOR_API_KEY ||
  process.env.DOCRAPTOR_KEY ||
  process.env.DOC_RAPTOR_API_KEY || // <-- your Netlify key
  "";

const DOCRAPTOR_TEST = (process.env.DOCRAPTOR_TEST || "false").toLowerCase() === "true";

// Hard timeouts (keep under Netlify gateway limits)
const HTML_FETCH_TIMEOUT_MS = 8000;   // fail fast if HTML endpoint hangs
const DOCRAPTOR_TIMEOUT_MS = 18000;   // fail fast if DocRaptor is slow

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" }, { Allow: "GET, POST, OPTIONS" });
    }

    if (!DOCRAPTOR_API_KEY) {
      return json(500, {
        error: "Missing DocRaptor API key in Netlify environment",
        expected_any_of: ["DOCRAPTOR_API_KEY", "DOC_RAPTOR_API_KEY", "DOCRAPTOR_KEY"],
        found: {
          DOCRAPTOR_API_KEY: Boolean(process.env.DOCRAPTOR_API_KEY),
          DOC_RAPTOR_API_KEY: Boolean(process.env.DOC_RAPTOR_API_KEY),
          DOCRAPTOR_KEY: Boolean(process.env.DOCRAPTOR_KEY),
        },
      });
    }

    // Extract report_id from GET query or POST body
    let reportId = "";

    if (event.httpMethod === "GET") {
      reportId = (event.queryStringParameters?.report_id || event.queryStringParameters?.reportId || "").trim();
    } else {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }
      reportId = (body.report_id || body.reportId || "").trim();
    }

    if (!reportId) return json(400, { error: "Missing report_id" });

    const siteUrl = process.env.URL || "https://iqweb.ai";

    // 1) Fetch full HTML (fast-fail)
    const htmlUrl = `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(reportId)}`;

    const html = await fetchWithTimeout(htmlUrl, HTML_FETCH_TIMEOUT_MS, {
      method: "GET",
      headers: { Accept: "text/html" },
    }).then(async (r) => {
      const t = await r.text().catch(() => "");
      if (!r.ok) throw new Error(`HTML fetch failed (${r.status}): ${t.slice(0, 300)}`);
      if (!t || t.length < 200) throw new Error("HTML fetch returned empty/too-short content");
      return t;
    });

    // 2) Send HTML to DocRaptor (fast-fail)
    const auth = Buffer.from(`${DOCRAPTOR_API_KEY}:`).toString("base64");

    const docReq = {
      test: DOCRAPTOR_TEST,
      document_type: "pdf",
      name: `${reportId}.pdf`,
      document_content: html,
      prince_options: { media: "print" },
    };

    const pdfResp = await fetchWithTimeout("https://docraptor.com/docs", DOCRAPTOR_TIMEOUT_MS, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify(docReq),
    });

    const contentType = (pdfResp.headers.get("content-type") || "").toLowerCase();

    if (!pdfResp.ok) {
      const errText = await pdfResp.text().catch(() => "");
      return json(502, {
        error: "DocRaptor generation failed",
        status: pdfResp.status,
        details: errText.slice(0, 1200),
      });
    }

    if (contentType.includes("application/json")) {
      const t = await pdfResp.text().catch(() => "");
      return json(502, {
        error: "DocRaptor returned JSON instead of PDF",
        details: t.slice(0, 1200),
      });
    }

    const pdfBuf = Buffer.from(await pdfResp.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBuf.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return json(500, { error: err?.message || "Unknown error" });
  }
};

/* ---------- helpers ---------- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      ...corsHeaders(),
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(obj),
  };
}

async function fetchWithTimeout(url, ms, opts) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}
