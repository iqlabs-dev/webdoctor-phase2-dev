// /assets/js/report-data.js

function setText(field, text) {
  const el = document.querySelector(`[data-field="${field}"]`);
  if (el) el.textContent = text;
}

function formatDate(dateString) {
  if (!dateString) return "—";

  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "—";

  // Example: 08 DEC 2025
  return d
    .toLocaleDateString("en-NZ", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    })
    .toUpperCase()
    .replace(/ /g, " ");
}

function formatScore(value) {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return "— / 100";
  }
  return `${value} / 100`;
}

function bucketScore(score) {
  if (typeof score !== "number" || Number.isNaN(score)) return "Unknown";
  if (score >= 90) return "Excellent";
  if (score >= 80) return "Good";
  if (score >= 70) return "Fair";
  return "Needs attention";
}

function wireNineSignalPills(scores) {
  const pills = document.querySelectorAll(".wd-diag-section .wd-score-pill");
  if (!pills || pills.length === 0) {
    return;
  }

  const perf = typeof scores.performance === "number" ? scores.performance : scores.overall;
  const seo = typeof scores.seo === "number" ? scores.seo : scores.overall;
  const overall = typeof scores.overall === "number" ? scores.overall : 0;

  // 0: Performance
  if (pills[0]) pills[0].textContent = formatScore(perf);
  // 1: SEO Foundations
  if (pills[1]) pills[1].textContent = formatScore(seo);
  // 2–8: other signals (Structure, Mobile, Security, Accessibility, Domain, Content, Summary)
  for (let i = 2; i < pills.length; i++) {
    pills[i].textContent = formatScore(overall);
  }
}

function wireKeyMetrics(scores, metrics = {}) {
  const perf = scores.performance;
  const overall = scores.overall;

  // PAGE LOAD
  if (typeof perf === "number") {
    const label = bucketScore(perf);
    setText("metric-page-load-main", `${label} page speed`);
    setText(
      "metric-page-load-sub",
      `Current score: ${formatScore(perf)}`
    );
  } else {
    setText("metric-page-load-main", "Not yet measured");
    setText(
      "metric-page-load-sub",
      "Page speed scoring will appear here when available."
    );
  }

  // MOBILE USABILITY (derived from overall for now)
  if (typeof overall === "number") {
    const label = bucketScore(overall);
    setText("metric-mobile-main", `${label} mobile experience`);
    setText(
      "metric-mobile-sub",
      "Based on layout, spacing, and performance signals."
    );
  } else {
    setText("metric-mobile-main", "Not yet measured");
    setText(
      "metric-mobile-sub",
      "Mobile usability metrics will appear here when available."
    );
  }

  // CORE WEB VITALS (placeholder until we wire Lighthouse / PSI)
  setText("metric-cwv-main", "Not yet measured");
  setText(
    "metric-cwv-sub",
    "Core Web Vitals integration is planned for a future iQWEB release."
  );
}

async function loadReportData() {
  const params = new URLSearchParams(window.location.search);
  const reportId = params.get("report_id");

  if (!reportId) {
    console.warn("No report_id in query string");
    return;
  }

  try {
    const resp = await fetch(
      "/.netlify/functions/get-report-data?report_id=" +
        encodeURIComponent(reportId)
    );

    if (!resp.ok) {
      console.error("get-report-data HTTP error", resp.status);
      return;
    }

    const data = await resp.json();
    if (!data.success) {
      console.error("get-report-data returned failure", data);
      return;
    }

    console.log("iQWEB report payload:", data);

    // Header fields
    setText("website-url", data.url || "—");
    setText("report-id", data.report_id || "—");
    setText("report-date", formatDate(data.created_at));

    const scores = data.scores || {};

    // Top three score cards
    setText("score-performance", formatScore(scores.performance));
    setText("score-seo", formatScore(scores.seo));
    setText("score-overall", formatScore(scores.overall));

    // Nine signal pills
    wireNineSignalPills(scores);

    // Key metrics section
    wireKeyMetrics(scores, data.metrics || {});
  } catch (err) {
    console.error("Error loading report data:", err);
  }
}

// Make sure we always run, even with type="module"
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", loadReportData);
} else {
  loadReportData();
}
