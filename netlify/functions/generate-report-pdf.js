// netlify/functions/generate-report-pdf.js
// iQWEB — Generate PDF via DocRaptor (URL render)
// Key idea: DO NOT try to run report UI JS in Node (no window). Let DocRaptor render the hosted report URL.
// Accepts: { reportId } or { report_id } or { reportID }
// Returns: application/pdf (base64-encoded response for Netlify)

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

function pickReportId(body) {
  if (!body || typeof body !== "object") return "";
  return (
    body.reportId ||
    body.reportID ||
    body.report_id ||
    body.report ||
    body.id ||
    ""
  );
}

function safeFilename(s) {
  return String(s || "report").replace(/[^a-zA-Z0-9._-]+/g, "_");
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const apiKey = process.env.DOC_RAPTOR_API_KEY;
    if (!apiKey) {
      console.error("[generate-report-pdf] Missing DOC_RAPTOR_API_KEY");
      return json(500, { success: false, error: "Server misconfiguration" });
    }

    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch {
      return json(400, { success: false, error: "Invalid JSON body" });
    }

    const reportId = pickReportId(body);
    if (!reportId) {
      return json(400, { success: false, error: "Missing reportId" });
    }

    // Render the live report page (same OSD), but in a PDF/print context.
    // You can use ?pdf=1 inside report.html/report-data.js to:
    // - hide buttons
    // - set white background
    // - switch to print-friendly sizing
    const reportUrl = `https://iqweb.ai/report.html?report_id=${encodeURIComponent(reportId)}&pdf=1`;

    const isTest =
      String(process.env.DOC_RAPTOR_TEST || "").toLowerCase() === "true" ||
      String(process.env.DOC_RAPTOR_TEST || "") === "1";

    const payload = {
      document_url: reportUrl,
      name: `${safeFilename(reportId)}.pdf`,
      document_type: "pdf",
      test: isTest,

      // IMPORTANT: we want the report page JS to run (it fetches Supabase data + renders the UI).
      // DocRaptor supports JavaScript execution via this flag.
      // If your account/pipeline disables JS, you'll need to enable it in DocRaptor.
      javascript: true,

      // Print defaults. (Safe even if ignored.)
      prince_options: {
        media: "print",
      },
    };

    const auth = Buffer.from(`${apiKey}:`).toString("base64");

    const res = await fetch("https://api.docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/pdf",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error("[generate-report-pdf] DocRaptor error:", res.status, txt.slice(0, 500));
      return json(502, {
        success: false,
        error: "DocRaptor failed to generate PDF",
        status: res.status,
        detail: txt ? txt.slice(0, 500) : undefined,
      });
    }

    const buf = Buffer.from(await res.arrayBuffer());

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeFilename(reportId)}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: buf.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] fatal:", err);
    return json(500, { success: false, error: "Unexpected server error" });
  }
};
