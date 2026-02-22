// netlify/functions/generate-report-pdf.js
// iQWEB — Generate PDF using the EXACT same renderer as OSD (report.html + report-data.js)
//
// Strategy:
// - DocRaptor fetches /report.html?report_id=...&pdf=1 (public)
// - report.html runs the normal JS renderer (report-data.js)
// - In pdf mode, report-data.js sets window.status='done' when rendering is complete
// - DocRaptor waits for JS before rendering (wait_for_javascript)
//
// This keeps OSD/PDF parity and avoids maintaining a second HTML renderer.

const fetch = require("node-fetch");

const DOCRAPTOR_API = "https://api.docraptor.com/docs";
const TIMEOUT_MS = Number(process.env.DOCRAPTOR_TIMEOUT_MS || "120000"); // 2 min

exports.handler = async (event) => {
  // CORS preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "POST") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.DOCRAPTOR_API_KEY;
    if (!apiKey) return json(500, { success: false, error: "DOCRAPTOR_API_KEY_missing" });

    const body = safeJson(event.body);
    const reportId = String(body.report_id || body.reportId || body.id || "").trim();

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    // Netlify provides URL in most contexts. Fall back to prod domain if absent.
    const siteUrl = (process.env.URL || "https://iqweb.ai").replace(/\/+$/, "");

    // Use the SAME report page (OSD) and switch into PDF mode via query param.
    // NOTE: include from=pdf so report.html can hide interactive UI.
    const reportUrl =
      siteUrl +
      "/report.html?report_id=" +
      encodeURIComponent(reportId) +
      "&pdf=1&from=pdf";

    const docName = `iQWEB Website Report — ${reportId}.pdf`;

    const payload = {
      name: docName,
      document_type: "pdf",
      document_url: reportUrl,
      test: String(process.env.DOCRAPTOR_TEST || "false").toLowerCase() === "true",

      // Make sure JS runs (report-data.js renders the report)
      javascript: true,

      // Prince options are passed through by DocRaptor
      prince_options: {
        media: "print",
        // IMPORTANT: wait for JS to signal completion (window.status='done')
        wait_for_javascript: true,
        // Give enough time for big reports to render
        timeout: TIMEOUT_MS,
        // PDFs should be white pages
        no_background: true,
      },
    };

    const pdfBuffer = await postDocRaptor(apiKey, payload);

    const b64 = Buffer.from(pdfBuffer).toString("base64");
    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(reportId)}.pdf"`,
        "Cache-Control": "no-store",
      },
      isBase64Encoded: true,
      body: b64,
    };
  } catch (err) {
    console.error("[generate-report-pdf] error:", err);
    return json(500, {
      success: false,
      error: err && err.message ? err.message : "Unknown error",
    });
  }
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { ...corsHeaders(), "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

function safeJson(s) {
  try {
    return JSON.parse(s || "{}");
  } catch (_) {
    return {};
  }
}

function safeFilename(reportId) {
  return String(reportId || "report").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

async function postDocRaptor(apiKey, docPayload) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS + 10000);

  try {
    const res = await fetch(DOCRAPTOR_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(apiKey + ":").toString("base64"),
      },
      body: JSON.stringify(docPayload),
      signal: controller.signal,
    });

    const buf = await res.buffer();

    if (!res.ok) {
      const snippet = buf ? buf.toString("utf8").slice(0, 2000) : "";
      throw new Error(`DocRaptor error (${res.status}): ${snippet || "no body"}`);
    }

    return buf;
  } catch (e) {
    if (e && e.name === "AbortError") throw new Error("DocRaptor request timed out");
    throw e;
  } finally {
    clearTimeout(t);
  }
}