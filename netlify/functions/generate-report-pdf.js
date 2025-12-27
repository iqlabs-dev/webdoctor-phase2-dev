// netlify/functions/generate-report-pdf.js
// Generates PDF via DocRaptor by printing a server-rendered HTML page (NO JS).
//
// Requires env:
// - DOC_RAPTOR_API_KEY (note: this is your env name in Netlify)

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  // Enforce POST
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "POST, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    // Parse body
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Invalid JSON body" }),
      };
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    if (!reportId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Missing reportId" }),
      };
    }

    const apiKey = process.env.DOC_RAPTOR_API_KEY;
    if (!apiKey) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "DOC_RAPTOR_API_KEY is not set" }),
      };
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";

    // DocRaptor will fetch this via GET
    const pdfHtmlUrl = `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(
      reportId
    )}`;

    // ✅ HARD CHECK: make sure the HTML URL actually returns 200 BEFORE calling DocRaptor
    const probe = await fetch(pdfHtmlUrl, { method: "GET" });
    const probeText = await probe.text().catch(() => "");

    if (!probe.ok) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "PDF HTML endpoint failed (DocRaptor would fail too)",
          status: probe.status,
          url: pdfHtmlUrl,
          details: probeText.slice(0, 1500),
        }),
      };
    }

    // Now call DocRaptor
    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/pdf",
      },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `${reportId}.pdf`,
          test: false,
          document_type: "pdf",
          document_url: pdfHtmlUrl,

          // ✅ DO NOT execute JS (prevents Promise/window errors)
          javascript: false,
          wait_for_javascript: false,

          prince_options: {
            media: "print",
          },
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "DocRaptor error",
          status: drResp.status,
          details: errText.slice(0, 3000),
          pdfHtmlUrl,
        }),
      };
    }

    const arrayBuffer = await drResp.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    return {
      statusCode: 200,
      isBase64Encoded: true,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: buffer.toString("base64"),
    };
  } catch (err) {
    console.error("[generate-report-pdf] crash:", err);
    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: err?.message || "Unknown error" }),
    };
  }
};
