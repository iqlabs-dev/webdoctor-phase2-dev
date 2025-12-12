// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ---------------------------------------------
// Soft-rebalanced overall scoring (Option A)
// ---------------------------------------------
function computeOverallScore(rawScores = {}, basicChecks = {}) {
  const s = rawScores || {};

  // Soft weights – fair, realistic, founder-friendly
  const weights = {
    performance: 0.16,
    seo: 0.16,
    structure_semantics: 0.16,
    mobile_experience: 0.16,
    security_trust: 0.12,
    accessibility: 0.08,
    domain_hosting: 0.06,
    content_signals: 0.10,
  };

  let weightedSum = 0;
  let weightTotal = 0;

  for (const [key, w] of Object.entries(weights)) {
    const v = s[key];
    if (typeof v === "number" && !Number.isNaN(v)) {
      weightedSum += v * w;
      weightTotal += w;
    }
  }

  if (weightTotal === 0) {
    return null;
  }

  let baseScore = weightedSum / weightTotal;

  // -----------------------------
  // Soft penalties for foundations
  // (A – fair & realistic)
  // -----------------------------
  let penalty = 0;

  if (basicChecks.viewport_present === false) {
    // no viewport: hurts mobile quite a lot
    penalty += 8;
  }

  if (basicChecks.h1_present === false) {
    // no H1: structure & clarity weakened
    penalty += 6;
  }

  if (basicChecks.meta_description_present === false) {
    // no meta description: weaker snippet clarity
    penalty += 6;
  }

  const htmlLength = basicChecks.html_length;
  if (typeof htmlLength === "number") {
    if (htmlLength < 500) {
      // extremely thin markup – likely under-built
      penalty += 4;
    } else if (htmlLength > 200000) {
      // absurdly large markup – mild hit for bloat
      penalty += 3;
    }
  }

  let finalScore = baseScore - penalty;

  if (!Number.isFinite(finalScore)) {
    return null;
  }

  if (finalScore < 0) finalScore = 0;
  if (finalScore > 100) finalScore = 100;

  // keep one decimal place (eg. 65.5)
  return Math.round(finalScore * 10) / 10;
}

// ---------------------------------------------
// Helper: build AI payload from scan row
// ---------------------------------------------
function buildAiPayloadFromScan(scan) {
  const metrics = scan.metrics || {};
  const scores = metrics.scores || {};
  const psiMobile = metrics.psi_mobile || null;
  const basic = metrics.basic_checks || {};
  const https = metrics.https ?? null;
  const speedStability = metrics.speed_stability || null;

  return {
    report_id: scan.report_id,
    url: scan.url,
    http_status: metrics.http_status ?? null,
    https,
    scores: {
      overall: scores.overall ?? null,
      performance: scores.performance ?? null,
      seo: scores.seo ?? null,
      structure_semantics: scores.structure_semantics ?? null,
      mobile_experience: scores.mobile_experience ?? null,
      security_trust: scores.security_trust ?? null,
      accessibility: scores.accessibility ?? null,
      domain_hosting: scores.domain_hosting ?? null,
      content_signals: scores.content_signals ?? null,
    },
    // keep CWV in payload in case we reuse later
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
              "You are Λ i Q, the narrative intelligence engine behind iQWEB.",
              "Your role is to translate raw scan data into clear, confident, founder-ready insights.",
              "Tone: concise, direct, senior-agency level. No fluff. No filler. No academic padding.",
              "Write as if advising a smart founder who values clarity, speed, and practical direction.",
              "Preferred voice: calm, expert, decisive. Short sentences. Strong verbs.",
              "Avoid weak language such as ‘appears to’, ‘suggests’, ‘may benefit’.",
              "Never repeat the same idea using different words.",
              "Never mention numeric scores, percentages, or Core Web Vitals.",
              "Focus only on behaviour: speed, stability, clarity, search reliability, mobile comfort, trust signals, accessibility, domain integrity, and content strength.",

              // ------------------------------------------------------
              // ⭐ TONE RULES (Step 3) — Adjust based on site quality
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
              "- Use strong verbs: ‘missing’, ‘hindering’, ‘reducing’, ‘limiting’.",
              "- Recommend fixes that unlock meaningful progress without overwhelming the user.",
              "General tone rules:",
              "- Never exaggerate (‘major issue’, ‘critical failure’).",
              "- Never minimise (‘just small things’).",
              "- Speak like a senior web strategist delivering a clean, honest assessment.",
              "- Every sentence must provide real value.",

              // ------------------------------------------------------
              // ⭐ OUTPUT FORMAT — strict JSON
              // ------------------------------------------------------
              "OUTPUT FORMAT:",
              "Return a JSON object with EXACT keys:",
              "overall_summary (string),",
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
              // ⭐ FIX SEQUENCE RULES (Step 4 + PHASE UI)
              // ------------------------------------------------------
              "FIX SEQUENCE RULES:",
              "- fix_sequence MUST be an array of short strings.",
              "- Each item MUST begin with EXACTLY one of these labels:",
              "  'Phase 1 — Foundation: '",
              "  'Phase 2 — Experience & Clarity: '",
              "  'Phase 3 — Trust & Professionalism: '",
              "  'Phase 4 — Optional Enhancements: '",
              "- After the label and colon, describe a single clear action, e.g.",
              "  'Phase 1 — Foundation: Add a viewport meta tag to enable responsive scaling.'",
              "- Use Phase 1 for structural and semantic fundamentals (viewport, H1, meta description, core HTML semantics).",
              "- Use Phase 2 for usability, layout, readability, and content clarity.",
              "- Use Phase 3 for trust, contact visibility, policies, professionalism, and reliability signals.",
              "- Use Phase 4 only for lower-priority polish and long-term enhancements.",
              "- Do NOT invent new phase names or labels.",
              "- Keep 1–4 fixes per phase depending on site needs.",
              "- Never repeat the same fix in different words.",
              "- Keep each fix short, direct, and high-leverage.",
              "- The overall sequence should feel like an expert action plan, not a checklist dump.",

              // ------------------------------------------------------
              // ⭐ STYLE RULES — no fluff, real insight
              // ------------------------------------------------------
              "STYLE RULES:",
              "- Insights must be specific but free of unnecessary jargon.",
              "- Use active voice wherever possible.",
              "- Every sentence must deliver value — avoid padding.",
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

    // Honest normalisation for three_key_metrics:
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
    overall_summary: overallText,
    performance_comment: null,
    seo_comment: null,
    structure_comment: null,
    mobile_comment: null,
    security_comment: null,
    accessibility_comment: null,
    domain_comment: null,
    content_comment: null,
    top_issues: [],
    fix_sequence: [],
    closing_notes:
      "You can safely regenerate this report later. If the problem continues, please contact support so we can investigate the scan or AI connection.",
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

  // Original scores from metrics
  const scores = scan.metrics?.scores || {};
  const basicChecks = scan.metrics?.basic_checks || {};
  const coreWebVitals =
    scan.metrics?.core_web_vitals ||
    scan.metrics?.psi_mobile?.coreWebVitals ||
    null;
  const speedStability = scan.metrics?.speed_stability || null;

  // Recompute overall using soft-rebalanced engine (Option A)
  const recomputedOverall = computeOverallScore(scores, basicChecks);
  if (typeof recomputedOverall === "number") {
    scores.overall = recomputedOverall;
  }

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
      // non-fatal
    }
  } catch (err) {
    console.error("Exception during report_data upsert:", err);
    // still non-fatal
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
