// /netlify/functions/generate-report-pdf.js
// FINAL VERSION – DocRaptor + Supabase + Phase 2.8 PDF Engine

import { createClient } from "@supabase/supabase-js";

// -------------------------------------------------------------
// Supabase (secure – server-side only)
// -------------------------------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -------------------------------------------------------------
// MAIN HANDLER
// -------------------------------------------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    const { html, report_id, user_id } = JSON.parse(event.body || "{}");

    if (!html || !report_id || !user_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({
          error: "Missing html / report_id / user_id",
        }),
      };
    }

    // -------------------------------------------------------------
    // 1) Generate PDF via DocRaptor
    // -------------------------------------------------------------
    const docPayload = {
      test: false,
      document_content: html,
      type: "pdf",
      name: `${report_id}.pdf`,
    };

    const docRes = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        user_credentials: process.env.DOCRAPTOR_API_KEY,
        doc: docPayload,
      }),
    });

    if (!docRes.ok) {
      const errorText = await docRes.text();
      console.error("DocRaptor error:", errorText);

      return {
        statusCode: 502,
        body: JSON.stringify({
          error: "DocRaptor request failed",
          detail: errorText,
        }),
      };
    }

    const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

    // -------------------------------------------------------------
    // 2) Upload PDF to Supabase Storage
    // -------------------------------------------------------------
    const storagePath = `${user_id}/${report_id}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from("reports-pdf")
      .upload(storagePath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (uploadError) {
      console.error("Supabase upload error:", uploadError);

      return {
        statusCode: 500,
        body: JSON.stringify({
          error: "Failed to upload PDF",
          detail: uploadError,
        }),
      };
    }

    // -------------------------------------------------------------
    // 3) Get the PUBLIC URL
    // -------------------------------------------------------------
    const { data: publicInfo } = supabase.storage
      .from("reports-pdf")
      .getPublicUrl(storagePath);

    const pdf_url = publicInfo.publicUrl;

    // -------------------------------------------------------------
    // 4) Save PDF URL to `reports` table
    // -------------------------------------------------------------
    await supabase
      .from("reports")
      .update({ pdf_url })
      .eq("report_id", report_id);

    // -------------------------------------------------------------
    // DONE
    // -------------------------------------------------------------
    return {
      statusCode: 200,
      body: JSON.stringify({ pdf_url }),
    };
  } catch (err) {
    console.error("generate-report-pdf.js error:", err);

    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Server error",
        detail: err.message || String(err),
      }),
    };
  }
}
