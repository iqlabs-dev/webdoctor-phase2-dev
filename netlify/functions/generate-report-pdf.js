// /netlify/functions/generate-report-pdf.js

const DOC_API_KEY = process.env.DOCRAPTOR_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;

// Your Netlify env uses SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

export async function handler(event) {
  // Basic CORS (safe if you ever call from same origin; harmless otherwise)
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
      },
      body: "",
    };
  }

  try {
    if (event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Method Not Allowed" }),
      };
    }

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

    let payload = {};
    try {
      payload = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const { html, report_id } = payload;

    if (!html || !report_id) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Missing html or report_id" }),
      };
    }

    console.log("PDF generation requested:", { report_id, html_len: String(html).length });

    // 1) DOC RAPTOR
    const drRes = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify({
        user_credentials: DOC_API_KEY,
        doc: {
          test: false, // live mode
          name: `${report_id}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true,
          prince_options: { media: "print" },
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

    const pdfBuffer = Buffer.from(await drRes.arrayBuffer());

    // 2) UPLOAD TO SUPABASE STORAGE
    // Bucket: reports
    // Path: <report_id>.pdf
    const putUrl = `${SUPABASE_URL}/storage/v1/object/reports/${encodeURIComponent(
      report_id
    )}.pdf`;

    const uploadRes = await fetch(putUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/pdf",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY, // important for some projects/tools
        "x-upsert": "true",
      },
      body: pdfBuffer,
    });

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

    // If your bucket is PUBLIC:
    const pdf_url = `${SUPABASE_URL}/storage/v1/object/public/reports/${encodeURIComponent(
      report_id
    )}.pdf`;

    // 3) UPDATE REPORT ROW (set pdf_url)
    const patchUrl = `${SUPABASE_URL}/rest/v1/reports?report_id=eq.${encodeURIComponent(
      report_id
    )}`;

    const patchRes = await fetch(patchUrl, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        apikey: SUPABASE_SERVICE_KEY,
        Prefer: "return=representation",
      },
      body: JSON.stringify({ pdf_url }),
    });

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
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
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
