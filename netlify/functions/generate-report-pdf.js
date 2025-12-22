// /netlify/functions/generate-report-pdf.js

// ✅ FIX: support the Netlify env var name you actually use: DOC_RAPTOR_API_KEY
// (and keep backward compatibility with DOCRAPTOR_API_KEY)
const DOC_API_KEY = process.env.DOC_RAPTOR_API_KEY || process.env.DOCRAPTOR_API_KEY;

const SUPABASE_URL = process.env.SUPABASE_URL;
// Support both env var names – your Netlify uses SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" }),
      };
    }

    // Debug env status (shows in Netlify logs)
    console.log("ENV CHECK:", {
      haveDoc: !!DOC_API_KEY,
      haveUrl: !!SUPABASE_URL,
      haveService: !!SUPABASE_SERVICE_KEY,
    });

    if (!DOC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Server config error (env vars)" }),
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || "{}");
    } catch (e) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const reportId = body.reportId || body.report_id;
    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing reportId" }),
      };
    }

    // Pull report HTML from Supabase
    const { createClient } = await import("@supabase/supabase-js");
    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    const { data: reportRow, error: reportErr } = await supabaseAdmin
      .from("scan_results")
      .select("report_id, report_html")
      .eq("report_id", reportId)
      .single();

    if (reportErr || !reportRow?.report_html) {
      console.error("Missing report_html", reportErr);
      return {
        statusCode: 404,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Report HTML not found for this reportId" }),
      };
    }

    const html = reportRow.report_html;

    // Send to DocRaptor
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
      const errText = await resp.text();
      console.error("DocRaptor error:", resp.status, errText);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "DocRaptor error",
          status: resp.status,
          details: errText,
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
}
