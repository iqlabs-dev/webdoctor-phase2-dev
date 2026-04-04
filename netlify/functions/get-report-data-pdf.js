// netlify/functions/get-report-data-pdf.js
// Purpose: return a stable, PDF-ready payload for get-report-html-pdf.
// It fetches your existing full report JSON (from get-report-data) and normalizes it
// for the summary-style branded PDF.
//
// Notes:
// - Keeps existing deterministic executive summary fallback
// - Adds branding normalization for white-label PDF header/footer
// - Tries multiple possible raw branding field names so older builds don't break

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return json(405, { success: false, error: "Method not allowed" });
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id ||
          event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl =
      siteUrl +
      "/.netlify/functions/get-report-data?report_id=" +
      encodeURIComponent(reportId);

    const rawText = await fetchTextWithTimeout(srcUrl, FETCH_TIMEOUT_MS);

    let raw;
    try {
      raw = JSON.parse(rawText || "{}");
    } catch (e) {
      return json(500, {
        success: false,
        error: "Source report endpoint returned non-JSON",
        sample: (rawText || "").slice(0, 600),
      });
    }

    if (!raw || raw.success !== true) {
      return json(500, {
        success: false,
        error: "Source report endpoint returned success=false",
      });
    }

    const header = safeObj(raw.header);
    const scores = safeObj(raw.scores);
    const narrative = safeObj(raw.narrative);
    const findings = safeObj(raw.findings || raw.finding);

    const deliverySignals =
      (Array.isArray(raw.delivery_signals) && raw.delivery_signals) ||
      (Array.isArray(raw.deliverySignals) && raw.deliverySignals) ||
      (Array.isArray(raw.signals) && raw.signals) ||
      [];

    const normalizedSignals = deliverySignals.map((sig) => {
      const out = safeObj(sig);
      const o = { ...out };

      o.label = o.label || o.name || o.id || "Signal";
      o.id = o.id || o.label;

      if (typeof o.score === "undefined" && typeof o.value !== "undefined") {
        o.score = o.value;
      }

      if (!Array.isArray(o.observations) || o.observations.length === 0) {
        const ev =
          o.evidence &&
          typeof o.evidence === "object" &&
          !Array.isArray(o.evidence)
            ? o.evidence
            : null;

        if (ev) {
          o.observations = Object.keys(ev).map((k) => ({
            label: prettifyKey(k),
            value: ev[k],
          }));
        } else {
          o.observations = [];
        }
      }

      if (!Array.isArray(o.deductions)) o.deductions = [];

      return o;
    });

    const topIssues =
      (Array.isArray(raw.top_issues) && raw.top_issues) ||
      (Array.isArray(raw.topIssues) && raw.topIssues) ||
      deriveTopIssuesFromSignals(normalizedSignals);

    const branding = normalizeBranding(raw);

    const pdfPayload = {
      success: true,
      header: {
        website: header.website || header.url || raw.url || raw.website || "",
        report_id: header.report_id || raw.report_id || reportId,
        created_at:
          header.created_at ||
          header.report_date ||
          raw.created_at ||
          raw.report_date ||
          "",
      },
      scores: {
        overall: scores.overall,
        performance: scores.performance,
        mobile: scores.mobile,
        seo: scores.seo,
        security: scores.security,
        structure: scores.structure,
        accessibility: scores.accessibility,
        
          // AI Discoverability signal
  ai_discoverability:
    scores.ai_discoverability ||
    scores.ai ||
    scores.ai_visibility ||
    scores.ai_discovery ||
    null
      },
      branding,
      narrative: deepClone(narrative),
      findings: deepClone(findings),
      delivery_signals: normalizedSignals,
      top_issues: topIssues,
    };

    ensureDeterministicExecutiveSummary(pdfPayload);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify(pdfPayload),
    };
  } catch (err) {
    console.error("[get-report-data-pdf] error:", err);
    return json(500, { success: false, error: err?.message || "Unknown error" });
  }
};

function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function deepClone(v) {
  try {
    return JSON.parse(JSON.stringify(v || {}));
  } catch (_) {
    return safeObj(v);
  }
}

function prettifyKey(k) {
  k = String(k || "").split("_").join(" ");
  return k.replace(/\b\w/g, (m) => m.toUpperCase());
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v) {
  return String(v || "").trim();
}

function firstNonEmpty(...vals) {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return "";
}

function boolFrom(...vals) {
  for (const v of vals) {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1" || v === "true") return true;
    if (v === 0 || v === "0" || v === "false") return false;
  }
  return false;
}

function firstNonEmptyObject(...vals) {
  for (const v of vals) {
    if (v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length > 0) {
      return v;
    }
  }
  return {};
}

function normalizeBranding(raw) {
  const branding = firstNonEmptyObject(
    raw.branding,
    raw.white_label,
    raw.whiteLabel,
    raw.report_branding,
    raw.reportBranding
  );

  const companyName = firstNonEmpty(
    branding.company_name,
    branding.companyName,
    branding.name,
    raw.company_name,
    raw.companyName
  );

  const companyWebsite = firstNonEmpty(
    branding.website,
    branding.company_website,
    branding.companyWebsite
  );

  const companyEmail = firstNonEmpty(
    branding.email,
    branding.company_email,
    branding.companyEmail
  );

  const companyPhone = firstNonEmpty(
    branding.phone,
    branding.company_phone,
    branding.companyPhone
  );

  const reportTitle = firstNonEmpty(
    branding.report_title,
    branding.reportTitle,
    branding.title,
    "Website Report"
  );

  const logoUrl = firstNonEmpty(
    branding.logo_url,
    branding.logoUrl,
    branding.logo,
    branding.logo_path,
    branding.logoPath
  );

  const bannerUrl = firstNonEmpty(
    branding.banner_url,
    branding.bannerUrl,
    branding.banner,
    branding.banner_path,
    branding.bannerPath,
    branding.header_image_url,
    branding.headerImageUrl
  );

  const showHeaderContact = boolFrom(
    branding.show_header_contact,
    branding.showHeaderContact,
    branding.show_contact_header,
    branding.showContactHeader,
    branding.header_show_contact,
    branding.headerShowContact
  );

  const showFooterContact = boolFrom(
    branding.show_footer_contact,
    branding.showFooterContact,
    branding.show_contact_footer,
    branding.showContactFooter,
    branding.footer_show_contact,
    branding.footerShowContact
  );

  const showPoweredBy = boolFrom(
    branding.show_powered_by,
    branding.showPoweredBy,
    branding.show_powered_by_iqweb,
    branding.showPoweredByIqweb,
    branding.show_attribution,
    branding.showAttribution
  );

  return {
    company_name: companyName,
    website: companyWebsite,
    email: companyEmail,
    phone: companyPhone,
    report_title: reportTitle || "Website Report",
    logo_url: logoUrl,
    banner_url: bannerUrl,
    show_header_contact: showHeaderContact,
    show_footer_contact: showFooterContact,
    show_powered_by: showPoweredBy,
  };
}

function ensureDeterministicExecutiveSummary(payload) {
  if (!payload || payload.success !== true) return;

  const n = safeObj(payload.narrative);
  const f = safeObj(payload.findings);

  const existing =
    (n.overall && Array.isArray(n.overall.lines) && n.overall.lines.length) ||
    (n.executive && Array.isArray(n.executive.lines) && n.executive.lines.length) ||
    (f.overall && Array.isArray(f.overall.lines) && f.overall.lines.length) ||
    (f.executive && Array.isArray(f.executive.lines) && f.executive.lines.length);

  if (existing) return;

  const scores = safeObj(payload.scores);

  const overall = numOrNull(scores.overall);
  const domains = [
    { key: "performance", label: "Performance", score: numOrNull(scores.performance) },
    { key: "mobile", label: "Mobile Experience", score: numOrNull(scores.mobile) },
    { key: "seo", label: "SEO Foundations", score: numOrNull(scores.seo) },
    { key: "security", label: "Security & Trust", score: numOrNull(scores.security) },
    { key: "structure", label: "Structure & Semantics", score: numOrNull(scores.structure) },
    { key: "accessibility", label: "Accessibility", score: numOrNull(scores.accessibility) },
  ].filter((d) => d.score !== null);

  domains.sort((a, b) => a.score - b.score);

  const primary = domains[0];
  const secondary = domains[1];

  const lines = [];
  if (overall !== null) lines.push(`Overall Delivery: ${overall}/100.`);
  if (primary) lines.push(`Primary Fix: ${primary.label} (${primary.score}/100).`);
  if (secondary) lines.push(`Secondary Fix: ${secondary.label} (${secondary.score}/100).`);
  lines.push("Re-scan after changes to confirm measurable improvement.");

  payload.narrative = safeObj(payload.narrative);
  payload.narrative.overall = { lines };
  payload.narrative.executive = { lines };
}

function deriveTopIssuesFromSignals(signals) {
  const out = [];
  const seen = new Set();

  for (const sig of signals) {
    const sigName = String(sig?.label || sig?.id || "Signal").trim() || "Signal";
    const deds = Array.isArray(sig?.deductions) ? sig.deductions : [];
    for (const d of deds) {
      const reason = String(d?.reason || "").trim();
      if (!reason) continue;
      const item = `${sigName}: ${reason}`;
      if (seen.has(item)) continue;
      seen.add(item);
      out.push(item);
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }

  return out;
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 600)}`);
    if (!txt || txt.length < 2) throw new Error("Empty response from source report endpoint");
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}