// /assets/js/report-data.js
// iQWEB Report v5.2 — loader-safe renderer (never leaves blank overlay)

function qs(sel) {
  return document.querySelector(sel);
}
function qsa(sel) {
  return Array.from(document.querySelectorAll(sel));
}
function safeObj(o) {
  return o && typeof o === "object" ? o : {};
}
function isNum(n) {
  return typeof n === "number" && Number.isFinite(n);
}
function clamp01(x) {
  if (!isNum(x)) return 0;
  return Math.max(0, Math.min(1, x));
}
function toScore100(v) {
  // allow 0..1 or 0..100
  if (!isNum(v)) return null;
  if (v <= 1) return Math.round(v * 100);
  return Math.round(v);
}
function setText(field, value) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  el.textContent = value ?? "";
}
function setLink(field, href, text) {
  const el = qs(`[data-field="${field}"]`);
  if (!el) return;
  if (typeof href === "string" && href) el.setAttribute("href", href);
  el.textContent = text ?? href ?? "";
}
function setBar(key, score01) {
  const el = qs(`[data-bar="${key}"]`);
  if (!el) return;
  el.style.width = `${Math.round(clamp01(score01) * 100)}%`;
}
function showBullets(field, items) {
  const ul = qs(`[data-field="${field}"]`);
  if (!ul) return;
  ul.innerHTML = "";
  if (!Array.isArray(items) || items.length === 0) return;
  for (const t of items) {
    const li = document.createElement("li");
    li.textContent = String(t);
    ul.appendChild(li);
  }
}

function hideLoaderHard() {
  const loader = document.getElementById("buildingReport");
  if (!loader) return;
  loader.classList.add("is-hiding");
  setTimeout(() => loader.remove(), 520);
}

function getReportIdFromUrl() {
  const sp = new URLSearchParams(location.search);
  return sp.get("report_id") || sp.get("id") || "";
}

function formatDateTime(iso) {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return { date: "", time: "" };
    return {
      date: d.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }),
      time: d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }),
    };
  } catch {
    return { date: "", time: "" };
  }
}

function resolveScores(data) {
  // preferred: top-level scores
  const top = safeObj(data.scores);
  const metrics = safeObj(data.metrics);
  const mScores = safeObj(metrics.scores);

  // allow nested variants
  const alt1 = safeObj(metrics?.report?.metrics?.scores);
  const alt2 = safeObj(metrics?.metrics?.scores);

  // merge precedence: explicit top > metrics.scores > alt
  return { ...alt2, ...alt1, ...mScores, ...top };
}

function scorePillText(score100) {
  if (!isNum(score100)) return "—";
  return `${Math.round(score100)}/100`;
}

function commentOrNA(txt) {
  const s = typeof txt === "string" ? txt.trim() : "";
  return s ? s : "Not available from this scan.";
}

function resolveSignalComments(metrics) {
  // You can wire these later; for now we try a few places and fall back.
  const m = safeObj(metrics);
  const diag = safeObj(m.diagnostic_signals);
  const comments = safeObj(m.comments);

  const pick = (k) =>
    diag?.[k]?.comment ??
    comments?.[k] ??
    null;

  return {
    performance: pick("performance"),
    seo: pick("seo"),
    structure: pick("structure"),
    mobile: pick("mobile"),
    security: pick("security"),
    accessibility: pick("accessibility"),
  };
}

function resolveHumanSignals(metrics) {
  const m = safeObj(metrics);
  const hs = safeObj(m.human_signals);
  const pick = (k) => safeObj(hs[k] || hs[`hs${k}`]);

  // This is deliberately tolerant. If you don’t have them yet, it’ll show NA.
  return {
    hs1: { score: pick(1).score ?? null, comment: pick(1).comment ?? null, status: pick(1).status ?? null },
    hs2: { score: pick(2).score ?? null, comment: pick(2).comment ?? null, status: pick(2).status ?? null },
    hs3: { score: pick(3).score ?? null, comment: pick(3).comment ?? null, status: pick(3).status ?? null },
    hs4: { score: pick(4).score ?? null, comment: pick(4).comment ?? null, status: pick(4).status ?? null },
    hs5: { score: pick(5).score ?? null, comment: pick(5).comment ?? null, status: pick(5).status ?? null },
  };
}

async function loadReport() {
  const rid = getReportIdFromUrl();
  if (!rid) {
    setText("overall-summary", "Missing report_id in URL.");
    return;
  }

  const res = await fetch(`/.netlify/functions/get-report-data?report_id=${encodeURIComponent(rid)}`, {
    method: "GET",
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    console.error("get-report-data failure:", res.status, data);
    setText("overall-summary", data?.error || data?.message || `Unable to load report (${res.status}).`);
    return;
  }

  const report = safeObj(data.report);
  const metrics = safeObj(data.metrics);
  const scores = resolveScores(data);

  // Header
  const url = report.url || "";
  setLink("site-url", url, url);
  const { date, time } = formatDateTime(report.created_at);
  setText("report-date", date);
  setText("report-time", time);
  setText("report-id", report.report_id || String(report.id || rid));

  // Executive narrative (keep honest: if none, say none)
  const narrative = safeObj(data.narrative);
  const executive = typeof narrative.executive_narrative === "string" ? narrative.executive_narrative.trim() : "";
  setText("overall-summary", executive || "No executive narrative was available for this scan.");

  // Diagnostic signal scores
  const sPerf = toScore100(scores.performance);
  const sSeo = toScore100(scores.seo);
  const sStruct = toScore100(scores.structure);
  const sMob = toScore100(scores.mobile);
  const sSec = toScore100(scores.security);
  const sAcc = toScore100(scores.accessibility);

  setText("score-performance", scorePillText(sPerf));
  setText("score-seo", scorePillText(sSeo));
  setText("score-structure", scorePillText(sStruct));
  setText("score-mobile", scorePillText(sMob));
  setText("score-security", scorePillText(sSec));
  setText("score-accessibility", scorePillText(sAcc));

  setBar("performance", isNum(sPerf) ? sPerf / 100 : 0);
  setBar("seo", isNum(sSeo) ? sSeo / 100 : 0);
  setBar("structure", isNum(sStruct) ? sStruct / 100 : 0);
  setBar("mobile", isNum(sMob) ? sMob / 100 : 0);
  setBar("security", isNum(sSec) ? sSec / 100 : 0);
  setBar("accessibility", isNum(sAcc) ? sAcc / 100 : 0);

  // Diagnostic comments (optional; if not present -> NA)
  const c = resolveSignalComments(metrics);
  setText("performance-comment", commentOrNA(c.performance));
  setText("seo-comment", commentOrNA(c.seo));
  setText("structure-comment", commentOrNA(c.structure));
  setText("mobile-comment", commentOrNA(c.mobile));
  setText("security-comment", commentOrNA(c.security));
  setText("accessibility-comment", commentOrNA(c.accessibility));

  // Human signals (optional)
  const hs = resolveHumanSignals(metrics);
  const hsMap = [
    ["hs1", "hs1-status", "hs1-comment"],
    ["hs2", "hs2-status", "hs2-comment"],
    ["hs3", "hs3-status", "hs3-comment"],
    ["hs4", "hs4-status", "hs4-comment"],
    ["hs5", "hs5-status", "hs5-comment"],
  ];
  for (const [key, statusField, commentField] of hsMap) {
    const row = safeObj(hs[key]);
    const score100 = toScore100(row.score);
    setText(statusField, isNum(score100) ? scorePillText(score100) : (row.status || "—"));
    setBar(key, isNum(score100) ? score100 / 100 : 0);
    setText(commentField, commentOrNA(row.comment));
  }

  // Key Insights / Top Issues / Final Notes / Fix sequence
  // (These are narrative-dependent; if missing, they remain empty — no fake filler.)
  showBullets("key-insights", Array.isArray(narrative.key_insights) ? narrative.key_insights : []);
  showBullets("top-issues", Array.isArray(narrative.top_issues) ? narrative.top_issues : []);
  showBullets("final-notes", Array.isArray(narrative.final_notes) ? narrative.final_notes : []);

  // Fix sequence: allow array of strings or plain string
  const fixEl = qs(`[data-field="fix-sequence"]`);
  if (fixEl) {
    const fs = narrative.fix_sequence;
    if (Array.isArray(fs)) {
      fixEl.innerHTML = "";
      const ul = document.createElement("ul");
      ul.className = "wd-bullets";
      for (const t of fs) {
        const li = document.createElement("li");
        li.textContent = String(t);
        ul.appendChild(li);
      }
      fixEl.appendChild(ul);
    } else if (typeof fs === "string" && fs.trim()) {
      fixEl.textContent = fs.trim();
    } else {
      fixEl.textContent = "";
    }
  }

  console.log("[REPORT] Loaded OK ->", {
    report_id: report.report_id,
    url: report.url,
    hasNarrative: !!executive,
  });
}

document.addEventListener("DOMContentLoaded", async () => {
  // Safety: never leave the loader up forever
  const safetyTimeout = setTimeout(() => hideLoaderHard(), 6000);

  try {
    await loadReport();
  } catch (e) {
    console.error("[REPORT] fatal:", e);
    setText("overall-summary", "Report failed to load. Please try again.");
  } finally {
    clearTimeout(safetyTimeout);

    // ✅ Always remove loader, no matter what
    hideLoaderHard();

    // Keep your event too (harmless if duplicate)
    window.dispatchEvent(new Event("iqweb:loaded"));
  }
});
