// /netlify/functions/generate-report-pdf.js

const DOC_API_KEY = process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
// Support both env var names – your Netlify uses SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

const { createClient } = require("@supabase/supabase-js");

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return { statusCode: 400, body: "Invalid JSON body" };
    }

    const reportId = body.reportId || body.report_id;

    if (!reportId) {
      return { statusCode: 400, body: "Missing reportId" };
    }

    // Sanity check env
    if (!DOC_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing DOC_RAPTOR_API_KEY" }),
      };
    }
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing SUPABASE config" }),
      };
    }

    // Supabase admin
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Fetch report HTML and metadata
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("scan_results")
      .select("report_html, url, created_at")
      .eq("report_id", reportId)
      .maybeSingle();

    if (rowErr) {
      console.error("Supabase read error:", rowErr);
      return { statusCode: 500, body: "Supabase read error" };
    }

    if (!row || !row.report_html) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Report HTML not found for reportId" }),
      };
    }

    const html = row.report_html;

    // Call DocRaptor
    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: DOC_API_KEY,
        doc: {
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true,
          prince_options: { media: "print" },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      console.error("DocRaptor error", resp.status, errorText);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
          status: resp.status,
          details: errorText,
        }),
      };
    }

    const arrayBuffer = await resp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("generate-report-pdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
