// netlify/functions/generate-report-pdf.js
// iQWEB — Generate PDF via DocRaptor by fetching the report HTML from report_url
// Fixes: stops referencing non-existent scan_results.report_html

const { createClient } = require("@supabase/supabase-js");

function getFetch() {
  // Netlify Node 18 has global fetch, but keep fallback for safety
  if (typeof fetch === "function") return fetch;
  // eslint-disable-next-line global-require
  return require("node-fetch");
}

const DOC_RAPTOR_API_KEY =
  process.env.DOC_RAPTOR_API_KEY ||
  process.env.DOCRAPTOR_API_KEY || // legacy fallback (typo)
  "";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Hard fallback if report_url is missing in DB
const FALLBACK_REPORT_BASE = process.env.REPORT_PUBLIC_BASE_URL || "https://iqweb.ai";

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

    // Basic config checks
    if (!DOC_RAPTOR_API_KEY) {
      return { statusCode: 500, body: JSON.stringify({ error: "Missing DOC_RAPTOR_API_KEY" }) };
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

    // 1) Try to get report_url from scan_results
    let reportUrl = null;

    const { data: sr, error: srErr } = await supabaseAdmin
      .from("scan_results")
      .select("report_url")
      .eq("report_id", reportId)
      .maybeSingle();

    if (srErr) {
      console.log("[PDF] scan_results lookup error (non-fatal):", srErr.message || srErr);
    }
    if (sr?.report_url) reportUrl = sr.report_url;

    // 2) If still missing, try "reports" table (older setup)
    if (!reportUrl) {
      const { data: rpt, error: rptErr } = await supabaseAdmin
        .from("reports")
        .select("report_url")
        .eq("report_id", reportId)
        .maybeSingle();

      if (rptErr) {
        console.log("[PDF] reports lookup error (non-fatal):", rptErr.message || rptErr);
      }
      if (rpt?.report_url) reportUrl = rpt.report_url;
    }

    // 3) Final fallback: construct public report URL
    if (!reportUrl) {
      reportUrl = `${FALLBACK_REPORT_BASE.replace(/\/$/, "")}/report.html?report_id=${encodeURIComponent(
        reportId
      )}`;
    }

    console.log("[PDF] Using reportUrl:", reportUrl);

    // 4) Fetch HTML from the report URL
    const htmlResp = await fetchFn(reportUrl, {
      method: "GET",
      headers: {
        // Some setups block unknown bots; this helps
        "User-Agent": "iQWEB-PDF/1.0",
        Accept: "text/html,*/*",
      },
    });

    if (!htmlResp.ok) {
      const txt = await htmlResp.text().catch(() => "");
      console.error("[PDF] Failed to fetch report HTML", htmlResp.status, txt.slice(0, 500));
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to fetch report HTML",
          status: htmlResp.status,
          reportUrl,
        }),
      };
    }

    const html = await htmlResp.text();

    // 5) Create PDF via DocRaptor
    const drResp = await fetchFn("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: DOC_RAPTOR_API_KEY,
        doc: {
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true,
          prince_options: {
            media: "print",
          },
          // IMPORTANT: do NOT set test:true for live PDFs
          // test: true,
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      console.error("[PDF] DocRaptor error", drResp.status, errText);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
          status: drResp.status,
          details: errText,
        }),
      };
    }

    const arrayBuffer = await drResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const pdfBase64 = buffer.toString("base64");

    // Optional: store if column exists (ignore failure)
    try {
      await supabaseAdmin
        .from("scan_results")
        .update({ pdf_base64: pdfBase64 })
        .eq("report_id", reportId);
    } catch (e) {
      console.log("[PDF] pdf_base64 save skipped (non-fatal).");
    }

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
    console.error("[PDF] generate-report-pdf crash:", err);
    return { statusCode: 500, body: JSON.stringify({ error: err.message || "Unknown error" }) };
  }
};
