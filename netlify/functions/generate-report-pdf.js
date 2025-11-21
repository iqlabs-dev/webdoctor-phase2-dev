// /netlify/functions/generate-report-pdf.js

const DOC_API_KEY = process.env.DOCRAPTOR_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export async function handler(event) {
  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" }),
      };
    }

    if (!DOC_API_KEY || !SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.log("Missing env vars:", {
        haveDoc: !!DOC_API_KEY,
        haveUrl: !!SUPABASE_URL,
        haveService: !!SUPABASE_SERVICE_KEY,
      });
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Server config error (env vars)" }),
      };
    }

    const { html, report_id } = JSON.parse(event.body || "{}");

    if (!html || !report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing html or report_id" }),
      };
    }

    console.log("PDF generation requested:", { report_id });

    // 1) DOC RAPTOR (TEST MODE WHILE BUILDING)
    const drRes = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_credentials: DOC_API_KEY,
        doc: {
          test: true, // change to false only when you are ready for live docs
          name: `${report_id}.pdf`,
          document_type: "pdf",
          html,
        },
      }),
    });

    if (!drRes.ok) {
      const text = await drRes.text();
      console.log("DocRaptor failed:", drRes.status, text);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "DocRaptor error",
          status: drRes.status,
          detail: text,
        }),
      };
    }

    const arrayBuffer = await drRes.arrayBuffer();
    const pdfBuffer = Buffer.from(arrayBuffer);

    // 2) UPLOAD TO SUPABASE STORAGE
    const uploadRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/reports/${report_id}.pdf`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/pdf",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "x-upsert": "true",
        },
        body: pdfBuffer,
      }
    );

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      console.log("Storage upload failed:", uploadRes.status, text);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "Storage upload error",
          status: uploadRes.status,
          detail: text,
        }),
      };
    }

    const pdf_url = `${SUPABASE_URL}/storage/v1/object/public/reports/${report_id}.pdf`;

    // 3) UPDATE REPORT ROW
    const patchRes = await fetch(
      `${SUPABASE_URL}/rest/v1/reports?report_id=eq.${report_id}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          apikey: SUPABASE_SERVICE_KEY,
        },
        body: JSON.stringify({ pdf_url }),
      }
    );

    if (!patchRes.ok) {
      const text = await patchRes.text();
      console.log("DB patch failed:", patchRes.status, text);
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          error: "DB patch error",
          status: patchRes.status,
          detail: text,
        }),
      };
    }

    console.log("PDF generated successfully:", pdf_url);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdf_url }),
    };
  } catch (err) {
    console.log("generate-report-pdf fatal error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Server error", detail: String(err) }),
    };
  }
}
