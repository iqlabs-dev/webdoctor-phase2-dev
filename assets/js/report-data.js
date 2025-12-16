// /assets/js/report-data.js
// iQWEB Report v5.2 — Deterministic-first renderer
// Goal: render fully even when narrative is empty (Signal Contract v1)

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);

  function safeObj(o) {
    return o && typeof o === "object" ? o : {};
  }

  function asNumber(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function clampScore(v) {
    const n = asNumber(v);
    if (n === null) return null;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function formatDate(isoOrDate) {
    try {
      const d = isoOrDate ? new Date(isoOrDate) : new Date();
      if (Number.isNaN(d.getTime())) return "—";
      return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
    } catch {
      return "—";
    }
  }

  function pickFirstNonNull(...vals) {
    for (const v of vals) {
      if (v !== undefined && v !== null) return v;
    }
    return null;
  }

  function getQuery() {
    const u = new URL(window.location.href);
    return {
      report_id: u.searchParams.get("report_id"),
      id: u.searchParams.get("id"),
      url: u.searchParams.get("url"),
    };
  }

  // -----------------------------
  // Endpoint
  // -----------------------------
  // Adjust if your function path differs.
  const GET_REPORT_DATA_ENDPOINT = "/.netlify/functions/get-report-data";

  async function fetchReportData(query) {
    const u = new URL(GET_REPORT_DATA_ENDPOINT, window.location.origin);

    // Support: ?report_id=WEB-... or ?id=310 or ?url=https://...
    if (query.report_id) u.searchParams.set("report_id", query.report_id);
    if (query.id) u.searchParams.set("id", query.id);
    if (query.url) u.searchParams.set("url", query.url);

    const res = await fetch(u.toString(), { method: "GET" });
    if (!res.ok) throw new Error(`get-report-data failed: ${res.status}`);
    return await res.json();
  }

  // -----------------------------
  // UI wiring
  // -----------------------------
  function setText(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = text;
  }

  function setLink(id, href, text) {
    const el = $(id);
    if (!el) return;
    el.href = href || "#";
    el.textContent = text || "—";
  }

  function setBar(fillId, score) {
    const el = $(fillId);
    if (!el) return;
    const s = clampScore(score);
    el.style.width = s === null ? "0%" : `${s}%`;
  }

  function scoreBand(score) {
    const s = clampScore(score);
    if (s === null) return "Not available";
    if (s >= 85) return "Strong";
    if (s >= 70) return "Good";
    if (s >= 50) return "Mixed";
    return "Needs attention";
  }

  function explainSignal(label, score) {
    const s = clampScore(score);
    if (s === null) return `${label}: Not available from this scan.`;
    const band = scoreBand(s);
    return `${label}: ${band} (${s}/100) based on deterministic checks from this scan (no PSI).`;
  }

  function renderHumanSignals(humanSignals) {
    const list = $("humanSignalsList");
    const note = $("humanSignalsNote");
    if (!list) return;

    list.innerHTML = "";

    const arr = Array.isArray(humanSignals) ? humanSignals : [];

    if (!arr.length) {
      const empty = document.createElement("div");
      empty.className = "hsItem";
      empty.innerHTML = `
        <div class="hsTop">
          <p class="hsTitle">No Human Signals returned</p>
          <div class="hsMeta">Signal Contract v1</div>
        </div>
        <div class="hsBody">This scan returned deterministic scores + metrics, but no human_signals list.</div>
      `;
      list.appendChild(empty);
      if (note) note.textContent = "Tip: human_signals can be populated from metrics/basic_checks without requiring narrative.";
      return;
    }

    for (const item of arr) {
      const o = safeObj(item);
      const title = o.title || o.name || "Human Signal";
      const code = o.code || o.id || "";
      const body =
        o.body ||
        o.detail ||
        o.description ||
        o.message ||
        (typeof o === "string" ? o : "") ||
        "—";

      const severity = (o.severity || o.level || "").toString().toUpperCase();
      const metaBits = [];
      if (code) metaBits.push(code);
      if (severity) metaBits.push(severity);

      const div = document.createElement("div");
      div.className = "hsItem";
      div.innerHTML = `
        <div class="hsTop">
          <p class="hsTitle">${escapeHtml(title)}</p>
          <div class="hsMeta">${escapeHtml(metaBits.join(" • ") || "HUMAN SIGNAL")}</div>
        </div>
        <div class="hsBody">${escapeHtml(body)}</div>
      `;
      list.appendChild(div);
    }

    if (note) note.textContent = "Human Signals are optional and independent of Λ i Q narrative generation.";
  }

  function renderNarrative(narrativeValue) {
    const textEl = $("narrativeText");
    const noteEl = $("narrativeNote");
    if (!textEl) return;

    // Narrative may be empty by design
    const n = typeof narrativeValue === "string" ? narrativeValue.trim() : "";

    if (!n) {
      textEl.textContent =
        "Narrative not generated (by design). This report is rendered from deterministic scan data only.";
      if (noteEl) {
        noteEl.textContent =
          "Signal Contract v1: Narrative is optional. Deterministic signals + human signals must always render.";
      }
      return;
    }

    textEl.textContent = n;
    if (noteEl) noteEl.textContent = "Narrative present.";
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // -----------------------------
  // Main render
  // -----------------------------
  async function render() {
    const loader = $("loaderStage");
    const grid = $("contentGrid");

    if (loader) loader.classList.remove("hidden");
    if (grid) grid.classList.add("hidden");

    try {
      const query = getQuery();
      const data = await fetchReportData(query);

      const report = safeObj(data.report);
      const scores =
        safeObj(data.scores) ||
        safeObj(safeObj(data.metrics).scores) ||
        safeObj(safeObj(safeObj(data.report).metrics).scores);

      const metrics = safeObj(data.metrics);
      const humanSignals = data.human_signals;

      // Header meta
      const siteUrl =
        pickFirstNonNull(report.url, metrics.url, query.url) || "—";
      setLink("siteUrl", siteUrl !== "—" ? siteUrl : "#", siteUrl);

      setText("reportId", pickFirstNonNull(report.report_id, query.report_id, query.id, "—") || "—");
      setText("reportDate", formatDate(pickFirstNonNull(report.created_at, metrics.created_at, new Date())));

      // Overall
      const overall = clampScore(scores.overall);
      setText("overallScore", overall === null ? "—" : `${overall}/100`);
      setBar("overallFill", overall);
      setText(
        "overallDesc",
        overall === null
          ? "Overall: Not available from this scan."
          : `Overall: ${scoreBand(overall)} (${overall}/100). This is a deterministic snapshot (no PSI).`
      );

      // 6 deterministic signals (your contract)
      const perf = clampScore(scores.performance);
      const seo = clampScore(scores.seo);
      const structure = clampScore(scores.structure);
      const mobile = clampScore(scores.mobile);
      const security = clampScore(scores.security);
      const access = clampScore(scores.accessibility);

      setText("perfScore", perf === null ? "—" : `${perf}/100`);
      setBar("perfFill", perf);
      setText("perfDesc", explainSignal("Performance", perf));

      setText("seoScore", seo === null ? "—" : `${seo}/100`);
      setBar("seoFill", seo);
      setText("seoDesc", explainSignal("SEO", seo));

      setText("strScore", structure === null ? "—" : `${structure}/100`);
      setBar("strFill", structure);
      setText("strDesc", explainSignal("Structure", structure));

      setText("mobScore", mobile === null ? "—" : `${mobile}/100`);
      setBar("mobFill", mobile);
      setText("mobDesc", explainSignal("Mobile", mobile));

      setText("secScore", security === null ? "—" : `${security}/100`);
      setBar("secFill", security);
      setText("secDesc", explainSignal("Security", security));

      setText("accScore", access === null ? "—" : `${access}/100`);
      setBar("accFill", access);
      setText("accDesc", explainSignal("Accessibility", access));

      // Narrative is OPTIONAL: render whatever exists, otherwise render the “empty by design” message.
      renderNarrative(data.narrative);

      // Human signals
      renderHumanSignals(humanSignals);

      // Show content, hide loader (NO looping / NO polling)
      if (loader) loader.classList.add("hidden");
      if (grid) grid.classList.remove("hidden");
    } catch (err) {
      console.error(err);

      // Fail-safe: show content area with explicit error so it never "loops"
      const loader = $("loaderStage");
      const grid = $("contentGrid");
      if (loader) loader.classList.add("hidden");
      if (grid) grid.classList.remove("hidden");

      setText("overallDesc", "Could not load report data. Check the get-report-data function response and query parameters.");
      renderNarrative(""); // shows safe fallback
      renderHumanSignals([]); // shows safe fallback
    }
  }

  // -----------------------------
  // Theme toggle
  // -----------------------------
  function initTheme() {
    const btn = $("themeToggle");
    const key = "iqweb_theme_v1";
    const saved = localStorage.getItem(key);
    if (saved === "light" || saved === "dark") {
      document.documentElement.setAttribute("data-theme", saved);
    } else {
      // Default to dark (premium dashboard)
      document.documentElement.setAttribute("data-theme", "dark");
    }

    if (btn) {
      btn.addEventListener("click", () => {
        const cur = document.documentElement.getAttribute("data-theme") || "dark";
        const next = cur === "dark" ? "light" : "dark";
        document.documentElement.setAttribute("data-theme", next);
        localStorage.setItem(key, next);
      });
    }
  }

  function initRefresh() {
    const btn = $("refreshBtn");
    if (!btn) return;
    btn.addEventListener("click", () => render());
  }

  // Boot
  initTheme();
  initRefresh();
  render();
})();
