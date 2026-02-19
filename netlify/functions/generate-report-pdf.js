// netlify/functions/generate-report-pdf.js
//
// Generates PDF via DocRaptor by rendering a web page URL.
// It will try report_pdf.html first, then fall back to report_template.html, then report.html.
//
// Env vars supported:
// - DOC_RAPTOR_API_KEY (preferred)
// - DOCRAPTOR_API_KEY
// - DOC_RAPTOR_API_KY (legacy typo)

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    },
    body: JSON.stringify(obj),
  };
}

function corsPreflight() {
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

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

async function probeOk(url) {
  const res = await fetch(url, { method: "GET" });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return corsPreflight();
  if (event.httpMethod !== "POST") return json(405, { success: false, error: "Method not allowed" });

  try {
    let body = {};
    try {
      body = JSON.parse(event.body || "{}");
    } catch {
      return json(400, { success: false, error: "Invalid JSON body" });
    }

    const reportId = String(body.reportId || body.report_id || "").trim();
    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    const apiKey =
      process.env.DOC_RAPTOR_API_KEY ||
      process.env.DOCRAPTOR_API_KEY ||
      process.env.DOC_RAPTOR_API_KY;

    if (!apiKey) {
      return json(500, {
        success: false,
        error: "DocRaptor API key missing",
        hint: "Set DOC_RAPTOR_API_KEY (preferred).",
      });
    }

    const baseUrl = getBaseUrl(event);

    // Candidate pages to render (first that exists wins)
    const candidates = [
      "/report_pdf.html",
      "/report_template.html",
      "/report.html",
    ];

    const tried = [];
    let reportPageUrl = null;
    let lastProbe = null;

    for (const path of candidates) {
      const url =
        `${baseUrl}${path}` +
        `?report_id=${encodeURIComponent(reportId)}` +
        `&from=history&pdf=1`;

      const probe = await probeOk(url);
      tried.push({ url, status: probe.status });

      if (probe.ok) {
        reportPageUrl = url;
        lastProbe = probe;
        break;
      }
      lastProbe = probe;
    }

    if (!reportPageUrl) {
      return json(500, {
        success: false,
        error: "No renderable report page found (all candidates 404/failed)",
        tried,
        lastStatus: lastProbe?.status,
        lastDetails: (lastProbe?.text || "").slice(0, 1500),
      });
    }

    const drResp = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/pdf" },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          name: `${reportId}.pdf`,
          test: false,
          document_type: "pdf",
          document_url: reportPageUrl,
          javascript: true,
          wait_for_javascript: true,
          prince_options: { media: "print" },
        },
      }),
    });

    if (!drResp.ok) {
      const errText = await drResp.text().catch(() => "");
      return json(500, {
        success: false,
        error: "DocRaptor error",
        status: drResp.status,
        reportPageUrl,
        tried,
        details: errText.slice(0, 3000),
      });
    }

    const pdfBuffer = Buffer.from(await drResp.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("[generate-report-pdf] error:", err);
    return json(500, { success: false, error: err?.message || "Unexpected server error" });
  }
};
