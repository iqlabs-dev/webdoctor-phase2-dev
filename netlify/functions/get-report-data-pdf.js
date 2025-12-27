// netlify/functions/get-report-data-pdf.js
// PURE PROXY (stable contract for PDF renderer)
//
// Fetches your already-working endpoint:
//   /.netlify/functions/get-report-data?report_id=...
//
// Returns a minimal, stable JSON shape that get-report-html-pdf expects:
// {
//   success: true,
//   header: { website, report_id, created_at },
//   scores: { overall, performance, mobile, seo, security, structure, accessibility },
//   delivery_signals: [...],
//   findings: {...},
//   narrative: {...},        // fallback if findings not present
//   raw: <optional debugging>  // keep for now; you can remove later
// }

exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  try {
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return json(405, { error: "Method not allowed" }, { Allow: "GET, POST, OPTIONS" });
    }

    // report_id from query (GET) or body (POST)
    let reportId = "";
    if (event.httpMethod === "GET") {
      reportId = String(event.queryStringParameters?.report_id || event.queryStringParameters?.reportId || "").trim();
    } else {
      let body = {};
      try {
        body = JSON.parse(event.body || "{}");
      } catch {
        return json(400, { error: "Invalid JSON body" });
      }
      reportId = String(body.report_id || body.reportId || "").trim();
    }

    if (!reportId) return json(400, { error: "Missing report_id" });

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl = `${siteUrl}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;

    const resp = await fetch(srcUrl, { method: "GET", headers: { Accept: "application/json" } });
    const text = await resp.text().catch(() => "");

    if (!resp.ok) {
      return json(500, {
        error: "Upstream get-report-data failed",
        status: resp.status,
        details: text.slice(0, 1200),
      });
    }

    let raw = {};
    try {
      raw = JSON.parse(text || "{}");
    } catch {
      return json(500, { error: "Upstream returned non-JSON", details: text.slice(0, 1200) });
    }

    // Defensive normalizers
    const safeObj = (v) => (v && typeof v === "object" ? v : {});
    const clampScore = (n) => {
      const x = Number(n);
      if (!Number.isFinite(x)) return null;
      return Math.max(0, Math.min(100, Math.round(x)));
    };

    // Header sources vary
    const hdr = safeObj(raw.header || raw.report || raw);

    // Scores sources vary
    const scoresSrc = safeObj(raw.scores || raw.metrics?.scores || raw.report?.scores || raw);

    // delivery_signals + findings are what the HTML renderer wants
    const delivery_signals = Array.isArray(raw.delivery_signals)
      ? raw.delivery_signals
      : Array.isArray(raw.report?.delivery_signals)
      ? raw.report.delivery_signals
      : [];

    const findings = safeObj(raw.findings || raw.report?.findings);

    // narrative fallback (some older outputs only have narrative)
    const narrative = safeObj(raw.narrative || raw.report?.narrative);

    const out = {
      success: true,
      header: {
        website: hdr.website || hdr.url || raw.url || "",
        report_id: hdr.report_id || hdr.id || reportId,
        created_at: hdr.created_at || raw.created_at || "",
      },
      scores: {
        overall: clampScore(scoresSrc.overall),
        performance: clampScore(scoresSrc.performance),
        mobile: clampScore(scoresSrc.mobile),
        seo: clampScore(scoresSrc.seo),
        security: clampScore(scoresSrc.security),
        structure: clampScore(scoresSrc.structure),
        accessibility: clampScore(scoresSrc.accessibility),
      },
      delivery_signals,
      findings,
      narrative,
      raw, // keep for debugging while stabilising
    };

    return json(200, out);
  } catch (err) {
    console.error("[get-report-data-pdf] crash:", err);
    return json(500, { error: err?.message || "Unknown error" });
  }
};

function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}
