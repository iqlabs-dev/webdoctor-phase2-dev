// /netlify/functions/generate-report.js
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// -----------------------------
// Narrative builder v2.0 (deterministic)
// -----------------------------
function bucket(score) {
  if (score == null || Number.isNaN(score)) return "unknown";
  if (score >= 90) return "elite";
  if (score >= 80) return "strong";
  if (score >= 70) return "solid";
  if (score >= 60) return "fragile";
  return "poor";
}

function labelForKey(key) {
  switch (key) {
    case "performance":
      return "performance and load behaviour";
    case "seo":
      return "search clarity and meta structure";
    case "structure_semantics":
      return "structure & semantics";
    case "mobile_experience":
      return "mobile comfort and tap targets";
    case "security_trust":
      return "security & trust signals";
    case "accessibility":
      return "accessibility and assistive-tech support";
    case "domain_hosting":
      return "domain & hosting health";
    case "content_signals":
      return "content signals and on-page messaging";
    default:
      return key;
  }
}

function buildNarrativeFromScores({ url, scores = {}, metrics = {} }) {
  // If we basically have no scores, fall back to a generic message
  const scoreVals = Object.values(scores || {}).filter(
    (v) => typeof v === "number" && !Number.isNaN(v)
  );
  if (!scoreVals.length) {
    return {
      overall_summary:
        "This report could not load detailed scoring data, so the narrative is limited. Please try re-running the scan, and if the issue persists, check that the site is reachable and not blocking automated checks.",
      performance_comment:
        "Performance signals could not be reliably measured for this scan. Re-run the scan or verify that the site responds consistently.",
      seo_comment:
        "Search signals could not be fully evaluated. Check that titles, descriptions, and indexing rules are correctly configured.",
      structure_comment:
        "Structural and semantic signals were not clearly available. Consider reviewing heading order, landmarks, and HTML validity.",
      mobile_comment:
        "Mobile experience could not be fully measured. Verify that the layout is responsive and usable on a range of screen sizes.",
      security_comment:
        "Security and trust signals were not fully available. Confirm that HTTPS is enforced and basic security headers are in place.",
      accessibility_comment:
        "Accessibility checks were incomplete. A manual review with assistive technologies is recommended.",
      domain_comment:
        "Domain and hosting configuration could not be fully read. Verify DNS, SSL, and hosting stability.",
      content_comment:
        "Content signals were not clearly measurable. Review titles, descriptions, and on-page messaging for clarity and relevance.",
      top_issues: [],
      fix_sequence: [],
      closing_notes:
        "Once the site is responding consistently, re-run this scan to generate a full narrative with detailed scores."
    };
  }

  const {
    performance,
    seo,
    structure_semantics,
    mobile_experience,
    security_trust,
    accessibility,
    domain_hosting,
    content_signals,
    overall
  } = scores;

  const buckets = {
    performance: bucket(performance),
    seo: bucket(seo),
    structure_semantics: bucket(structure_semantics),
    mobile_experience: bucket(mobile_experience),
    security_trust: bucket(security_trust),
    accessibility: bucket(accessibility),
    domain_hosting: bucket(domain_hosting),
    content_signals: bucket(content_signals),
    overall: bucket(overall)
  };

  // --- Overall tone ---
  let intro;
  switch (buckets.overall) {
    case "elite":
      intro =
        "This site is operating at an exceptional standard, with very fast load behaviour and strong supporting signals across search, structure, and mobile experience.";
      break;
    case "strong":
      intro =
        "This site is performing at a high standard, with reliable performance and healthy search signals. Most users experience a fast, stable site under normal conditions.";
      break;
    case "solid":
      intro =
        "This site shows solid fundamentals with clear room for improvement across key areas such as speed, mobile experience, and search clarity.";
      break;
    case "fragile":
      intro =
        "This site is working, but several core signals are fragile. Users and search engines are likely to notice slowdowns, structural friction, or unclear messaging.";
      break;
    case "poor":
    default:
      intro =
        "This site is currently under-performing across multiple technical and experience signals. Load behaviour, structure, and clarity are likely limiting both user confidence and search performance.";
      break;
  }

  // --- Strength & weakness lists ---
  const strongAreas = [];
  const weakAreas = [];

  const keys = [
    "performance",
    "seo",
    "structure_semantics",
    "mobile_experience",
    "security_trust",
    "accessibility",
    "domain_hosting",
    "content_signals"
  ];

  for (const key of keys) {
    const b = buckets[key];
    if (b === "elite" || b === "strong") {
      strongAreas.push(labelForKey(key));
    } else if (b === "fragile" || b === "poor") {
      weakAreas.push(labelForKey(key));
    }
  }

  function listToSentence(list) {
    if (!list.length) return "";
    if (list.length === 1) return list[0];
    const head = list.slice(0, -1).join(", ");
    const tail = list[list.length - 1];
    return `${head} and ${tail}`;
  }

  let middle = "";
  if (strongAreas.length) {
    middle += ` Strengths include ${listToSentence(strongAreas)}.`;
  }
  if (weakAreas.length) {
    middle += ` The main opportunities lie in ${listToSentence(
      weakAreas
    )}.`;
  }

  if (!weakAreas.length && strongAreas.length) {
    middle +=
      " Remaining improvements are mostly about fine-tuning details rather than fixing fundamental issues.";
  }

  if (!strongAreas.length && weakAreas.length) {
    middle +=
      " Addressing these weaknesses will have a noticeable impact on how fast, clear, and trustworthy the site feels.";
  }

  const closing =
    "The recommended fixes in this report target the highest-impact issues first so you can improve stability, speed, and search reliability in a measurable way.";

  const overall_summary = `${intro}${middle} ${closing}`.trim();

  // --- Per-signal comments ---
  function perSignalComment(key, scoreVal) {
    const b = buckets[key];
    const label = labelForKey(key);

    if (b === "elite") {
      return `This area is performing at an elite level. ${label[0].toUpperCase() + label.slice(
        1
      )} are unlikely to be a bottleneck right now.`;
    }
    if (b === "strong") {
      return `This area is in good shape, with only minor optimisation headroom. Focus future work here after higher-risk issues are addressed.`;
    }
    if (b === "solid") {
      return `This area is serviceable but not yet tuned for best-in-class performance. Moderately targeted fixes here will improve overall confidence.`;
    }
    if (b === "fragile") {
      return `Signals in this area are fragile. Issues here are likely starting to affect user experience and search systems, and should be prioritised.`;
    }
    if (b === "poor") {
      return `This is one of the weakest areas in the scan. Problems here are likely dragging down both perception and rankings and should be addressed urgently.`;
    }
    return `Signals for ${label} could not be fully evaluated, so this area should be reviewed manually.`;
  }

  return {
    overall_summary,

    performance_comment: perSignalComment("performance", performance),
    seo_comment: perSignalComment("seo", seo),
    structure_comment: perSignalComment(
      "structure_semantics",
      structure_semantics
    ),
    mobile_comment: perSignalComment(
      "mobile_experience",
      mobile_experience
    ),
    security_comment: perSignalComment("security_trust", security_trust),
    accessibility_comment: perSignalComment(
      "accessibility",
      accessibility
    ),
    domain_comment: perSignalComment("domain_hosting", domain_hosting),
    content_comment: perSignalComment(
      "content_signals",
      content_signals
    ),

    top_issues: [],
    fix_sequence: [],
    closing_notes:
      "Once high-priority fixes have been implemented, re-run this scan to confirm improvements and track progress over time."
  };
}

// -----------------------------
// Netlify function handler
// -----------------------------
export default async (request, context) => {
  if (request.method !== "GET") {
    return new Response(
      JSON.stringify({ success: false, message: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const urlObj = new URL(request.url);
  const reportId = urlObj.searchParams.get("report_id");

  if (!reportId) {
    return new Response(
      JSON.stringify({ success: false, message: "Missing report_id" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  // Load the scan row from scan_results
  const { data: scan, error } = await supabase
    .from("scan_results")
    .select("id, url, status, metrics")
    .eq("report_id", reportId)
    .single();

  if (error || !scan) {
    console.error("generate-report: scan lookup error", error);
    return new Response(
      JSON.stringify({
        success: false,
        message: "Scan not found for this report_id",
        scores: {},
        narrative: null
      }),
      {
        status: 404,
        headers: { "Content-Type": "application/json" }
      }
    );
  }

  const metrics = scan.metrics || {};
  const scores = metrics.scores || {};

  // Build deterministic narrative from scores
  const narrative = buildNarrativeFromScores({
    url: scan.url,
    scores,
    metrics
  });

  // Optional: upsert into report_data, but don't fail if this breaks
  try {
    await supabase
      .from("report_data")
      .upsert(
        {
          report_id: reportId,
          url: scan.url,
          scores,
          narrative,
          created_at: new Date().toISOString()
        },
        { onConflict: "report_id" }
      );
  } catch (err) {
    console.error("generate-report: report_data upsert error", err);
    // carry on; UI still gets the narrative
  }

  return new Response(
    JSON.stringify({
      success: true,
      scores,
      narrative
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
};
