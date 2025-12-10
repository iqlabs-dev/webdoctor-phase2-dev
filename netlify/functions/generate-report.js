// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

// ---------- helpers ----------
function nz(v, fallback = 0) {
  return typeof v === 'number' && !Number.isNaN(v) ? v : fallback;
}

function clampScore(v) {
  if (typeof v !== 'number' || Number.isNaN(v)) return null;
  if (v < 0) return 0;
  if (v > 100) return 100;
  return Math.round(v);
}

function overallLabel(score) {
  if (score == null) return 'no-score';
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'strong';
  if (score >= 60) return 'solid';
  if (score >= 45) return 'mixed';
  return 'weak';
}

/**
 * Build a deterministic narrative based on scores only.
 * No AI – this is pure logic so it cannot explode.
 */
function buildDeterministicNarrative(url, scores) {
  const perf = nz(scores.performance, scores.overall);
  const seo = nz(scores.seo, scores.overall);
  const overall = nz(scores.overall, Math.round((perf + seo) / 2));

  const label = overallLabel(overall);

  let opener;
  switch (label) {
    case 'excellent':
      opener =
        'This site is performing at a very high standard, with fast load behaviour and generally strong search visibility.';
      break;
    case 'strong':
      opener =
        'This site shows strong fundamentals, with reliable performance and healthy search signals.';
      break;
    case 'solid':
      opener =
        'This site shows solid fundamentals with room for meaningful improvements in performance and search visibility.';
      break;
    case 'mixed':
      opener =
        'This site is functional but uneven, with noticeable gaps in performance, structure, or search visibility.';
      break;
    case 'weak':
      opener =
        'This site is currently under-optimised, with significant issues in performance, mobile usability, or search clarity.';
      break;
    default:
      opener =
        'This report provides a snapshot of core website health based on the latest scan.';
  }

  const perfLine =
    perf >= 85
      ? 'Pages load quickly for most users, and key templates remain responsive under normal conditions.'
      : perf >= 70
      ? 'Pages are usable, but some assets or scripts may be slowing the first meaningful view, especially on mobile and slower connections.'
      : perf >= 50
      ? 'Load times are likely to feel slow on mobile and mid-range devices, particularly on heavier pages.'
      : 'Load performance is likely to be a major friction point, especially for new visitors and mobile users.';

  const seoLine =
    seo >= 85
      ? 'Search engines can reliably discover and understand key pages, with titles and descriptions generally aligned to intent.'
      : seo >= 70
      ? 'Search signals are present but could be strengthened by clearer titles, richer descriptions, and more consistent on-page structure.'
      : seo >= 50
      ? 'Search signals appear thin or inconsistent, which may limit how well important pages are discovered and ranked.'
      : 'Search visibility is likely constrained by weak or inconsistent meta data and on-page signals.';

  const overallSummary = `${opener} ${perfLine} ${seoLine} The recommended fixes in this report focus on improving clarity, speed, and reliability for both users and search systems.`;

  // For now, keep per-section comments simple but distinct.
  const performanceComment =
    perf >= 85
      ? 'Performance is a strength. Focus on preserving current load times as new content and scripts are added.'
      : perf >= 70
      ? 'Performance is acceptable, but there are easy wins in script loading, image weight, and caching.'
      : 'Performance should be treated as a priority area, especially for mobile traffic and first-time visitors.';

  const seoComment =
    seo >= 85
      ? 'SEO foundations are strong, with clear, descriptive meta data on key pages.'
      : seo >= 70
      ? 'SEO foundations are in place, but titles and descriptions can be sharpened for intent and click-through.'
      : 'SEO signals need attention. Improve titles, descriptions, and on-page structure for your most important pages first.';

  const structureComment =
    'Underlying HTML structure is inferred from best-practices checks. Ensuring clean heading hierarchies and landmarks will help both crawlers and assistive technologies.';

  const mobileComment =
    'Mobile experience is directly influenced by your performance score and layout behaviour. Prioritise above-the-fold clarity and touch-friendly controls.';

  const securityComment =
    'Security & trust are based on HTTPS behaviour and basic hosting checks. Adding modern security headers will further harden the surface without affecting day-to-day content work.';

  const accessibilityComment =
    'Accessibility is estimated from contrast and structural patterns. Small changes to contrast, labels, and keyboard behaviour can deliver outsized benefits.';

  const domainComment =
    'Domain & hosting health appear stable, with consistent responses from the origin. Keep SSL certificates, DNS, and email authentication records in good order.';

  const contentComment =
    'Content signals are driven by how clearly titles, descriptions, and key page content describe what each page is really for. Sharpen this language on your most important URLs first.';

  const topIssues = [];
  const fixSequence = [];

  if (perf < 80) {
    topIssues.push({
      title: 'Performance can be improved for key templates',
      impact:
        'Slower pages increase bounce risk on mobile and can limit the perceived quality of your brand.',
      suggested_fix:
        'Optimise images, defer non-critical scripts, and review blocking resources on high-traffic pages.'
    });
    fixSequence.push(
      'Address performance issues on home, service, and landing pages first.'
    );
  }

  if (seo < 80) {
    topIssues.push({
      title: 'SEO signals are leaving relevance on the table',
      impact:
        'Weak or generic meta data makes it harder for search engines to understand which queries your pages should win.',
      suggested_fix:
        'Rewrite titles and descriptions for your priority pages with clear intent and value statements.'
    });
    fixSequence.push(
      'Refresh titles and meta descriptions on your highest-value pages.'
    );
  }

  if (!topIssues.length) {
    topIssues.push({
      title: 'No critical issues detected from this scan',
      impact:
        'The current snapshot suggests a healthy baseline. Future scans may surface more targeted opportunities.',
      suggested_fix:
        'Continue monitoring performance and SEO, and apply incremental improvements as your site evolves.'
    });
  }

  if (!fixSequence.length) {
    fixSequence.push(
      'Maintain current performance and SEO hygiene while iterating on content and design.'
    );
  }

  const closingNotes =
    'This narrative is generated from the current scan results and score profile. Use it as a directional guide: fix the most impactful issues first, re-scan to confirm improvements, and repeat as your site evolves.';

  return {
    overall_summary: overallSummary,
    performance_comment: performanceComment,
    seo_comment: seoComment,
    structure_comment: structureComment,
    mobile_comment: mobileComment,
    security_comment: securityComment,
    accessibility_comment: accessibilityComment,
    domain_comment: domainComment,
    content_comment: contentComment,
    top_issues: topIssues,
    fix_sequence: fixSequence,
    closing_notes: closingNotes
  };
}

// ---------- Netlify handler ----------
export default async (request, context) => {
  try {
    const url = new URL(request.url);
    const reportId = url.searchParams.get('report_id');

    if (!reportId) {
      return new Response(
        JSON.stringify({
          success: false,
          scores: {},
          narrative: null,
          message: 'Missing report_id'
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const { data: scan, error } = await supabase
      .from('scan_results')
      .select('id, url, metrics, score_overall, created_at')
      .eq('report_id', reportId)
      .single();

    if (error || !scan) {
      console.error('generate-report: scan lookup error', error);
      return new Response(
        JSON.stringify({
          success: false,
          scores: {},
          narrative: null,
          message: 'Scan not found for this report_id'
        }),
        { status: 404, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const metrics = scan.metrics || {};
    const metricScores = metrics.scores || {};

    const performance = clampScore(
      metricScores.performance ?? scan.score_overall ?? null
    );
    const seo = clampScore(metricScores.seo ?? scan.score_overall ?? null);
    const overall = clampScore(
      metricScores.overall ??
        scan.score_overall ??
        Math.round((nz(performance) + nz(seo)) / 2)
    );

    const scores = { performance, seo, overall };

    const narrative = buildDeterministicNarrative(scan.url, scores);

    return new Response(
      JSON.stringify({
        success: true,
        scores,
        narrative
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error('generate-report: unhandled error', err);
    return new Response(
      JSON.stringify({
        success: false,
        scores: {},
        narrative: null,
        message: 'Internal error while generating report'
      }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
};
