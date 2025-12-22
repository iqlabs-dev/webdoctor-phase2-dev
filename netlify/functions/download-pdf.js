// netlify/functions/download-pdf.js

const { createClient } = require("@supabase/supabase-js");

// ✅ FIX: use the correct env var name, with fallback for older configs
const DOC_RAPTOR_API_KEY =
  process.env.DOC_RAPTOR_API_KEY ||
  process.env.DOCRAPTOR_API_KEY || // fallback (legacy typo)
  "";

const DOC_RAPTOR_BASE_URL = "https://docraptor.com/docs";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

exports.handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method not allowed" };
    }

    const body = JSON.parse(event.body || "{}");
    const reportId = body.reportId;

    if (!reportId) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing reportId" }),
      };
    }

    const { data, error } = await supabase
      .from("scan_results")
      .select("pdf_base64,report_id")
      .eq("report_id", reportId)
      .single();

    if (error) {
      console.error("Supabase error:", error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Supabase fetch failed" }),
      };
    }

    // If PDF already exists, return it
    if (data?.pdf_base64) {
      const pdfBuffer = Buffer.from(data.pdf_base64, "base64");

      return {
        statusCode: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        },
        body: pdfBuffer.toString("base64"),
        isBase64Encoded: true,
      };
    }

    // Otherwise, generate it now
    if (!DOC_RAPTOR_API_KEY) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "Missing DOC_RAPTOR_API_KEY" }),
      };
    }

    const html = body.html;
    if (!html) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "PDF not available yet and no html provided to generate it.",
        }),
      };
    }

    const docraptorResponse = await fetch(DOC_RAPTOR_BASE_URL, {
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
          prince_options: { media: "print" },
        },
      }),
    });

    if (!docraptorResponse.ok) {
      const errText = await docraptorResponse.text();
      console.error("DocRaptor error:", errText);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "DocRaptor error", details: errText }),
      };
    }

    const pdfArrayBuffer = await docraptorResponse.arrayBuffer();
    const pdfBuffer = Buffer.from(pdfArrayBuffer);

    // Save pdf to Supabase for next time
    const pdf_base64 = pdfBuffer.toString("base64");

    const { error: updateError } = await supabase
      .from("scan_results")
      .update({ pdf_base64 })
      .eq("report_id", reportId);

    if (updateError) {
      console.error("Supabase update error:", updateError);
      // still return the pdf even if save fails
    }

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
      },
      body: pdf_base64,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("download-pdf error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Unknown error" }),
    };
  }
};
