// netlify/functions/get-report-data-pdf.js
// Purpose:
// - Return report data as JSON for PDF generation (server-side).
// - Avoid schema assumptions by PROXYING your already-working endpoint: get-report-data.
// - Supports GET (browser/DocRaptor-safe) and POST (internal-safe).
//
// Output shape (stable + additive):
// {
//   success: true,
//   header: { website, report_id, created_at },
//   scores: { overall, performance, mobile, seo, security, structure, accessibility },
//   narrative: { overall: { lines: [] } },
//   top_issues: [ "..." ],              // deterministic (safe)
//   delivery_signals: [ ... ],          // PASSTHROUGH (NEW)
//   findings: { ... },                  // PASSTHROUGH (NEW)
//   raw: <original response>            // debugging
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
    // Allow GET or POST
    if (event.httpMethod !== "GET" && event.httpMethod !== "POST") {
      return {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          Allow: "GET, POST, OPTIONS",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Method not allowed" }),
      };
    }

    // Extract report_id from either query (GET) or body (POST)
    let reportId = "";

    if (event.httpMethod === "GET") {
      reportId =
        (event.queryStringParameters?.report_id ||
          event.queryStringParameters?.reportId ||
          "").trim();
    } else {
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
      reportId = (body.report_id || body.reportId || "").trim();
    }

    if (!reportId) {
      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({ error: "Missing report_id" }),
      };
    }

    // Proxy to your existing function that already works for the report UI
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl = `${siteUrl}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(
      reportId
    )}`;

    const resp = await fetch(srcUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

    const text = await resp.text().catch(() => "");

    if (!resp.ok) {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Upstream get-report-data failed",
          status: resp.status,
          details: text,
        }),
      };
    }

    let raw = {};
    try {
      raw = JSON.parse(text || "{}");
    } catch {
      return {
        statusCode: 500,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": "no-store",
          "Access-Control-Allow-Origin": "*",
        },
        body: JSON.stringify({
          error: "Upstream returned non-JSON",
          details: text.slice(0, 500),
        }),
      };
    }

    // ----------------------------
    // Helpers (defensive + stable)
    // ----------------------------
    const safeInt = (v) => {
      const n = Number(v);
      return Number.isFinite(n) ? Math.round(n) : null;
    };

    const asBool = (v) => {
      if (v === true || v === false) return v;
      if (typeof v === "number") return v !== 0;
      if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (s === "true" || s === "yes" || s === "1") return true;
        if (s === "false" || s === "no" || s === "0") return false;
      }
      return null;
    };

    const normalizeKey = (k) =>
      String(k || "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const findMetricValue = (obj, wantedNames) => {
      const wanted = (wantedNames || []).map(normalizeKey);

      const walk = (node) => {
        if (!node) return undefined;
        if (Array.isArray(node)) {
          for (const item of node) {
            const found = walk(item);
            if (found !== undefined) return found;
          }
          return undefined;
        }
        if (typeof node !== "object") return undefined;

        for (const [k, v] of Object.entries(node)) {
          const nk = normalizeKey(k);

          if (wanted.includes(nk)) return v;

          if (nk === "metric" && typeof v === "string") {
            const nm = normalizeKey(v);
            if (wanted.includes(nm)) {
              const siblingValue =
                node.value ?? node.val ?? node.result ?? node.data ?? undefined;
              if (siblingValue !== undefined) return siblingValue;
            }
          }
        }

        for (const v of Object.values(node)) {
          const found = walk(v);
          if (found !== undefined) return found;
        }
        return undefined;
      };

      return walk(obj);
    };

    // ----------------------------
    // Normalize header + scores
    // ----------------------------
    const header = raw?.header || raw?.report || {};
    const scoresSrc =
      raw?.scores || raw?.metrics?.scores || raw?.report?.scores || {};

    const scores = {
      overall: safeInt(scoresSrc.overall),
      performance: safeInt(scoresSrc.performance),
      mobile: safeInt(scoresSrc.mobile),
      seo: safeInt(scoresSrc.seo),
      security: safeInt(scoresSrc.security),
      structure: safeInt(scoresSrc.structure),
      accessibility: safeInt(scoresSrc.accessibility),
    };

    // ----------------------------
    // Narrative lines (existing)
    // ----------------------------
    const n =
      raw?.narrative?.overall?.lines ||
      raw?.narrative?.overall ||
      raw?.report?.narrative?.overall?.lines ||
      raw?.report?.narrative?.overall ||
      [];

    const lineify = (v) => {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "string")
        return v
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean);
      if (v && typeof v === "object" && Array.isArray(v.lines))
        return v.lines.filter(Boolean).map(String);
      return [];
    };

    // ----------------------------
    // TOP ISSUES (deterministic, max 5)
    // ----------------------------
    const buildTopIssues = () => {
      const issues = [];

      const cspPresent = asBool(
        findMetricValue(raw, [
          "Csp Present",
          "CSP Present",
          "Content Security Policy Present",
        ])
      );
      const xfoPresent = asBool(
        findMetricValue(raw, ["X Frame Options Present", "X-Frame-Options Present"])
      );
      const permPolicyPresent = asBool(
        findMetricValue(raw, [
          "Permissions Policy Present",
          "Permissions-Policy Present",
        ])
      );

      const h1Count = safeInt(findMetricValue(raw, ["H1 Count", "H1 count"]));
      const h1Present = asBool(findMetricValue(raw, ["H1 Present", "H1 present"]));

      const robotsMetaPresent = asBool(
        findMetricValue(raw, ["Robots Meta Present", "Robots meta present"])
      );

      const add = (text) => {
        if (!text) return;
        if (issues.includes(text)) return;
        issues.push(text);
      };

      // Security first
      const missing = [];
      if (cspPresent === false) missing.push("CSP");
      if (xfoPresent === false) missing.push("X-Frame-Options");
      if (permPolicyPresent === false) missing.push("Permissions-Policy");
      if (missing.length) add(`Security & Trust: Missing ${missing.join(", ")}.`);

      // SEO
      const h1Missing = h1Present === false || h1Count === 0;
      if (h1Missing) add("SEO Foundations: Missing H1 heading.");
      if (robotsMetaPresent === false) add("SEO Foundations: Robots meta tag not found.");

      // Accessibility (only if score is low)
      if (typeof scores.accessibility === "number" && scores.accessibility < 70) {
        add("Accessibility: Score indicates barriers that may impact usability.");
      }

      if (!issues.length) add("No critical issues were detected based on the current scan thresholds.");
      return issues.slice(0, 5);
    };

    const top_issues = buildTopIssues();

    // ----------------------------
    // PASSTHROUGH FIELDS (NEW)
    // These are what your HTML renderer needs for narrative + evidence.
    // ----------------------------
    const delivery_signals =
      raw?.delivery_signals ||
      raw?.report?.delivery_signals ||
      raw?.signals ||
      raw?.report?.signals ||
      [];

    const findings =
      raw?.findings ||
      raw?.report?.findings ||
      raw?.analysis?.findings ||
      raw?.report?.analysis?.findings ||
      {};

    // ----------------------------
    // Output (stable + additive)
    // ----------------------------
    const out = {
      success: true,
      header: {
        website: header.website || header.url || raw?.url || "",
        report_id: header.report_id || header.id || reportId,
        created_at: header.created_at || raw?.created_at || "",
      },
      scores,
      narrative: {
        overall: { lines: lineify(n) },
      },
      top_issues,
      delivery_signals, // NEW
      findings,         // NEW
      raw,              // debugging
    };

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(out),
    };
  } catch (err) {
    console.error("[get-report-data-pdf] crash:", err);
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
