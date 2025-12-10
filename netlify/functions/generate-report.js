// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ---------------------------------------------
// Λ i Q — System Prompt (Unified JSON Narrative)
// ---------------------------------------------
const SYSTEM_PROMPT = `
You are Λ i Q — an AI web-performance and UX analyst.

Your job:
Read the provided metrics and scoring signals.
Produce a complete, honest, evidence-based narrative analysis.

Rules:
- Never guess about frameworks, CMS, hosting, or technologies not shown.
- Never praise or criticise without referencing the data.
- The narrative MUST vary site-to-site. No generic templates.
- Tone: professional, concise, analytical, founder-friendly.
- Insights must connect directly to the scores and metrics.
- If something is missing, incomplete, weak, or unknown — say so.

Your output MUST be strict JSON matching this schema:

{
  "overall_summary": "",

  "performance_comment": "",
  "seo_comment": "",
  "structure_comment": "",
  "mobile_comment": "",
  "security_comment": "",
  "accessibility_comment": "",
  "domain_comment": "",
  "content_comment": "",

  "top_issues": [
    {
      "title": "",
      "impact": "",
      "suggested_fix": ""
    }
  ],

  "fix_sequence": ["", ""],

  "closing_notes": ""
}

Scoring Guidance:
- Scores below 40 = serious issues → be direct, highlight failures.
- Scores 40–69 = mixed / unstable → highlight fragility and easy wins.
- Scores 70–85 = solid but imperfect → optimisation narrative.
- Scores 85+ = high quality → precision tuning, subtle issues.

Narrative Generation Rules:
- Use the PSI metrics (LCP, CLS, TBT, FCP) to inform performance commentary.
- Use HTML signals (title, description, H1, viewport) to shape SEO/content commentary.
- Use domain signals (SPF/DKIM/DMARC/SSL days left) for trust commentary.
- NEVER repeat the same sentence structure across categories.
- ALWAYS reflect strengths and weaknesses realistically.
- Top issues MUST be actionable and based on the weakest metrics.
- Fix sequence MUST prioritise performance → clarity → structure → mobile → trust.
`;

// ---------------------------------------------
// Λ i Q — AI narrative generator (OpenAI)
// ---------------------------------------------
async function generateNarrativeAI(payload) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY not set; using fallback narrative.");
    return null;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4.1-mini",
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: SYSTEM_PROMPT,
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
    const content = json?.choices?.[0]?.message?.content;
    if (!content) return null;

    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (err) {
      console.error("Error parsing AI JSON narrative:", err, "content:", content);
      return null;
    }

    return parsed;
  } catch (err) {
    console.error("OpenAI narrative exception:", err);
    return null;
  }
}

// ---------------------------------------------
// Scripted fallback if AI fails completely
// ---------------------------------------------
function buildNarrativeFallback(scores) {
  const overall = typeof scores?.overall === "number" ? scores.overall : null;

  let overall_summary;

  if (overall == null) {
    overall_summary =
      "This site shows a generally stable foundation. Once live diagnostics are fully available, this summary will expand to highlight specific strengths, risks, and the most important fixes.";
  } else if (overall >= 85) {
    overall_summary =
      "This site is operating at an exceptional standard, with very fast load behaviour and strong supporting signals across search, structure, mobile experience, and security. Most remaining work is about fine-tuning details rather than fixing core issues, allowing you to focus on stability, resilience, and incremental gains.";
  } else if (overall >= 65) {
    overall_summary =
      "This site shows solid fundamentals with reliable performance and healthy search signals, but there is still clear room to improve speed, clarity, and mobile comfort. The most important fixes will target high-impact areas first so that users and search systems experience the site more consistently.";
  } else {
    overall_summary =
      "This site is currently under-optimised compared to modern expectations. Several key signals are holding back performance, search clarity, and overall reliability. Addressing the issues highlighted in this report will deliver noticeable gains in how quickly the site loads, how clearly it communicates intent, and how confidently users and search engines can trust it.";
  }

  return {
    overall_summary,
    performance_comment: "",
    seo_comment: "",
    structure_comment: "",
    mobile_comment: "",
    security_comment: "",
    accessibility_comment: "",
    domain_comment: "",
    content_comment: "",
    top_issues: [],
    fix_sequence: [],
    closing_notes: "",
  };
}

// ---------------------------------------------
// Build payload for Λ i Q from scan.metrics
// ---------------------------------------------
function buildPayloadForAI(scan) {
  const metrics = scan.metrics || {};
  const scores = metrics.scores || {};
  const basic = metrics.basic_checks || {};
  const psiMobile = metrics.psi_mobile || {};
  const cwv = psiMobile.coreWebVitals || psiMobile.core_web_vitals || {};
  const https = metrics.https ?? null;

  return {
    url: scan.url,
    scores: {
      performance: scores.performance ?? null,
      seo: scores.seo ?? null,
      structure_semantics: scores.structure_semantics ?? null,
      mobile_experience: scores.mobile_experience ?? null,
      security_trust: scores.security_trust ?? null,
      accessibility: scores.accessibility ?? null,
      domain_hosting: scores.domain_hosting ?? null,
      content_signals: scores.content_signals ?? null,
      overall: scores.overall ?? null,
    },
    metrics: {
      psi: {
        performance_mobile:
          typeof scores.performance === "number"
            ? scores.performance
            : psiMobile?.scores?.performance ?? null,
        performance_desktop: null, // currently not wired
        fcp_ms: cwv.FCP ?? null,
        lcp_ms: cwv.LCP ?? null,
        cls: cwv.CLS ?? null,
        tbt_ms: null,
        total_kb: null,
        requests: null,
      },
      html: {
        title_present: basic.title_present ?? null,
        meta_description_present: basic.meta_description_present ?? null,
        h1_present: basic.h1_present ?? null,
        viewport_present: basic.viewport_present ?? null,
        html_length: basic.html_length ?? null,
      },
      domain: {
        https: https,
        ssl_valid: metrics.ssl_valid ?? null,
        ssl_days_left: metrics.ssl_days_left ?? null,
        spf_present: metrics.spf_present ?? null,
        dkim_present: metrics.dkim_present ?? null,
        dmarc_present: metrics.dmarc_present ?? null,
      },
    },
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
    .select("id, url, metrics, report_id")
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

  const scores = scan.metrics?.scores || {};

  // --- Build payload + call Λ i Q ---
  const payload = buildPayloadForAI(scan);

  let narrative = null;
  let narrativeSource = "ai";

  try {
    narrative = await generateNarrativeAI(payload);
  } catch (err) {
    console.error("Error during generateNarrativeAI:", err);
  }

  // If AI failed or returned something invalid, use structured fallback
  if (
    !narrative ||
    typeof narrative !== "object" ||
    typeof narrative.overall_summary !== "string"
  ) {
    narrativeSource = "fallback";
    narrative = buildNarrativeFallback(scores);
  }

  // --- Cache narrative in report_data (best-effort) ---
  try {
    const { error: saveErr } = await supabase.from("report_data").upsert(
      {
        report_id: reportId,
        url: scan.url,
        scores,
        narrative,
        created_at: new Date().toISOString(),
      },
      { onConflict: "report_id" }
    );

    if (saveErr) {
      console.error("Error saving narrative to report_data:", saveErr);
    }
  } catch (err) {
    console.error("Exception during report_data upsert:", err);
  }

  // --- Return to UI ---
  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative,
      narrative_source: narrativeSource,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
