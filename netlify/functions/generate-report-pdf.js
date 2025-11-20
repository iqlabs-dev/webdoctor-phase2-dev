// /netlify/functions/generate-report-pdf.js

import fetch from "node-fetch";

// --------------------
// ENV VARS (Netlify)
// --------------------
const DOC_API_KEY = process.env.DOCRAPTOR_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

// --------------------
// MAIN HANDLER
// --------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const { html, report_id } = JSON.parse(event.body);

    if (!html || !report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: "Missing html or report_id" })
      };
    }

    // -----------------------------
    // 1. SEND TO DOCRAPTOR → PDF
    // -----------------------------
    const drRes = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        user_credentials: DOC_API_KEY,
        doc: {
          test: false,
          name: `${report_id}.pdf`,
          document_type: "pdf",
          html: html
        }
      })
    });

    if (!drRes.ok) {
      const text = await drRes.text();
      console.log("DocRaptor failed:", text);
      return { statusCode: 500, body: text };
    }

    const pdfBuffer = Buffer.from(await drRes.arrayBuffer());

    // -----------------------------------
    // 2. STORE PDF IN SUPABASE STORAGE
    // -----------------------------------
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/reports/${report_id}.pdf`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "x-upsert": "true"
        },
        body: pdfBuffer
      }
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.log("Storage upload failed:", text);
      return { statusCode: 500, body: text };
    }

    const pdf_url = `${SUPABASE_URL}/storage/v1/object/public/reports/${report_id}.pdf`;

    // -----------------------------------
    // 3. UPDATE REPORT RECORD (pdf_url)
    // -----------------------------------
    await fetch(
      `${SUPABASE_URL}/rest/v1/reports?report_id=eq.${report_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_SERVICE_KEY}`,
          "apikey": SUPABASE_SERVICE_KEY
        },
        body: JSON.stringify({ pdf_url })
      }
    );

    return {
      statusCode: 200,
      body: JSON.stringify({ pdf_url })
    };

  } catch (err) {
    console.log("generate-report-pdf error:", err);
    return { statusCode: 500, body: err.message };
  }
}
