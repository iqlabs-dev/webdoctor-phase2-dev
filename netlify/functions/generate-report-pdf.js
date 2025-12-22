// /.netlify/functions/generate-report-pdf.js
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// IMPORTANT: set these in Netlify env
const DOCRAPTOR_API_KEY = process.env.DOCRAPTOR_API_KEY;
const PUBLIC_SITE_URL = process.env.PUBLIC_SITE_URL || "https://iqweb.ai";

// Storage bucket name (create this in Supabase Storage)
const PDF_BUCKET = process.env.PDF_BUCKET || "reports";

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

function getBearerToken(event) {
  const h = event.headers || {};
  const auth = h.authorization || h.Authorization || "";
  const m = String(auth).match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

async function docraptorCreatePdfFromUrl(url) {
  if (!DOCRAPTOR_API_KEY) {
    throw new Error("Missing DOCRAPTOR_API_KEY env var");
  }

  const payload = {
    document_url: url,
    type: "pdf",
    test: false, // set true if you want DocRaptor "test" mode
    name: "iqweb-report.pdf",
    javascript: true,
    // Optional: give JS time to render signals/narrative
    // (Your report loads client-side and needs time)
    // Increase if needed:
    // timeout: 60000,
  };

  const res = await fetch("https://docraptor.com/docs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Basic " + Buffer.from(`${DOCRAPTOR_API_KEY}:`).toString("base64"),
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DocRaptor failed (${res.status}): ${text.slice(0, 300)}`);
  }

  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

export async function handler(event) {
  try {
    if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
      return json(500, { success: false, error: "Missing Supabase env vars" });
    }

    const token = getBearerToken(event);
    if (!token) return json(401, { success: false, error: "Missing Authorization Bearer token" });

    const body = JSON.parse(event.body || "{}");
    const report_id = body.report_id;

    if (!report_id || typeof report_id !== "string") {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Verify user from JWT
    const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json(401, { success: false, error: "Invalid session" });
    }

    const user_id = userData.user.id;

    // Load scan row + ownership check
    const { data: row, error: rowErr } = await supabaseAdmin
      .from("scan_results")
      .select("id, user_id, report_id, report_url")
      .eq("report_id", report_id)
      .maybeSingle();

    if (rowErr) return json(500, { success: false, error: `DB error: ${rowErr.message}` });
    if (!row) return json(404, { success: false, error: "Report not found" });
    if (row.user_id !== user_id) return json(403, { success: false, error: "Forbidden" });

    // If already generated, return it
    if (row.report_url) {
      return json(200, { success: true, pdf_url: row.report_url });
    }

    // Build the public URL DocRaptor will render.
    // IMPORTANT: use the *public* report page that works without auth in a headless browser.
    const reportUrl = `${PUBLIC_SITE_URL}/report.html?report_id=${encodeURIComponent(report_id)}`;

    // Generate PDF bytes
    const pdfBytes = await docraptorCreatePdfFromUrl(reportUrl);

    // Upload to Supabase Storage
    const filePath = `reports/${report_id}.pdf`;

    const { error: upErr } = await supabaseAdmin.storage
      .from(PDF_BUCKET)
      .upload(filePath, pdfBytes, {
        contentType: "application/pdf",
        upsert: true,
        cacheControl: "3600",
      });

    if (upErr) {
      return json(500, { success: false, error: `Storage upload failed: ${upErr.message}` });
    }

    // Get public URL (bucket should be public) OR switch to signed URLs if you want private
    const { data: pub } = supabaseAdmin.storage.from(PDF_BUCKET).getPublicUrl(filePath);
    const pdf_url = pub?.publicUrl;

    if (!pdf_url) {
      return json(500, { success: false, error: "Unable to determine PDF public URL" });
    }

    // Save back to scan_results.report_url
    const { error: updErr } = await supabaseAdmin
      .from("scan_results")
      .update({ report_url: pdf_url })
      .eq("id", row.id);

    if (updErr) {
      return json(500, { success: false, error: `Failed saving report_url: ${updErr.message}` });
    }

    return json(200, { success: true, pdf_url });
  } catch (e) {
    console.error("[generate-report-pdf] fatal:", e);
    return json(500, { success: false, error: e?.message || "Internal Server Error" });
  }
}
