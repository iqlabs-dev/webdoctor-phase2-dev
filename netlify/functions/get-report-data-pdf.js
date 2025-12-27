// netlify/functions/get-report-data-pdf.js
// Purpose:
// - Return report data as JSON for PDF generation (server-side).
// - Avoid schema assumptions by PROXYING your already-working endpoint: get-report-data.
// - Supports GET (browser/DocRaptor-safe) and POST (internal-safe).
//
// Requires:
// - process.env.URL (Netlify provides) OR falls back to https://iqweb.ai
//
// Output shape (stable):
// {
//   success: true,
//   header: { website, report_id, created_at },
//   scores: { overall, performance, mobile, seo, security, structure, accessibility },
//   narrative: { overall: { lines: [] } },
//   top_issues: [ "..." ],         // NEW (deterministic)
//   raw: <original response>       // kept for debugging (can remove later)
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
      // Return upstream error clearly (so you can see real cause in Netlify logs)
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
      return Number.isFinite(n) ? n : null;
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

    // Recursively search an object for a metric name (case/format tolerant)
    const findMetricValue = (obj, wantedNames) => {
      const wanted = (wantedNames || []).map(normalizeKey);

      const walk = (node) => {
        if (!node) return undefined;

        // Arrays: walk items
        if (Array.isArray(node)) {
          for (const item of node) {
            const found = walk(item);
            if (found !== undefined) return found;
          }
          return undefined;
        }

        // Non-object: nothing to search
        if (typeof node !== "object") return undefined;

        // Object: compare keys, then walk children
        for (const [k, v] of Object.entries(node)) {
          const nk = normalizeKey(k);

          if (wanted.includes(nk)) return v;

          // Some evidence tables might be { metric: "X", value: "Y" }
          if (nk === "metric" && typeof v === "string") {
            const nm = normalizeKey(v);
            if (wanted.includes(nm)) {
              // Try to pull sibling "value"
              const siblingValue =
                node.value ?? node.val ?? node.result ?? node.data ?? undefined;
              if (siblingValue !== undefined) return siblingValue;
            }
          }
        }

        // Walk nested values
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
    // TOP ISSUES (NEW)
    // Deterministic: scores + evidence only. Max 5.
    // ----------------------------
    const buildTopIssues = () => {
      const issues = [];

      // Pull key evidence metrics defensively (works across shapes)
      const cspPresent = asBool(
        findMetricValue(raw, ["Csp Present", "CSP Present", "Content Security Policy Present"])
      );
      const xfoPresent = asBool(
        findMetricValue(raw, ["X Frame Options Present", "X-Frame-Options Present"])
      );
      const permPolicyPresent = asBool(
        findMetricValue(raw, ["Permissions Policy Present", "Permissions-Policy Present"])
      );

      const h1Count = safeInt(findMetricValue(raw, ["H1 Count", "H1 count"]));
      const h1Present = asBool(findMetricValue(raw, ["H1 Present", "H1 present"]));

      const robotsMetaPresent = asBool(
        findMetricValue(raw, ["Robots Meta Present", "Robots meta present"])
      );
      const canonicalMatchesUrl = asBool(
        findMetricValue(raw, ["Canonical Matches Url", "Canonical matches url"])
      );

      const inlineScriptCount = safeInt(
        findMetricValue(raw, ["Inline Script Count", "inline script count"])
      );
      const htmlBytes = safeInt(findMetricValue(raw, ["Html Bytes", "HTML Bytes", "html bytes"]));

      // Priority buckets: Security > SEO > Perf > Accessibility > Other low-scores
      const add = (text, prio) => issues.push({ text, prio });

      // SECURITY hard-fails
      if (cspPresent === false || xfoPresent === false || permPolicyPresent === false) {
        const missing = [];
        if (cspPresent === false) missing.push("Content Security Policy (CSP)");
        if (xfoPresent === false) missing.push("X-Frame-Options");
        if (permPolicyPresent === false) missing.push("Permissions-Policy");

        if (missing.length) {
          add(
            `Missing ${missing.join(
              " and "
            )} headers increases security exposure (Security & Trust).`,
            1
          );
        }
      }

      // SEO structural gaps
      const h1Missing = (h1Present === false) || (typeof h1Count === "number" && h1Count === 0);
      if (h1Missing) {
        add("No H1 heading detected, which can reduce search clarity and relevance (SEO Foundations).", 2);
      }

      if (robotsMetaPresent === false) {
        add("Robots meta tag is missing, which can reduce indexing control and clarity (SEO Foundations).", 2);
      }

      if (canonicalMatchesUrl === false) {
        add("Canonical URL does not match the scanned URL, which can confuse search signals (SEO Foundations).", 2);
      }

      // Performance flags (thresholds are conservative)
      if (typeof inlineScriptCount === "number" && inlineScriptCount > 30) {
        add("High inline script count may increase page weight and reduce performance stability (Performance).", 3);
      }

      if (typeof htmlBytes === "number" && htmlBytes > 500000) {
        add("Large HTML payload size may slow load performance and increase rendering cost (Performance).", 3);
      }

      // Accessibility score trigger (only if low)
      if (typeof scores.accessibility === "number" && scores.accessibility < 70) {
        add("Accessibility score indicates barriers that may impact usability for some users (Accessibility).", 4);
      }

      // If still empty, use score-based triggers (but keep language non-speculative)
      const scoreTriggers = [
        { key: "security", name: "Security & Trust", prio: 5, text: "Security score indicates missing protections that should be addressed (Security & Trust)." },
        { key: "seo", name: "SEO Foundations", prio: 6, text: "SEO score indicates missing foundational elements affecting search clarity (SEO Foundations)." },
        { key: "performance", name: "Performance", prio: 7, text: "Performance score indicates opportunities to reduce load cost and improve stability (Performance)." },
        { key: "structure", name: "Structure & Semantics", prio: 8, text: "Structure score indicates markup or document structure gaps affecting clarity (Structure & Semantics)." },
      ];

      for (const t of scoreTriggers) {
        const val = scores[t.key];
        if (issues.length >= 5) break;
        if (typeof val === "number" && val < 70) {
          // Avoid duplicates if we already have a more specific issue in that area
          const already = issues.some((x) => x.text.toLowerCase().includes(t.name.toLowerCase().split(" ")[0]));
          if (!already) add(t.text, t.prio);
        }
      }

      // Sort by prio then keep max 5 unique
      const out = [];
      const seen = new Set();
      issues
        .sort((a, b) => a.prio - b.prio)
        .forEach((i) => {
          if (out.length >= 5) return;
          const k = i.text.trim();
          if (!k) return;
          if (seen.has(k)) return;
          seen.add(k);
          out.push(k);
        });

      // If still none, fallback (your locked rule)
      if (out.length === 0) {
        out.push("No critical issues were detected based on the current scan thresholds.");
      }

      return out;
    };

    const top_issues = buildTopIssues();

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
        overall: {
          lines: lineify(n),
        },
      },
      top_issues, // NEW
      // keep the original response for debugging (remove later if you want)
      raw,
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
