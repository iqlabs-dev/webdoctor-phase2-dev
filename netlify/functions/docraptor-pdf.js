// netlify/functions/docraptor-pdf.js

import { createClient } from "@supabase/supabase-js";

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const body = JSON.parse(event.body || "{}");
    const { report_id } = body;

    if (!report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing report_id" }),
      };
    }

    // Load environment variables
    const SUPABASE_URL = process.env.SUPABASE_URL;
    const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    const DOC_RAPTOR_API_KEY = process.env.DOC_RAPTOR_API_KEY;

    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Supabase config missing" }),
      };
    }

    if (!DOC_RAPTOR_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "DOC_RAPTOR_API_KEY is not set" }),
      };
    }

    // Connect to Supabase
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

    // Get the HTML for the report
    const { data, error } = await supabase
      .from("scan_results")
      .select("report_html")
      .eq("report_id", report_id)
      .maybeSingle();

    if (error || !data || !data.report_html) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: "Report HTML not found" }),
      };
    }

    const html = data.report_html;

    // Call DocRaptor API
    const resp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: DOC_RAPTOR_API_KEY,
        doc: {
          name: `${report_id}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true,
          prince_options: { media: "print" },
        },
      }),
    });

    if (!resp.ok) {
      const errorText = await resp.text();
      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "DocRaptor error",
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
        "Content-Disposition": `attachment; filename="${report_id}.pdf"`,
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("docraptor-pdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
