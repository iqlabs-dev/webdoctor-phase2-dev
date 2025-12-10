// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
        model: "gpt-4.1-mini",        // adjust if you want a different model
        temperature: 0.45,
        max_tokens: 320,
        messages: [
          {
            role: "system",
            content: [
              "You are Λ i Q, an AI website diagnostics specialist.",
              "You receive numeric scores from 0–100 across several signals:",
              "overall, performance, seo, structure_semantics, mobile_experience,",
              "security_trust, accessibility, domain_hosting, content_signals.",
              "You may also receive notes about HTTPS and Core Web Vitals.",
              "Write a single narrative paragraph (3–6 sentences) describing:",
              "overall health in human language (no numbers), key strengths,",
              "key weaknesses or risks, and what the recommended fixes will focus on.",
              "Do NOT mention specific numeric scores or percent values.",
              "Do NOT invent technologies that are not implied.",
              "Return plain text only, no headings or bullet points."
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
    const content = json?.choices?.[0]?.message?.content?.trim();
    if (!content) return null;

    return content;
  } catch (err) {
    console.error("OpenAI narrative exception:", err);
    return null;
  }
}

// ---------------------------------------------
// Scripted fallback if AI fails completely
// ---------------------------------------------
function buildNarrativeFallback(scores) {
  if (!scores || typeof scores.overall !== "number") {
    return "This site shows a generally stable foundation. Once live diagnostics are fully available, this summary will expand to highlight specific strengths, risks, and the most important fixes.";
  }

  const overall = scores.overall;

  if (overall >= 85) {
    return "This site is operating at an exceptional standard, with very fast load behaviour and strong supporting signals across search, structure, mobile experience, and security. Most remaining work is about fine-tuning details rather than fixing core issues, allowing you to focus on stability, resilience, and incremental gains.";
  }

  if (overall >= 65) {
    return "This site shows solid fundamentals with reliable performance and healthy search signals, but there is still clear room to improve speed, clarity, and mobile comfort. The most important fixes will target high-impact areas first so that users and search systems experience the site more consistently.";
  }

  return "This site is currently under-optimised compared to modern expectations. Several key signals are holding back performance, search clarity, and overall reliability. Addressing the issues highlighted in this report will deliver noticeable gains in how quickly the site loads, how clearly it communicates intent, and how confidently users and search engines can trust it.";
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
  const psiMobile = scan.metrics?.psi_mobile || null;
  const https = scan.metrics?.https ?? null;

  // --- 2. Try Λ i Q AI narrative ---
  let overall_summary = null;
  let narrativeSource = "ai";

  try {
    overall_summary = await generateNarrativeAI({
      report_id: scan.report_id,
      url: scan.url,
      scores,
      https,
      core_web_vitals: psiMobile?.coreWebVitals || null,
    });
  } catch (err) {
    console.error("Error during generateNarrativeAI:", err);
  }

  // If AI failed, use fallback
  if (!overall_summary) {
    narrativeSource = "fallback";
    overall_summary = buildNarrativeFallback(scores);
  }

  const narrative = {
    overall_summary,
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
    closing_notes: null,
  };

  // --- 3. Cache narrative in report_data (best-effort) ---
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

  // --- 4. Return to UI ---
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
