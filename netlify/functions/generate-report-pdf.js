// netlify/functions/generate-report-pdf.js

const fetch = require("node-fetch");
const { createClient } = require("@supabase/supabase-js");

// ✅ FIX: use the correct env var name, with fallback for older configs
const DOC_API_KEY =
  process.env.DOC_RAPTOR_API_KEY ||
  process.env.DOCRAPTOR_API_KEY || // fallback (legacy typo)
  "";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return { statusCode: 400, body: "Invalid JSON body" };
    }

    const reportId = body.reportId || body.report_id || null;
    const html = body.html || null;

    if (!reportId || !html) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing reportId or html" }),
      };
    }

    // small debug (safe)
    console.log("[PDF] generate-report-pdf", {
      reportId,
      haveDocKey: !!DOC_API_KEY,
      haveSupabaseUrl: !!SUPABASE_URL,
      haveServiceKey: !!SUPABASE_SERVICE_KEY,
    });

    if (!DOC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Missing server configuration",
          missing: {
            DOC_RAPTOR_API_KEY: !DOC_API_KEY,
            SUPABASE_URL: !SUPABASE_URL,
            SUPABASE_SERVICE_ROLE_KEY: !SUPABASE_SERVICE_KEY,
          },
        }),
      };
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // 1) Create PDF with DocRaptor
    const docResp = await fetch("https://docraptor.com/docs", {
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
          // test: true, // optional: enable only if you want DocRaptor test mode
        },
      }),
    });

    if (!docResp.ok) {
      const errText = await docResp.text();
      console.error("[PDF] DocRaptor error", docResp.status, errText);
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
          status: docResp.status,
          details: errText,
        }),
      };
    }

    const arrayBuffer = await docResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // 2) Store PDF (base64) in Supabase (if your schema expects it)
    // NOTE: Keep this exactly aligned with your existing table/column logic.
    // If you already store PDFs elsewhere, you can remove this block safely.
    const pdfBase64 = buffer.toString("base64");

    const { error: upErr } = await supabaseAdmin
      .from("scan_results")
      .update({
        pdf_base64: pdfBase64,
        // pdf_generated_at: new Date().toISOString(), // only if column exists
      })
      .eq("report_id", reportId);

    if (upErr) {
      console.warn("[PDF] Supabase update warning (non-fatal):", upErr);
    }

    // 3) Return PDF directly too (so browser can download immediately)
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
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
