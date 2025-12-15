// /assets/js/report-data.js
// iQWEB Report v5.2 — Signals-only safe rendering
// - Never leaves the “Building Report” loader hanging
// - Uses /.netlify/functions/get-report-data
// - If anything is missing, it shows “Not available from this scan.”
//   (no blanks, no fake placeholders)

function $(id) {
  return document.getElementById(id);
}

function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}

function clamp0_100(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function getReportIdFromUrl() {
  const params = new URLSearchParams(window.location.search);
  return (params.get("report_id") || "").trim();
}

function setText(id, txt) {
  const el = $(id);
  if (el) el.textContent = txt;
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

function setBar(prefix, score) {
  const bar = $(`${prefix}-bar`);
  const badge = $(`${prefix}-score`);
  const msg = $(`${prefix}-msg`);

  if (score === null) {
    if (bar) bar.style.width = "0%";
    if (badge) badge.textContent = "—";
    if (msg) msg.textContent = "Not available from this scan.";
    return;
  }

  if (bar) bar.style.width = `${score}%`;
  if (badge) badge.textContent = `${score}/100`;
}

function renderExecutiveNarrative(narrative, url, overall) {
  const box = $("exec-narrative");
  if (!box) return;

  if (typeof narrative === "string" && narrative.trim().length > 0) {
    box.textContent = narrative.trim();
    return;
  }

  // Minimal, honest fallback (not “fake analysis” — just states what exists)
  if (typeof overall === "number") {
    box.textContent = `The website at ${url} has an overall score of ${overall}, based on the scan data available at the time of analysis.`;
  } else {
    box.textContent = "No executive narrative was available for this scan.";
  }
}

function renderHeader(data) {
  const url = data?.url || "—";
  const reportId = data?.report_id || "—";
  const createdAt = data?.created_at ? new Date(data.created_at) : null;

  setText("report-url", url);
  setText("report-id", reportId);

  if (createdAt) {
    setText("report-date", createdAt.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase());
    setText("report-time", createdAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }));
  }
}

function renderSignals(data) {
  // Prefer normalized scores from function, else fallback to metrics.scores
  const scores =
    safeObj(data?.scores) ||
    safeObj(data?.metrics?.scores) ||
    safeObj(data?.metrics?.scores?.scores);

  const perf = clamp0_100(scores.performance);
  const seo = clamp0_100(scores.seo);
  const structure = clamp0_100(scores.structure);
  const mobile = clamp0_100(scores.mobile);
  const security = clamp0_100(scores.security);
  const accessibility = clamp0_100(scores.accessibility);

  setBar("sig-performance", perf);
  setBar("sig-seo", seo);
  setBar("sig-structure", structure);
  setBar("sig-mobile", mobile);
  setBar("sig-security", security);
  setBar("sig-accessibility", accessibility);

  // Messages (keep yours if present in metrics, else defaults)
  const msgs = safeObj(data?.metrics?.signal_messages);

  if ($("sig-performance-msg") && typeof msgs.performance === "string") $("sig-performance-msg").textContent = msgs.performance;
  if ($("sig-seo-msg") && typeof msgs.seo === "string") $("sig-seo-msg").textContent = msgs.seo;
  if ($("sig-structure-msg") && typeof msgs.structure === "string") $("sig-structure-msg").textContent = msgs.structure;
  if ($("sig-mobile-msg") && typeof msgs.mobile === "string") $("sig-mobile-msg").textContent = msgs.mobile;
  if ($("sig-security-msg") && typeof msgs.security === "string") $("sig-security-msg").textContent = msgs.security;
  if ($("sig-accessibility-msg") && typeof msgs.accessibility === "string") $("sig-accessibility-msg").textContent = msgs.accessibility;
}

function renderHumanSignals(data) {
  // You already had these working — keep it tolerant
  const hs = safeObj(data?.metrics?.human_signals || data?.metrics?.humanSignals);

  const setHS = (key, labelId, msgId, fallbackLabel, fallbackMsg) => {
    const h = safeObj(hs[key]);
    const label = (h.label || fallbackLabel || "UNKNOWN").toUpperCase();
    const msg = h.message || fallbackMsg || "Not available from this scan.";
    setText(labelId, label);
    setText(msgId, msg);
  };

  // Match your existing IDs in report.html
  setHS("clarity", "hs-clarity-label", "hs-clarity-msg", "UNKNOWN", "Not available from this scan.");
  setHS("trust", "hs-trust-label", "hs-trust-msg", "UNKNOWN", "Not available from this scan.");
  setHS("intent", "hs-intent-label", "hs-intent-msg", "UNKNOWN", "Not available from this scan.");
  setHS("maintenance", "hs-maintenance-label", "hs-maintenance-msg", "UNKNOWN", "Not available from this scan.");
  setHS("freshness", "hs-freshness-label", "hs-freshness-msg", "UNKNOWN", "Not available from this scan.");
}

function renderIssuesAndFixes(data) {
  // If you have these blocks in the HTML, keep them populated if present.
  const issues = data?.metrics?.top_issues || data?.metrics?.issues || [];
  const fixes = data?.metrics?.fix_sequence || data?.metrics?.recommended_fixes || [];

  const issuesEl = $("top-issues");
  const fixesEl = $("fix-sequence");

  if (issuesEl) {
    if (Array.isArray(issues) && issues.length) {
      issuesEl.innerHTML = issues.map((x) => `<li>${String(x)}</li>`).join("");
    } else {
      issuesEl.innerHTML = `<li>No issues were triggered from the available signals.</li>`;
    }
  }

  if (fixesEl) {
    if (Array.isArray(fixes) && fixes.length) {
      fixesEl.innerHTML = fixes.map((x) => `<li>${String(x)}</li>`).join("");
    } else {
      fixesEl.innerHTML = `<li>No optimisation items were triggered from the available signals.</li>`;
    }
  }
}

async function fetchReportData(reportId) {
  // Prefer GET with query param (easy to test in browser), fallback to POST
  const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;

  const res = await fetch(url, { method: "GET" });
  const data = await res.json().catch(() => ({}));

  if (!res.ok || data?.success === false) {
    const msg = data?.error || data?.message || `get-report-data failed (${res.status})`;
    throw new Error(msg);
  }

  return data;
}

async function loadReportData() {
  const reportId = getReportIdFromUrl();

  // ALWAYS end the loader, even on failure.
  try {
    if (!reportId) {
      setText("exec-narrative", "No report_id was provided.");
      // Render empty-safe UI
      renderSignals({ scores: {} });
      renderHumanSignals({ metrics: {} });
      renderIssuesAndFixes({ metrics: {} });
      return;
    }

    const data = await fetchReportData(reportId);

    renderHeader(data);

    const overall =
      typeof data?.scores?.overall === "number" ? data.scores.overall : null;

    renderExecutiveNarrative(data?.narrative, data?.url || "this site", overall);

    renderSignals(data);
    renderHumanSignals(data);
    renderIssuesAndFixes(data);
  } catch (err) {
    console.error("Report load error:", err);

    setText("exec-narrative", `Report could not be loaded: ${err?.message || "Unknown error"}`);

    // Show safe “not available” blocks instead of blank UI
    renderSignals({ scores: {} });
    renderHumanSignals({ metrics: {} });
    renderIssuesAndFixes({ metrics: {} });
  } finally {
    // This is what stops “Building Report” hanging forever
    window.dispatchEvent(new Event("iqweb:loaded"));
  }
}

document.addEventListener("DOMContentLoaded", loadReportData);
