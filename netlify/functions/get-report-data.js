// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// -----------------------------
// Response helpers
// -----------------------------
function json(statusCode, obj) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}

function isNumeric(v) {
  return /^[0-9]+$/.test(String(v));
}

function toInt0_100(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return Math.max(0, Math.min(100, r));
}

function requireField(cond, msg) {
  if (!cond) throw new Error(msg);
}

// -----------------------------
// Contract builders (LOCKED)
// -----------------------------
function buildDeliverySignals(scores) {
  // LOCKED discussion order:
  // Performance → Mobile → SEO → Security → Structure → Accessibility
  return [
    {
      id: "performance",
      label: "Performance",
      score: toInt0_100(scores.performance) ?? 0,
      summary: "",
      finding_ids: [],
    },
    {
      id: "mobile",
      label: "Mobile Experience",
      score: toInt0_100(scores.mobile) ?? 0,
      summary: "",
      finding_ids: [],
    },
    {
      id: "seo",
      label: "SEO Foundations",
      score: toInt0_100(scores.seo) ?? 0,
      summary: "",
      finding_ids: [],
    },
    {
      id: "security",
      label: "Security & Trust",
      score: toInt0_100(scores.security) ?? 0,
      summary: "",
      finding_ids: [],
    },
    {
      id: "structure",
      label: "Structure & Semantics",
      score: toInt0_100(scores.structure) ?? 0,
      summary: "",
      finding_ids: [],
    },
    {
      id: "accessibility",
      label: "Accessibility",
      score: toInt0_100(scores.accessibility) ?? 0,
      summary: "",
      finding_ids: [],
    },
  ];
}

function buildKeyMetricsFromScan(metrics) {
  // We map from your existing scan.metrics.basic_checks.*
  // This is deterministic and non-AI.
  const m = safeObj(metrics);
  const bc = safeObj(m.basic_checks);

  // Your scan already includes these (based on your earlier payloads):
  // http_status, content_type, canonical_href, title_present/title_text, viewport_present/viewport_content,
  // h1_present, html_bytes, img_count, img_alt_count, plus freshness_signals + security headers.
  const freshness = safeObj(bc.freshness_signals);
  const headers = safeObj(bc.security_headers); // if you have it
  const sec = safeObj(bc.security); // if you have it

  // Prefer explicit security header booleans if present, otherwise fall back to whatever exists.
  const keySecurity = {
    https: bc.https ?? bc.ssl ?? null,
    hsts_present: headers.hsts_present ?? sec.hsts_present ?? null,
    csp_present: headers.csp_present ?? sec.csp_present ?? null,
    x_frame_options_present: headers.x_frame_options_present ?? sec.x_frame_options_present ?? null,
    x_content_type_options_present: headers.x_content_type_options_present ?? sec.x_content_type_options_present ?? null,
    referrer_policy_present: headers.referrer_policy_present ?? sec.referrer_policy_present ?? null,
  };

  return {
    http: {
      status: bc.http_status ?? null,
      final_url: bc.final_url ?? bc.final_url_resolved ?? bc.canonical_href ?? null,
      content_type: bc.content_type ?? null,
    },
    page: {
      title_present: bc.title_present ?? null,
      title_text: bc.title_text ?? null,
      meta_description_present: bc.meta_description_present ?? bc.description_present ?? null,
      canonical_present: bc.canonical_present ?? null,
      canonical_href: bc.canonical_href ?? null,
      h1_present: bc.h1_present ?? null,
      viewport_present: bc.viewport_present ?? null,
      viewport_content: bc.viewport_content ?? null,
    },
    content: {
      html_bytes: bc.html_bytes ?? null,
      img_count: bc.img_count ?? null,
      img_alt_count: bc.img_alt_count ?? null,
    },
    freshness: {
      last_modified_header_present: freshness.last_modified_header_present ?? null,
      last_modified_header_value: freshness.last_modified_header_value ?? null,
      copyright_year_min: freshness.copyright_year_min ?? null,
      copyright_year_max: freshness.copyright_year_max ?? null,
    },
    security: keySecurity,
  };
}

function buildNarrativeLayer(narrativeRow) {
  const n = safeObj(narrativeRow);

  // If you already stored narrative as an object with executive_lead etc, preserve it.
  // If it's empty/absent, enforce locked status block.
  const hasLead = typeof n.executive_lead === "string" && n.executive_lead.trim().length > 0;

  if (!n || Object.keys(n).length === 0 || !hasLead) {
    return {
      executive_lead: "",
      final_notes: "",
      signal_summaries: {
        performance: "",
        mobile: "",
        seo: "",
        security: "",
        structure: "",
        accessibility: "",
      },
      status: {
        generated: false,
        reason: "insufficient_signal_context_at_this_stage",
      },
    };
  }

  // Ensure status exists even when narrative exists (good hygiene)
  const status = safeObj(n.status);
  return {
    executive_lead: typeof n.executive_lead === "string" ? n.executive_lead : "",
    final_notes: typeof n.final_notes === "string" ? n.final_notes : "",
    signal_summaries: safeObj(n.signal_summaries),
    status: {
      generated: status.generated === true,
      reason: typeof status.reason === "string" ? status.reason : "",
    },
  };
}

function validatePayload(payload) {
  // Header required
  requireField(payload?.header?.website, "Contract violation: missing header.website");
  requireField(payload?.header?.report_id, "Contract violation: missing header.report_id");
  requireField(payload?.header?.created_at, "Contract violation: missing header.created_at");

  // Scores required
  const s = safeObj(payload?.scores);
  const required = ["overall", "performance", "mobile", "seo", "security", "structure", "accessibility"];
  for (const k of required) {
    requireField(Number.isFinite(Number(s[k])), `Contract violation: missing scores.${k}`);
  }

  // Delivery signals required (exactly 6)
  requireField(Array.isArray(payload.delivery_signals), "Contract violation: missing delivery_signals array");
  requireField(payload.delivery_signals.length === 6, "Contract violation: delivery_signals must have 6 items");

  const order = payload.delivery_signals.map(x => x?.id).join(",");
  const lockedOrder = "performance,mobile,seo,security,structure,accessibility";
  requireField(order === lockedOrder, `Contract violation: delivery_signals order must be ${lockedOrder} (got ${order})`);

  // Key metrics required (object; can contain nulls, but must exist)
  requireField(payload?.key_metrics && typeof payload.key_metrics === "object", "Contract violation: missing key_metrics object");

  // Findings + fix_plan must exist (can be empty arrays)
  requireField(Array.isArray(payload.findings), "Contract violation: findings must be an array (can be empty)");
  requireField(Array.isArray(payload.fix_plan), "Contract violation: fix_plan must be an array (can be empty)");

  // Narrative must exist with status
  requireField(payload?.narrative && typeof payload.narrative === "object", "Contract violation: missing narrative object");
  requireField(payload?.narrative?.status && typeof payload.narrative.status === "object", "Contract violation: missing narrative.status");
  requireField(payload?.narrative?.status?.generated === false || payload?.narrative?.status?.generated === true, "Contract violation: narrative.status.generated must be boolean");
}

// -----------------------------
// Handler
// -----------------------------
export async function handler(event) {
  try {
    const q = event.queryStringParameters || {};
    const reportId = q.report_id || q.id || q.scan_id;

    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    // 1) Load scan_results (truth)
    let scan = null;

    if (isNumeric(reportId)) {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("id", Number(reportId))
        .single();

      if (error) console.warn("[get-report-data] scan by id error:", error.message);
      scan = data || null;
    } else {
      const { data, error } = await supabase
        .from("scan_results")
        .select("*")
        .eq("report_id", reportId)
        .order("created_at", { ascending: false })
        .limit(1);

      if (error) console.warn("[get-report-data] scan by report_id error:", error.message);
      scan = data?.[0] || null;
    }

    if (!scan) {
      return json(404, { success: false, error: "Report not found for that report_id" });
    }

    // 2) Load narrative (optional)
    const { data: repRows, error: repErr } = await supabase
      .from("report_data")
      .select("narrative, created_at")
      .eq("report_id", scan.report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (repErr) console.warn("[get-report-data] narrative error:", repErr.message);
    const narrativeRow = repRows?.[0]?.narrative || null;

    // 3) Build LOCKED payload v1.0
    const scanMetrics = safeObj(scan.metrics);
    const scanScores = safeObj(scanMetrics.scores);

    // Enforce numeric score fields (no gaps)
    const scores = {
      overall: toInt0_100(scanScores.overall) ?? 0,
      performance: toInt0_100(scanScores.performance) ?? 0,
      mobile: toInt0_100(scanScores.mobile) ?? 0,
      seo: toInt0_100(scanScores.seo) ?? 0,
      security: toInt0_100(scanScores.security) ?? 0,
      structure: toInt0_100(scanScores.structure) ?? 0,
      accessibility: toInt0_100(scanScores.accessibility) ?? 0,
    };

    const payload = {
      success: true,

      contract: {
        name: "iqweb_scan_payload",
        version: "1.0",
        psi: false,
        narrative_optional: true,
      },

      header: {
        website: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
        scanner_version: "get-report-data@1.0",
      },

      scores,

      // LOCKED discussion order cards always present
      delivery_signals: buildDeliverySignals(scores),

      // Deterministic evidence surface (must exist)
      key_metrics: buildKeyMetricsFromScan(scanMetrics),

      // Day 1–2: allow empty arrays, but must exist
      findings: [],

      fix_plan: [
        {
          phase: 1,
          title: "Baseline fixes (highest confidence)",
          why: "Deterministic improvements that strengthen trust and user experience.",
          actions: [],
        },
        {
          phase: 2,
          title: "Clarity & structure improvements",
          why: "Improves understanding for users and search engines.",
          actions: [],
        },
        {
          phase: 3,
          title: "Optimisation & refinement (optional)",
          why: "Enhancements once fundamentals are resolved.",
          actions: [],
        },
      ],

      narrative: buildNarrativeLayer(narrativeRow),

      // Optional: include legacy raw surfaces for debugging only (does not affect UI)
      _legacy: {
        report: {
          id: scan.id,
          report_id: scan.report_id,
          url: scan.url,
          created_at: scan.created_at,
          status: scan.status,
          report_url: scan.report_url || null,
        },
        metrics: scanMetrics,
      },
    };

    // 4) Contract validation: fail loudly (no gap reports)
    validatePayload(payload);

    return json(200, payload);
  } catch (err) {
    console.error("[get-report-data]", err);

    // Fail loudly with contract detail so you can fix fast
    return json(500, {
      success: false,
      error: "Report payload incomplete (contract violation).",
      detail: err?.message || String(err),
    });
  }
}
