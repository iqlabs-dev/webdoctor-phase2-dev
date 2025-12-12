// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ---------------------------------------------
// Helpers: clamping + calibrated scoring model
// ---------------------------------------------
function clampScore(value) {
  const n = typeof value === "number" ? value : 0;
  if (Number.isNaN(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/**
 * Hybrid scoring:
 * - Uses existing per-signal scores as a base.
 * - Applies strong penalties for missing fundamentals.
 * - Recomputes overall score using weighted categories.
 * - Keeps per-signal scale familiar, but enforces realistic ceilings.
 */
function calibrateScores(rawScores = {}, basicChecks = {}) {
  const base = {
    performance: clampScore(rawScores.performance),
    seo: clampScore(rawScores.seo),
    structure_semantics: clampScore(rawScores.structure_semantics),
    mobile_experience: clampScore(rawScores.mobile_experience),
    security_trust: clampScore(rawScores.security_trust),
    accessibility: clampScore(rawScores.accessibility),
    domain_hosting: clampScore(rawScores.domain_hosting),
    content_signals: clampScore(rawScores.content_signals),
  };

  const {
    title_present,
    meta_description_present,
    viewport_present,
    h1_present,
    html_length,
  } = basicChecks || {};

  // --- 1. Hard penalties for missing fundamentals (site-wide impact) ---
  let penalty = 0;

  if (viewport_present === false) penalty += 25;
  if (h1_present === false) penalty += 20;
  if (meta_description_present === false) penalty += 15;
  if (title_present === false) penalty += 10;
  if (typeof html_length === "number" && html_length > 0 && html_length < 400) {
    penalty += 10;
  }

  // Cap penalty so we don't annihilate the score completely
  penalty = Math.min(penalty, 40);

  // --- 2. Targeted ceilings on specific signals when fundamentals are missing ---
  let mobile = base.mobile_experience;
  if (viewport_present === false) {
    // Missing viewport: mobile UX can never be "excellent"
    mobile = Math.min(mobile, 60);
  }

  let structure = base.structure_semantics;
  if (h1_present === false) {
    structure = Math.min(structure, 65);
  }
  if (typeof html_length === "number" && html_length > 0 && html_length < 400) {
    structure = Math.min(structure, 70);
  }

  let seo = base.seo;
  if (meta_description_present === false) {
    seo = Math.min(seo, 70);
  }
  if (title_present === false) {
    seo = Math.min(seo, 60);
  }

  // Security, content, domain, accessibility remain mostly as-is
  const performance = base.performance;
  const security = base.security_trust;
  const accessibility = base.accessibility;
  const domain = base.domain_hosting;
  const content = base.content_signals;

  // --- 3. Weighted overall score (elite weighting model) ---
  const weights = {
    mobile_experience: 25,
    structure_semantics: 20,
    seo: 15,
    content_signals: 10,
    performance: 10,
    security_trust: 10,
    accessibility: 5,
    domain_hosting: 5,
  };

  const weightedSum =
    mobile * weights.mobile_experience +
    structure * weights.structure_semantics +
    seo * weights.seo +
    content * weights.content_signals +
    performance * weights.performance +
    security * weights.security_trust +
    accessibility * weights.accessibility +
    domain * weights.domain_hosting;

  let overall = weightedSum / 100;

  // Apply global penalty
  overall -= penalty;
  overall = clampScore(overall);

  return {
    overall,
    performance,
    seo,
    structure_semantics: structure,
    mobile_experience: mobile,
    security_trust: security,
    accessibility,
    domain_hosting: domain,
    content_signals: content,
  };
}

// ---------------------------------------------
// Helper: build AI payload from scan row
// ---------------------------------------------
function buildAiPayloadFromScan(scan) {
  const metrics = scan.metrics || {};
  const basic = metrics.basic_checks || {};
  const rawScores = metrics.scores || {};
  const psiMobile = metrics.psi_mobile || null;
  const https = metrics.https ?? null;
  const speedStability = metrics.speed_stability || null;

  // Use calibrated scores for AI payload
  const calibrated = calibrateScores(rawScores, basic);

  return {
    report_id: scan.report_id,
    url: scan.url,
    http_status: metrics.http_status ?? null,
    https,
    scores: {
      overall: calibrated.overall ?? null,
      performance: calibrated.performance ?? null,
      seo: calibrated.seo ?? null,
      structure_semantics: calibrated.structure_semantics ?? null,
      mobile_experience: calibrated.mobile_experience ?? null,
      security_trust: calibrated.security_trust ?? null,
      accessibility: calibrated.accessibility ?? null,
      domain_hosting: calibrated.domain_hosting ?? null,
      content_signals: calibrated.content_signals ?? null,
    },
    // keep CWV here in case we re-use it later
    core_web_vitals:
      metrics.core_web_vitals || psiMobile?.coreWebVitals || null,
    speed_stability: speedStability,
    basic_checks: {
      title_present: basic.title_present ?? null,
      meta_description_present: basic.meta_description_present ?? null,
      viewport_present: basic.viewport_present ?? null,
      h1_present: basic.h1_present ?? null,
      html_length: basic.html_length ?? null,
    },
  };
}

// ---------------------------------------------
// Λ i Q — AI narrative generator (JSON object)
// ---------------------------------------------
async function generateNarrativeAI(scan) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set; using fallback narrative.");
    return null;
  }

  const payload = buildAiPayloadFromScan(scan);

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.45,
        max_tokens: 900,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              // ------------------------------------------------------
              // Λ i Q — Elite Narrative Engine (S-Tier)
              // ------------------------------------------------------
              "You are Λ i Q, the narrative intelligence engine behind iQWEB.",
              "Your role is to translate raw scan data into clear, confident, founder-ready insights.",
              "Tone: concise, direct, senior-agency level. No fluff, no filler, no academic padding.",
              "Write as if advising a smart founder who values clarity, speed, and practical direction.",
              "Preferred voice: calm, expert, decisive. Short sentences. Strong verbs.",
              "Avoid weak language such as 'appears to', 'suggests', 'may benefit'.",
              "Never repeat the same idea using different words.",
              "Never mention numeric scores, percentages, or Core Web Vitals.",
              "Focus only on behaviour: speed, stability, clarity, search reliability, mobile comfort, trust signals, accessibility, domain integrity, and content strength.",

              // ------------------------------------------------------
              // TONE ADJUSTMENT — based on overall quality (no numbers)
              // ------------------------------------------------------
              "TONE ADJUSTMENT RULES BASED ON SCORES (do NOT mention numbers):",

              "If the site’s overall quality is strong:",
              "- Sound calm, assured, and precise.",
              "- Emphasise stability, polish, and small meaningful gains.",
              "- Focus on refinement and consistency, not heavy fixes.",

              "If the site is mid-range:",
              "- Be clear, direct, and constructive.",
              "- Highlight improvements that deliver noticeable user benefit.",
              "- Prioritise clarity, mobile experience, structure, and trust signals.",

              "If the site is under-performing:",
              "- Be firm but supportive.",
              "- Focus on fundamental weaknesses limiting usability, clarity, or trust.",
              "- Use strong verbs: 'missing', 'hindering', 'reducing', 'limiting'.",
              "- Recommend fixes that unlock meaningful progress without overwhelming the user.",

              "General tone rules:",
              "- Never exaggerate ('major issue', 'critical failure').",
              "- Never minimise ('just small things').",
              "- Speak like a senior web strategist delivering a clean, honest assessment.",
              "- Every sentence must provide real value.",

              // ------------------------------------------------------
              // FOUNDER SUMMARY LAYER
              // ------------------------------------------------------
              "FOUNDER SUMMARY LAYER:",
              "Return a field called founder_summary (string).",
              "This is a single paragraph that:",
              "- speaks directly to the founder,",
              "- describes the site’s current state in plain language,",
              "- frames the opportunity unlocked by fixing fundamentals,",
              "- avoids technical jargon,",
              "- does not simply repeat the individual signal comments.",
              "It should feel human, calm, and helpful, like a strategist summarising the whole picture.",

              // ------------------------------------------------------
              // CONFIDENCE INDICATOR
              // ------------------------------------------------------
              "CONFIDENCE INDICATOR:",
              "Return a field called confidence_indicator (string).",
              "Choose ONE short phrase that describes the site’s overall condition without mentioning numbers.",
              "Examples:",
              "- 'Strong foundation — refine clarity'",
              "- 'Stable but under-structured'",
              "- 'Moderate instability — fundamentals incomplete'",
              "- 'Low clarity — fix foundation first'",
              "- 'Healthy base — improve search presentation'",
              "The phrase must be calm, objective, and non-dramatic.",

              // ------------------------------------------------------
              // OUTPUT FORMAT — strict JSON schema
              // ------------------------------------------------------
              "OUTPUT FORMAT:",
              "Return a JSON object with EXACT keys:",
              "overall_summary (string),",
              "founder_summary (string),",
              "confidence_indicator (string),",
              "performance_comment (string or null),",
              "seo_comment (string or null),",
              "structure_comment (string or null),",
              "mobile_comment (string or null),",
              "security_comment (string or null),",
              "accessibility_comment (string or null),",
              "domain_comment (string or null),",
              "content_comment (string or null),",
              "top_issues (array of objects with keys: title, impact, suggested_fix),",
              "fix_sequence (array of short, direct steps),",
              "closing_notes (string or null),",
              "three_key_metrics (array of EXACTLY 3 objects with keys: label, insight).",

              // ------------------------------------------------------
              // FIX SEQUENCE — Strategic 4-phase roadmap + impact
              // ------------------------------------------------------
              "FIX SEQUENCE RULES:",
              "Instead of a plain unordered list, fix_sequence must represent a 4-phase roadmap.",
              "Each item in fix_sequence is a single string using this pattern:",
              "'Phase X — [Phase Name]: [Short fix action] — Impact: [Short human explanation of why it matters]'.",

              "Use these four phases in this exact logical order:",
              "Phase 1 — Foundation",
              "Phase 2 — Experience & Clarity",
              "Phase 3 — Trust & Professionalism",
              "Phase 4 — Optional Enhancements",

              "Phase rules:",
              "- Phase 1 — Foundation: structural issues that block clarity, search, or basic mobile behaviour.",
              "- Phase 2 — Experience & Clarity: usability, readability, layout, and interaction improvements.",
              "- Phase 3 — Trust & Professionalism: policies, contact visibility, consistency, and reliability signals.",
              "- Phase 4 — Optional Enhancements: low-impact polish and long-term refinements.",

              "For each phase, include 0–4 fixes depending on the site’s needs.",
              "Never exceed 12 total fixes across all phases.",
              "Do not repeat the same fix in different words.",
              "Keep each fix short, direct, and high-leverage.",
              "The 'Impact' clause must be one short clause in plain language describing the user or business effect.",
              "Never use technical jargon in the Impact clause.",
              "If the site is strong, focus on refinement-level fixes.",
              "If the site is weak, prioritise Phase 1 and Phase 2 fundamentals and keep phases 3–4 minimal.",

              // ------------------------------------------------------
              // STYLE RULES — no fluff, real insight
              // ------------------------------------------------------
              "STYLE RULES:",
              "- Insights must be specific but free of unnecessary jargon.",
              "- Use active voice wherever possible.",
              "- Every sentence must deliver value — avoid padding.",
              "- Highlight root causes, not vague symptoms.",
              "- Fixes must feel achievable and practical for a real business owner.",
              "- Never invent details not supported by the scan payload.",
              "- If data is insufficient, provide a short, honest, high-level observation instead of guessing."
            ].join(" "),
          },
          {
            role: "user",
            content: JSON.stringify(payload),
          },
        ],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      console.error(
        "OpenAI narrative error:",
        res.status,
        res.statusText,
        txt.slice(0, 300)
      );
      return null;
    }

    const json = await res.json();
    const raw = json?.choices?.[0]?.message?.content;
    if (!raw || typeof raw !== "string") {
      console.error("OpenAI narrative: empty content");
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error("OpenAI narrative JSON parse error:", err, "RAW:", raw);
      return null;
    }

    // Minimal validation – we insist on overall_summary as string
    if (!parsed || typeof parsed.overall_summary !== "string") {
      console.error("OpenAI narrative missing overall_summary");
      return null;
    }

    // Normalise founder_summary + confidence_indicator
    const founderSummary =
      typeof parsed.founder_summary === "string" &&
      parsed.founder_summary.trim().length > 0
        ? parsed.founder_summary.trim()
        : parsed.overall_summary;

    const confidenceIndicator =
      typeof parsed.confidence_indicator === "string" &&
      parsed.confidence_indicator.trim().length > 0
        ? parsed.confidence_indicator.trim()
        : "Assessment available — see summary for context.";

    // Honest normalisation for three_key_metrics
    const inputMetrics = Array.isArray(parsed.three_key_metrics)
      ? parsed.three_key_metrics
      : [];

    const honestMetricFallback = () => ({
      label: "Metric unavailable",
      insight:
        "Unable to generate a reliable narrative for this metric based on the available scan data.",
    });

    const safeThreeKeyMetrics = [0, 1, 2].map((i) => {
      const m = inputMetrics[i];

      if (
        m &&
        typeof m.label === "string" &&
        typeof m.insight === "string" &&
        m.label.trim() &&
        m.insight.trim()
      ) {
        return {
          label: m.label.trim(),
          insight: m.insight.trim(),
        };
      }

      return honestMetricFallback();
    });

    // Normalise optional fields
    return {
      overall_summary: parsed.overall_summary,
      founder_summary: founderSummary,
      confidence_indicator: confidenceIndicator,
      performance_comment: parsed.performance_comment ?? null,
      seo_comment: parsed.seo_comment ?? null,
      structure_comment: parsed.structure_comment ?? null,
      mobile_comment: parsed.mobile_comment ?? null,
      security_comment: parsed.security_comment ?? null,
      accessibility_comment: parsed.accessibility_comment ?? null,
      domain_comment: parsed.domain_comment ?? null,
      content_comment: parsed.content_comment ?? null,
      top_issues: Array.isArray(parsed.top_issues) ? parsed.top_issues : [],
      fix_sequence: Array.isArray(parsed.fix_sequence)
        ? parsed.fix_sequence
        : [],
      closing_notes: parsed.closing_notes ?? null,
      three_key_metrics: safeThreeKeyMetrics,
    };
  } catch (err) {
    console.error("OpenAI narrative exception:", err);
    return null;
  }
}

// ---------------------------------------------
// Honest fallback if AI fails completely
// ---------------------------------------------
function buildFallbackNarrative(/* scores */) {
  const overallText =
    "The AI narrative could not be generated for this scan. This usually means there was an issue reaching the AI service or safely interpreting the scan data.";

  const honestMetric = {
    label: "Metric unavailable",
    insight:
      "This metric could not be generated because the AI narrative was not created for this scan.",
  };

  return {
    // No synthetic “site health” here — just honest status
    overall_summary: overallText,
    founder_summary:
      "We weren’t able to generate a narrative for this scan. Once the connection issue is resolved, you’ll see a clear, human summary of your site’s strengths, risks, and next steps here.",
    confidence_indicator: "Narrative unavailable — retry scan later",

    // No scripted comments for sub-areas
    performance_comment: null,
    seo_comment: null,
    structure_comment: null,
    mobile_comment: null,
    security_comment: null,
    accessibility_comment: null,
    domain_comment: null,
    content_comment: null,

    // No fake issues or steps – if AI didn’t produce them, they stay empty
    top_issues: [],
    fix_sequence: [],

    // Optional closing note – still meta, not pretending to be site-specific
    closing_notes:
      "You can safely regenerate this report later. If the problem continues, please contact support so we can investigate the scan or AI connection.",

    // 3 Key Metrics are also strictly honest: they say *why* they’re missing
    three_key_metrics: [honestMetric, honestMetric, honestMetric],
  };
}

// ---------------------------------------------
// Netlify function handler
// ---------------------------------------------
export default async (request) => {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Method not allowed",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 405, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Parse report_id from query ---
  let reportId;
  try {
    const url = new URL(request.url);
    reportId = url.searchParams.get("report_id");
  } catch (err) {
    console.error("Error parsing request URL:", err);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Invalid request URL",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!reportId) {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Missing report_id",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // --- Load scan_results row for this report ---
  const { data: scan, error: scanError } = await supabase
    .from("scan_results")
    .select("id, url, metrics, report_id, created_at")
    .eq("report_id", reportId)
    .single();

  if (scanError || !scan) {
    console.error("Error loading scan_results:", scanError);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scan result not found",
        scores: {},
        narrative: null,
        narrative_source: "none",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  const metrics = scan.metrics || {};
  const rawScores = metrics.scores || {};
  const basicChecks = metrics.basic_checks || {};

  // Use calibrated scores everywhere downstream
  const scores = calibrateScores(rawScores, basicChecks);

  const coreWebVitals =
    metrics.core_web_vitals || metrics.psi_mobile?.coreWebVitals || null;
  const speedStability = metrics.speed_stability || null;

  // --- 1. Try Λ i Q AI narrative (one-shot JSON) ---
  let narrative = null;
  let narrativeSource = "ai";

  try {
    narrative = await generateNarrativeAI(scan);
  } catch (err) {
    console.error("Error during generateNarrativeAI:", err);
  }

  // --- 2. Fallback if AI failed ---
  if (!narrative) {
    narrativeSource = "fallback";
    narrative = buildFallbackNarrative(scores);
  }

  // --- 3. Save narrative into report_data (best effort) ---
  if (!scan) {
    console.error("No scan row found for report_id:", reportId);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scan not found for this report_id",
      }),
      { status: 404, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    const { error: saveErr } = await supabase
      .from("report_data")
      .upsert(
        {
          report_id: scan.report_id,
          url: scan.url,
          scores,
          narrative,
          created_at: scan.created_at || new Date().toISOString(),
        },
        { onConflict: "report_id" }
      );

    if (saveErr) {
      console.error("Error saving narrative to report_data:", saveErr);
      // non-fatal: we still return the narrative to the UI
    }
  } catch (err) {
    console.error("Exception during report_data upsert:", err);
    // still non-fatal for the UI
  }

  // --- 4. Return to UI ---
  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative,
      narrative_source: narrativeSource,
      report: {
        url: scan.url,
        report_id: scan.report_id,
        created_at: scan.created_at,
      },
      core_web_vitals: coreWebVitals, // unused now but harmless
      speed_stability: speedStability,
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
};
