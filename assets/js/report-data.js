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

    // Debug aid if you ever want to see raw metrics
    console.log("iQWEB report payload:", data);

    // Header fields
    setText("website-url", data.url || "—");
    setText("report-id", data.report_id || "—");
    setText("report-date", formatDate(data.created_at));

    // Scores for the three main cards
    const scores = data.scores || {};
    setText("score-performance", formatScore(scores.performance));
    setText("score-seo", formatScore(scores.seo));
    setText("score-overall", formatScore(scores.overall));

    // Wire the 9 signal score pills
    wireNineSignalPills(scores);

    // Later: use data.metrics.checks to drive Key Metrics, Top Issues, etc.
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
