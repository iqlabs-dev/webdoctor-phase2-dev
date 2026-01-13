// /assets/js/report-data.js

/* -------------------------------------------------- */
/* Tiny DOM helpers                                   */
/* -------------------------------------------------- */
function $(id) {
  return document.getElementById(id);
}

function showLoader(on) {
  const loader = $("loaderSection");
  const root = $("reportRoot");
  if (!loader || !root) return;

  loader.style.display = on ? "block" : "none";
  root.style.display = on ? "none" : "block";
}

function setLoaderText(text) {
  const el = $("loaderText");
  if (el) el.textContent = String(text || "");
}

function showError(msg) {
  const el = $("errorBox");
  if (!el) return;
  el.style.display = "block";
  el.textContent = String(msg || "Unknown error");
}

function clearError() {
  const el = $("errorBox");
  if (!el) return;
  el.style.display = "none";
  el.textContent = "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getQueryParam(name) {
  const u = new URL(window.location.href);
  return u.searchParams.get(name);
}

/* -------------------------------------------------- */
/* Fetch helpers                                      */
/* -------------------------------------------------- */
async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const text = await r.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch (_) {
    data = { success: false, error: "Non-JSON response", raw: text };
  }

  if (!r.ok) {
    const msg = data?.error || data?.detail || `HTTP ${r.status}`;
    throw new Error(msg);
  }

  return data;
}

async function fetchReportData(reportId) {
  const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(
    reportId
  )}`;
  return fetchJson(url);
}

async function generateNarrative(reportId) {
  return fetchJson("/.netlify/functions/generate-narrative", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ report_id: reportId }),
  });
}

/* -------------------------------------------------- */
/* Rendering (minimal – uses your existing DOM)        */
/* -------------------------------------------------- */
function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asArray(v) {
  return Array.isArray(v) ? v : [];
}

function renderHeader(res) {
  const h = safeObj(res.header);
  const website = $("hdrWebsite");
  const rid = $("hdrReportId");
  const created = $("hdrCreated");

  if (website) website.textContent = h.website || "";
  if (rid) rid.textContent = h.report_id || "";
  if (created) created.textContent = h.created_at || "";
}

function renderScores(res) {
  const s = safeObj(res.scores);
  const set = (id, v) => {
    const el = $(id);
    if (el) el.textContent = String(v ?? "");
  };

  set("scoreOverall", s.overall);
  set("scorePerformance", s.performance);
  set("scoreMobile", s.mobile);
  set("scoreSEO", s.seo);
  set("scoreSecurity", s.security);
  set("scoreStructure", s.structure);
  set("scoreAccessibility", s.accessibility);
}

function renderSummary(res) {
  const el = $("overallSummary");
  if (el) el.textContent = res.overall_summary || "";
}

function renderPSI(res) {
  // If you already have PSI rendering logic elsewhere, keep it.
  // This stub just confirms data exists.
  const el = $("psiStatus");
  const psi = safeObj(res.psi);
  if (el) el.textContent = psi?.enabled === false ? "PSI disabled" : "PSI ready";
}

function renderSignalsGrid(res) {
  // If you already have a signal renderer, keep it.
  // This stub shows count only.
  const el = $("signalsCount");
  const signals = asArray(res.delivery_signals);
  if (el) el.textContent = `${signals.length} signals`;
}

function renderExecutiveNarrative(res) {
  const box = $("executiveNarrative");
  if (!box) return;

  const n = safeObj(res.narrative);
  const lines = asArray(n?.overall?.lines).filter(Boolean);

  if (lines.length) {
    box.textContent = lines.join("\n");
    return;
  }

  // Narrative not ready yet (but report IS ready)
  box.textContent = "Narrative is still generating…";
}

/* -------------------------------------------------- */
/* Boot                                                */
/* -------------------------------------------------- */
function boot() {
  const reportId = getQueryParam("report_id") || getQueryParam("id");

  if (!reportId) {
    showLoader(false);
    showError("Missing report_id in the URL.");
    return;
  }

  showLoader(true);
  clearError();
  setLoaderText("Building report…");

  (async () => {
    try {
      const res = await fetchReportData(reportId);

      if (!res?.success) {
        throw new Error(res?.error || "Unable to load report data.");
      }

      // ✅ Render immediately when core data is present
      renderHeader(res);
      renderScores(res);
      renderSummary(res);
      renderPSI(res);
      renderSignalsGrid(res);
      renderExecutiveNarrative(res);

      // ✅ IMPORTANT: never block UI on narrative
      showLoader(false);

      // If narrative missing, trigger generation + poll quietly
      const hasOverallLines =
        Array.isArray(res?.narrative?.overall?.lines) &&
        res.narrative.overall.lines.length > 0;

      if (!hasOverallLines && getQueryParam("regen") !== "0") {
        setLoaderText("Building narrative…");

        try {
          await generateNarrative(reportId);
        } catch (e) {
          // Non-fatal
          console.warn("[narrative] generate failed:", e);
        }

        // Poll up to ~90s
        for (let i = 0; i < 60; i++) {
          await sleep(1500);
          const next = await fetchReportData(reportId);
          const ok =
            next?.success &&
            Array.isArray(next?.narrative?.overall?.lines) &&
            next.narrative.overall.lines.length > 0;

          if (ok) {
            renderExecutiveNarrative(next);
            break;
          }
        }
      }
    } catch (err) {
      console.error("[report] boot error:", err);
      showLoader(false);
      showError(err?.message || String(err));
    }
  })();
}

boot();
