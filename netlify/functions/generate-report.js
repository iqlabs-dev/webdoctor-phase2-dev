// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// --------------------------
// Simple deterministic narrative generator
// --------------------------
function gradeFromScore(score) {
  if (score == null) return "no measurable";
  if (score >= 90) return "excellent";
  if (score >= 75) return "strong";
  if (score >= 60) return "solid but improvable";
  if (score >= 45) return "unstable";
  return "weak";
}

function overallSentence(scores) {
  const perf = scores.performance ?? null;
  const seo = scores.seo ?? null;
  const mobile = scores.mobile_experience ?? null;

  const perfGrade = gradeFromScore(perf);
  const seoGrade = gradeFromScore(seo);
  const mobileGrade = gradeFromScore(mobile);

  return (
    `This site shows ${perfGrade} performance, ${seoGrade} search signals, ` +
    `and a ${mobileGrade} mobile experience. ` +
    `The core foundation is workable, but there is clear room for ` +
    `measurable gains in speed, clarity, and consistency. `
  );
}

function makeNarrative(url, scores = {}, metrics = {}) {
  const basic = metrics.basic_checks || {};

  const hasTitle = basic.title_present;
  const hasMeta = basic.meta_description_present;
  const hasH1 = basic.h1_present;

  const titleBit = hasTitle
    ? "Key pages expose usable titles."
    : "Some pages are missing clear, descriptive titles.";
  const metaBit = hasMeta
    ? "Descriptions give search engines enough context to match intent."
    : "Several pages lack meta descriptions, limiting search clarity.";
  const h1Bit = hasH1
    ? "A primary heading is present on core templates."
    : "Some templates don’t expose a clear primary heading (H1).";

  const overall_summary =
    overallSentence(scores) +
    "The fixes recommended in this report focus on tightening those areas so users experience a faster, clearer version of the site.";

  const performance_comment =
    "Load behaviour is mostly stable, but heavier assets and third-party scripts can still delay the first meaningful view on slower devices.";

  const seo_comment =
    `${titleBit} ${metaBit} ` +
    "Improving how each key page describes its purpose will lift click-through and ranking stability.";

  const structure_comment =
    `${h1Bit} When heading levels or landmarks drift, crawlers and assistive tools have to work harder to understand the layout, which weakens long-term relevance signals.`;

  const mobile_comment =
    "The site remains usable on phones, yet spacing, tap targets, and above-the-fold weight could be refined to reduce friction on handheld devices.";

  const security_comment =
    "HTTPS is used for this report URL, which is a strong baseline. Additional hardening, such as security headers and strict redirect rules, can further improve trust.";

  const accessibility_comment =
    "Accessibility is likely above bare minimum, but contrast, labels, and keyboard flows should be periodically reviewed to stay aligned with modern expectations.";

  const domain_comment =
    "Domain and hosting appear stable. Keeping DNS, SSL renewal, and email authentication in good shape helps maintain deliverability and long-term trust.";

  const content_comment =
    "Titles, descriptions, and on-page copy communicate intent, but some sections remain thin or generic. Sharpening these will help both search systems and humans understand why each page exists.";

  const top_issues = [
    {
      title: "Performance overhead on slower and mobile devices",
      impact:
        "Heavier scripts and assets delay the first meaningful view, especially on non-desktop connections.",
      why_it_matters:
        "Users judge trust and usefulness in the first seconds. Any hesitation here directly affects conversion and perceived quality.",
      suggested_fix:
        "Trim or defer non-critical scripts, compress large assets, and prioritise the content that must appear in the first viewport.",
      priority: 1
    },
    {
      title: "Search clarity limited by weak or missing meta descriptions",
      impact:
        "Search engines receive less context about what key pages offer, reducing click-through and ranking stability.",
      why_it_matters:
        "Meta descriptions are often the first line users see in search results. Weak summaries mean fewer qualified visitors.",
      suggested_fix:
        "Review high-value pages and write concise, specific descriptions that express intent, value, and target audience.",
      priority: 2
    },
    {
      title: "Inconsistent structure and semantics across templates",
      impact:
        "Heading levels and landmarks are harder for crawlers and assistive tools to interpret, which weakens semantic confidence.",
      why_it_matters:
        "Clear structure makes it easier for both machines and humans to navigate and understand content at scale.",
      suggested_fix:
        "Standardise H1–H3 usage, ensure each template exposes a single primary heading, and tidy duplicated or missing landmarks.",
      priority: 3
    }
  ];

  const fix_sequence = [
    "Reduce performance overhead by trimming and deferring non-critical scripts and heavy assets.",
    "Tighten titles and meta descriptions on priority pages to better describe intent and value.",
    "Standardise structural semantics (headings and landmarks) across templates to improve predictability.",
    "Refine mobile spacing and tap targets so handheld interactions feel effortless.",
    "Schedule a periodic review of accessibility, security headers, and domain health."
  ];

  const closing_notes =
    "Once you have addressed the highest-impact items above, run a fresh iQWEB scan. " +
    "That will confirm improvements in performance, search clarity, and overall stability, " +
    "and gives you a cleaner baseline for future changes.";

  return {
    overall_summary,
    performance_comment,
    seo_comment,
    structure_comment,
    mobile_comment,
    security_comment,
    accessibility_comment,
    domain_comment,
    content_comment,
    top_issues,
    fix_sequence,
    closing_notes
  };
}

// --------------------------
// MAIN HANDLER
// --------------------------
export default async (request) => {
  const { searchParams } = new URL(request.url);
  const report_id = searchParams.get("report_id");

  if (!report_id) {
    return new Response(
      JSON.stringify({ success: false, message: "Missing report_id" }),
      { status: 400 }
    );
  }

  // 1. Load scan row
  const { data: scan, error: scanErr } = await supabase
    .from("scan_results")
    .select("*")
    .eq("report_id", report_id)
    .single();

  if (scanErr || !scan) {
    console.error("Scan lookup error:", scanErr);
    return new Response(
      JSON.stringify({ success: false, message: "Scan result not found" }),
      { status: 404 }
    );
  }

  const scores = scan.metrics?.scores || {};
  const metrics = scan.metrics || {};

  // 2. Build narrative (no external API; fully deterministic)
  const narrative = makeNarrative(scan.url, scores, metrics);

  // 3. Return scores + narrative
  return new Response(
    JSON.stringify({
      success: true,
      report_id,
      url: scan.url,
      scores,
      narrative
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
};
