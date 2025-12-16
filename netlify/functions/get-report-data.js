// /.netlify/functions/get-report-data.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
function asArray(v) {
  return Array.isArray(v) ? v : [];
}
function isNumeric(v) {
  return /^[0-9]+$/.test(String(v));
}
function clamp0_100(v, fallback = 0) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, Math.round(n)));
}
function asBool(v) {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}
function isMissing(v) {
  return v === null || v === undefined;
}

function makeObservation(label, value, source) {
  return { label, value, source };
}
function makeDeduction(code, reason, points, evidence = {}) {
  return { code, reason, points: Math.abs(Number(points) || 0), evidence: safeObj(evidence) };
}
function makeIssue(title, impact, severity, evidence = {}) {
  return { title, impact, severity, evidence: safeObj(evidence) };
}

function extractEvidence(metrics) {
  const m = safeObj(metrics);
  const bc = safeObj(m.basic_checks);
  const freshness = safeObj(bc.freshness_signals);
  const sec = safeObj(bc.security);
  const hdr = safeObj(bc.security_headers);

  return {
    http_status: bc.http_status ?? null,
    content_type: bc.content_type ?? null,
    final_url: bc.final_url ?? bc.final_url_resolved ?? null,

    title_present: asBool(bc.title_present),
    title_text: bc.title_text ?? null,

    meta_description_present: asBool(bc.meta_description_present ?? bc.description_present),
    canonical_present: asBool(bc.canonical_present),
    canonical_href: bc.canonical_href ?? null,

    h1_present: asBool(bc.h1_present),
    viewport_present: asBool(bc.viewport_present),
    viewport_content: bc.viewport_content ?? null,

    html_bytes: bc.html_bytes ?? null,
    img_count: bc.img_count ?? null,
    img_alt_count: bc.img_alt_count ?? null,

    freshness_last_modified_present: asBool(freshness.last_modified_header_present),
    freshness_last_modified_value: freshness.last_modified_header_value ?? null,
    copyright_year_min: freshness.copyright_year_min ?? null,
    copyright_year_max: freshness.copyright_year_max ?? null,

    https: asBool(bc.https ?? bc.ssl),
    hsts_present: asBool(hdr.hsts_present ?? sec.hsts_present),
    csp_present: asBool(hdr.csp_present ?? sec.csp_present),
    x_frame_options_present: asBool(hdr.x_frame_options_present ?? sec.x_frame_options_present),
    x_content_type_options_present: asBool(
      hdr.x_content_type_options_present ?? sec.x_content_type_options_present
    ),
    referrer_policy_present: asBool(hdr.referrer_policy_present ?? sec.referrer_policy_present),
  };
}

function scoreSignal({ id, label, baseScore, evidence }) {
  const observations = [];
  const issues = [];
  const deductions = [];

  function requireObs(value, code, expectedLabel, points, source) {
    observations.push(makeObservation(expectedLabel, value, source));
    if (isMissing(value)) {
      deductions.push(makeDeduction(code, `Missing: ${expectedLabel}`, points, { expected: expectedLabel }));
      issues.push(
        makeIssue(
          `${label}: required signal missing`,
          `This scan could not observe: ${expectedLabel}. Missing inputs are treated as a penalty to preserve completeness.`,
          "med",
          { missing: expectedLabel }
        )
      );
      return false;
    }
    return true;
  }

  function requireTrue(boolVal, code, title, points, source, impact, severity = "med") {
    observations.push(makeObservation(title, boolVal, source));
    if (boolVal === null) {
      deductions.push(makeDeduction(code, `Missing: ${title}`, points, { expected: title }));
      issues.push(
        makeIssue(
          `${label}: required signal missing`,
          `This scan could not observe: ${title}. Missing inputs are treated as a penalty to preserve completeness.`,
          severity,
          { missing: title }
        )
      );
      return false;
    }
    if (boolVal === false) {
      deductions.push(makeDeduction(code, `${title} failed`, points, { observed: boolVal }));
      issues.push(makeIssue(`${label}: ${title} not satisfied`, impact, severity, { observed: boolVal }));
      return false;
    }
    return true;
  }

  // Minimal, honest deterministic checks (based on what you already collect)
  if (id === "performance") {
    requireObs(evidence.html_bytes, "perf_missing_html_bytes", "HTML Bytes", 8, "basic_checks.html_bytes");
    requireObs(evidence.img_count, "perf_missing_img_count", "Image Count", 6, "basic_checks.img_count");

    if (!isMissing(evidence.html_bytes) && Number(evidence.html_bytes) > 250000) {
      deductions.push(makeDeduction("perf_large_html", "HTML payload is large (>250KB)", 8, { html_bytes: evidence.html_bytes }));
      issues.push(
        makeIssue(
          "Large HTML payload",
          "Large pages tend to load slower and can increase bounce rate, especially on mobile connections.",
          "med",
          { html_bytes: evidence.html_bytes }
        )
      );
    }
  }

  if (id === "mobile") {
    requireTrue(
      evidence.viewport_present,
      "mobile_viewport_missing",
      "Viewport Present",
      18,
      "basic_checks.viewport_present",
      "Without a viewport meta tag, mobile devices can render zoomed-out, causing layout and readability problems.",
      "high"
    );
  }

  if (id === "seo") {
    requireTrue(
      evidence.title_present,
      "seo_title_missing",
      "Title Present",
      18,
      "basic_checks.title_present",
      "A missing title reduces search clarity and click-through potential.",
      "high"
    );

    // Meta description: missing signal is penalised (never neutral)
    observations.push(makeObservation("Meta Description Present", evidence.meta_description_present, "basic_checks.meta_description_present"));
    if (evidence.meta_description_present === null) {
      deductions.push(makeDeduction("seo_meta_desc_not_observed", "Missing: Meta Description Present", 8));
      issues.push(
        makeIssue(
          "Meta description not observed",
          "This scan could not confirm whether a meta description exists. Missing signals are penalised to preserve completeness.",
          "low"
        )
      );
    } else if (evidence.meta_description_present === false) {
      deductions.push(makeDeduction("seo_meta_desc_missing", "Meta description missing", 8));
      issues.push(
        makeIssue(
          "Meta description missing",
          "Without a meta description, search snippets are less controlled and can reduce click-through.",
          "low"
        )
      );
    }

    requireTrue(
      evidence.canonical_present,
      "seo_canonical_missing",
      "Canonical Present",
      10,
      "basic_checks.canonical_present",
      "Without a canonical, duplicate URL variants can dilute SEO signals.",
      "med"
    );
  }

  if (id === "security") {
    requireTrue(
      evidence.https,
      "sec_https_not_confirmed",
      "HTTPS",
      30,
      "basic_checks.https",
      "If HTTPS isn’t confirmed, user trust and browser security expectations are compromised.",
      "high"
    );

    // Headers: if not observed, penalise explicitly
    observations.push(makeObservation("HSTS Present", evidence.hsts_present, "basic_checks.security_headers.hsts_present"));
    if (evidence.hsts_present === null) deductions.push(makeDeduction("sec_hsts_not_observed", "Missing: HSTS Present", 8));
    else if (evidence.hsts_present === false) deductions.push(makeDeduction("sec_hsts_missing", "HSTS header missing", 8));

    observations.push(makeObservation("CSP Present", evidence.csp_present, "basic_checks.security_headers.csp_present"));
    if (evidence.csp_present === null) deductions.push(makeDeduction("sec_csp_not_observed", "Missing: CSP Present", 8));
    else if (evidence.csp_present === false) deductions.push(makeDeduction("sec_csp_missing", "Content-Security-Policy header missing", 8));
  }

  if (id === "structure") {
    requireTrue(
      evidence.h1_present,
      "struct_h1_missing",
      "H1 Present",
      12,
      "basic_checks.h1_present",
      "Pages without a clear H1 can be harder for users and search engines to understand at a glance.",
      "med"
    );
  }

  if (id === "accessibility") {
    requireObs(evidence.img_count, "a11y_missing_img_count", "Image Count", 6, "basic_checks.img_count");
    requireObs(evidence.img_alt_count, "a11y_missing_img_alt_count", "Images With ALT", 10, "basic_checks.img_alt_count");

    if (!isMissing(evidence.img_count) && !isMissing(evidence.img_alt_count) && Number(evidence.img_count) > 0) {
      const coverage = Math.round((Number(evidence.img_alt_count) / Number(evidence.img_count)) * 100);
      observations.push(makeObservation("ALT Coverage %", coverage, "derived(img_alt_count/img_count)"));
      if (coverage < 90) {
        deductions.push(makeDeduction("a11y_low_alt_coverage", "ALT coverage under 90%", 12, { coverage_pct: coverage }));
        issues.push(
          makeIssue(
            "Image ALT coverage is low",
            "Missing ALT text reduces accessibility for screen readers and can weaken image SEO context.",
            "med",
            { coverage_pct: coverage, img_alt_count: evidence.img_alt_count, img_count: evidence.img_count }
          )
        );
      }
    }
  }

  const penalty = deductions.reduce((s, d) => s + (Number(d.points) || 0), 0);
  const adjusted = clamp0_100((Number(baseScore) || 0) - penalty);

  return {
    id,
    label,
    base_score: clamp0_100(baseScore),
    score: adjusted,
    penalty_points: penalty,
    observations,
    deductions,
    issues,
  };
}

function buildFindings(signals) {
  const findings = [];
  let idx = 1;
  for (const s of asArray(signals)) {
    for (const i of asArray(s.issues)) {
      findings.push({
        id: `F${String(idx).padStart(3, "0")}`,
        title: i.title,
        impact: i.impact,
        severity: i.severity,
        evidence: i.evidence || {},
        signal: s.id,
      });
      idx++;
    }
  }
  return findings;
}

function buildFixPlan(findings) {
  const high = findings.filter(f => f.severity === "high");
  const med = findings.filter(f => f.severity === "med");
  const low = findings.filter(f => f.severity === "low");

  const toActions = (list) => list.map(f => ({ action: f.title, finding_id: f.id }));

  return [
    { phase: 1, title: "Phase 1 — Trust & blockers", why: "Fix anything that risks user trust, safety, or mobile usability first.", actions: toActions(high) },
    { phase: 2, title: "Phase 2 — Foundations & clarity", why: "Strengthen structure, SEO basics, and accessibility once blockers are resolved.", actions: toActions(med) },
    { phase: 3, title: "Phase 3 — Optimisation & refinement", why: "Polish and incremental improvements after fundamentals are solid.", actions: toActions(low) },
  ];
}

function buildNarrative(narrativeRow) {
  const n = safeObj(narrativeRow);
  const lead = typeof n.executive_lead === "string" ? n.executive_lead.trim() : "";

  if (!lead) {
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
      status: { generated: false, reason: "insufficient_signal_context_at_this_stage" },
    };
  }

  const status = safeObj(n.status);
  return {
    executive_lead: lead,
    final_notes: typeof n.final_notes === "string" ? n.final_notes : "",
    signal_summaries: safeObj(n.signal_summaries),
    status: { generated: status.generated === true, reason: typeof status.reason === "string" ? status.reason : "" },
  };
}

export async function handler(event) {
  try {
    const q = event.queryStringParameters || {};
    const reportId = q.report_id || q.id || q.scan_id;
    if (!reportId) return json(400, { success: false, error: "Missing report_id" });

    // 1) Load scan_results
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

    if (!scan) return json(404, { success: false, error: "Report not found for that report_id" });

    // 2) Optional narrative
    const { data: repRows, error: repErr } = await supabase
      .from("report_data")
      .select("narrative, created_at")
      .eq("report_id", scan.report_id)
      .order("created_at", { ascending: false })
      .limit(1);

    if (repErr) console.warn("[get-report-data] narrative error:", repErr.message);
    const narrativeRow = repRows?.[0]?.narrative || null;

    // 3) Build payload
    const metrics = safeObj(scan.metrics);
    const scoresIn = safeObj(metrics.scores);

    const evidence = extractEvidence(metrics);

    // Base scores from scanner (then adjusted with explicit penalties)
    const base = {
      performance: clamp0_100(scoresIn.performance, 0),
      mobile: clamp0_100(scoresIn.mobile, 0),
      seo: clamp0_100(scoresIn.seo, 0),
      security: clamp0_100(scoresIn.security, 0),
      structure: clamp0_100(scoresIn.structure, 0),
      accessibility: clamp0_100(scoresIn.accessibility, 0),
    };

    // LOCKED ORDER: Performance → Mobile → SEO → Security → Structure → Accessibility
    const delivery_signals = [
      scoreSignal({ id: "performance", label: "Performance", baseScore: base.performance, evidence }),
      scoreSignal({ id: "mobile", label: "Mobile Experience", baseScore: base.mobile, evidence }),
      scoreSignal({ id: "seo", label: "SEO Foundations", baseScore: base.seo, evidence }),
      scoreSignal({ id: "security", label: "Security & Trust", baseScore: base.security, evidence }),
      scoreSignal({ id: "structure", label: "Structure & Semantics", baseScore: base.structure, evidence }),
      scoreSignal({ id: "accessibility", label: "Accessibility", baseScore: base.accessibility, evidence }),
    ];

    // Overall = average of adjusted scores (transparent)
    const overall = clamp0_100(
      delivery_signals.reduce((s, x) => s + (Number(x.score) || 0), 0) / 6,
      clamp0_100(scoresIn.overall, 0)
    );

    const scores = {
      overall,
      performance: delivery_signals[0].score,
      mobile: delivery_signals[1].score,
      seo: delivery_signals[2].score,
      security: delivery_signals[3].score,
      structure: delivery_signals[4].score,
      accessibility: delivery_signals[5].score,
    };

    const key_metrics = {
      http: { status: evidence.http_status, content_type: evidence.content_type, final_url: evidence.final_url },
      page: {
        title_present: evidence.title_present,
        title_text: evidence.title_text,
        canonical_present: evidence.canonical_present,
        canonical_href: evidence.canonical_href,
        h1_present: evidence.h1_present,
        viewport_present: evidence.viewport_present,
        viewport_content: evidence.viewport_content,
        meta_description_present: evidence.meta_description_present,
      },
      content: { html_bytes: evidence.html_bytes, img_count: evidence.img_count, img_alt_count: evidence.img_alt_count },
      freshness: {
        last_modified_header_present: evidence.freshness_last_modified_present,
        last_modified_header_value: evidence.freshness_last_modified_value,
        copyright_year_min: evidence.copyright_year_min,
        copyright_year_max: evidence.copyright_year_max,
      },
      security: {
        https: evidence.https,
        hsts_present: evidence.hsts_present,
        csp_present: evidence.csp_present,
        x_frame_options_present: evidence.x_frame_options_present,
        x_content_type_options_present: evidence.x_content_type_options_present,
        referrer_policy_present: evidence.referrer_policy_present,
      },
    };

    const findings = buildFindings(delivery_signals);
    const fix_plan = buildFixPlan(findings);

    return json(200, {
      success: true,
      contract: {
        name: "iqweb_report_payload",
        version: "1.0.1",
        rules: [
          "Every score has visible evidence (observations + deductions + issues).",
          "Missing is penalised explicitly (never hidden, never neutral).",
          "Narrative is optional and does not block output.",
        ],
        psi: false,
      },

      header: {
        website: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },

      scores,
      delivery_signals,
      key_metrics,
      findings,
      fix_plan,
      narrative: buildNarrative(narrativeRow),
    });
  } catch (err) {
    console.error("[get-report-data]", err);
    return json(500, { success: false, error: "Server error", detail: err?.message || String(err) });
  }
}
