// /assets/js/report-data.js
// iQWEB Report UI — Schema v1.0 (LOCKED)
// - Deterministic-first rendering
// - Narrative optional (never blocks render)
// - Delivery signal order must follow payload delivery_signals[] (already locked in backend)

(function () {
  // -----------------------------
  // Helpers
  // -----------------------------
  const $ = (id) => document.getElementById(id);

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function asInt(v, fallback = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function prettyJSON(obj) {
    try { return JSON.stringify(obj, null, 2); }
    catch { return String(obj); }
  }

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  }

  function verdict(score) {
    const n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  function setBar(el, score) {
    if (!el) return;
    el.style.width = `${asInt(score, 0)}%`;
  }

  // -----------------------------
  // Theme (kept simple + reliable)
  // -----------------------------
  function getTheme() {
    const saved = localStorage.getItem("iqweb_theme");
    return saved === "light" ? "light" : "dark";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("iqweb_theme", theme);
  }

  function wireThemeToggle() {
    const btn = $("btnToggleTheme");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const next = getTheme() === "dark" ? "light" : "dark";
      applyTheme(next);
    });
  }

  function wireRefresh() {
    const btn = $("btnRefresh");
    if (!btn) return;
    btn.addEventListener("click", () => {
      // Hard refresh same report_id
      window.location.reload();
    });
  }

  // -----------------------------
  // Header setters (LOCKED)
  // -----------------------------
  function setHeaderWebsite(url) {
    const a = $("hdrWebsite");
    if (!a) return;
    if (typeof url === "string" && url.trim()) {
      const u = url.trim();
      a.textContent = u;
      a.href = u;
    } else {
      a.textContent = "—";
      a.removeAttribute("href");
    }
  }

  function setHeaderReportId(reportId) {
    const el = $("hdrReportId");
    if (!el) return;
    el.textContent = reportId ? String(reportId) : "—";
  }

  function setHeaderReportDate(isoString) {
    const el = $("hdrReportDate");
    if (!el) return;
    el.textContent = formatDate(isoString);
  }

  // -----------------------------
  // Fetch data
  // -----------------------------
  function getReportIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("report_id") || "";
  }

  async function fetchReportData(reportId) {
    // Primary Netlify function path
    const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
    const res = await fetch(url, { method: "GET" });

    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`get-report-data failed (${res.status}). ${txt}`);
    }

    const data = await res.json();
    return data;
  }

  // -----------------------------
  // Render sections (LOCKED)
  // -----------------------------
  function renderOverall(scores) {
    const overall = asInt(scores.overall, 0);

    $("overallPill").textContent = `${overall}/100`;
    setBar($("overallBar"), overall);

    const note = `Overall: ${verdict(overall)} (${overall}/100). This is a deterministic snapshot (no PSI).`;
    $("overallNote").textContent = note;
  }

  function normalizeSignalOrder(deliverySignals) {
    // The backend payload order is the lock. We still defensively filter only known IDs.
    const allowed = new Set(["performance", "mobile", "seo", "security", "structure", "accessibility"]);
    return (Array.isArray(deliverySignals) ? deliverySignals : [])
      .filter(s => allowed.has(String(s?.id || "")));
  }

  function twoLineFallbackSummary(label, score) {
    // Deterministic safe fallback (not fake, just framing what the score represents)
    const s = asInt(score, 0);
    const line1 = `${label}: ${verdict(s)} (${s}/100) based on deterministic checks from this scan (no PSI).`;
    const line2 = `Use the findings and fix sequence below to prioritise next steps.`;
    return `${line1}<br>${line2}`;
  }

  function renderSignals(scores, deliverySignals) {
    const grid = $("signalsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const list = normalizeSignalOrder(deliverySignals);

    for (const sig of list) {
      const id = String(sig.id);
      const label = String(sig.label || id);
      const score = asInt(sig.score ?? scores?.[id] ?? 0, 0);

      const summaryRaw = typeof sig.summary === "string" ? sig.summary.trim() : "";
      const summary = summaryRaw ? escapeHtml(summaryRaw).replaceAll("\n", "<br>") : twoLineFallbackSummary(label, score);

      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML = `
        <div class="card-top">
          <div>
            <h3>${escapeHtml(label)}</h3>
            <div class="det-badge">Deterministic</div>
          </div>
          <div class="score-mini">${score}/100</div>
        </div>
        <div class="bar"><div style="width:${score}%;"></div></div>
        <div class="summary">${summary}</div>
      `;

      grid.appendChild(card);
    }
  }

  function renderNarrative(narrative) {
    const n = safeObj(narrative);
    const lead = typeof n.executive_lead === "string" ? n.executive_lead.trim() : "";
    const status = safeObj(n.status);

    const textEl = $("narrativeText");
    const statusEl = $("narrativeStatus");

    if (lead) {
      textEl.innerHTML = escapeHtml(lead).replaceAll("\n", "<br>");
      statusEl.textContent = "";
      return;
    }

    // Locked empty-state wording
    textEl.textContent = "Narrative not generated — insufficient signal context at this stage.";

    // Extra context (quiet, optional)
    const generated = status.generated === true;
    const reason = typeof status.reason === "string" ? status.reason : "";
    statusEl.textContent = generated ? "" : (reason ? `Signal Contract v1: Narrative is optional. (${reason})` : "Signal Contract v1: Narrative is optional.");
  }

  function renderMetrics(keyMetrics) {
    const root = $("metricsRoot");
    if (!root) return;
    root.innerHTML = "";

    const km = safeObj(keyMetrics);
    const http = safeObj(km.http);
    const page = safeObj(km.page);
    const content = safeObj(km.content);
    const freshness = safeObj(km.freshness);
    const sec = safeObj(km.security);

    root.innerHTML = `
      <details open>
        <summary>HTTP & Page Basics</summary>
        <div class="kv">
          <div><b>Status:</b> ${escapeHtml(http.status ?? "—")}</div>
          <div><b>Content-Type:</b> ${escapeHtml(http.content_type ?? "—")}</div>
          <div><b>Final URL:</b> ${escapeHtml(http.final_url ?? "—")}</div>
          <div><b>HTML Bytes:</b> ${escapeHtml(content.html_bytes ?? "—")}</div>

          <div><b>Title Present:</b> ${escapeHtml(page.title_present ?? "—")}</div>
          <div><b>H1 Present:</b> ${escapeHtml(page.h1_present ?? "—")}</div>
          <div><b>Canonical Present:</b> ${escapeHtml(page.canonical_present ?? "—")}</div>
          <div><b>Viewport Present:</b> ${escapeHtml(page.viewport_present ?? "—")}</div>

          <div><b>Images:</b> ${escapeHtml(content.img_count ?? "—")}</div>
          <div><b>Images w/ ALT:</b> ${escapeHtml(content.img_alt_count ?? "—")}</div>
        </div>
        <div class="mono">${escapeHtml(prettyJSON({ http, page, content }))}</div>
      </details>

      <details>
        <summary>Freshness Signals</summary>
        <div class="kv">
          <div><b>Last-Modified Header Present:</b> ${escapeHtml(freshness.last_modified_header_present ?? "—")}</div>
          <div><b>Last-Modified Value:</b> ${escapeHtml(freshness.last_modified_header_value ?? "—")}</div>
          <div><b>Copyright Range:</b> ${escapeHtml((freshness.copyright_year_min ?? "—") + "–" + (freshness.copyright_year_max ?? "—"))}</div>
          <div><b>Note:</b> Deterministic indicators only.</div>
        </div>
        <div class="mono">${escapeHtml(prettyJSON(freshness))}</div>
      </details>

      <details>
        <summary>Security Headers Snapshot</summary>
        <div class="kv">
          <div><b>HTTPS:</b> ${escapeHtml(sec.https ?? "—")}</div>
          <div><b>HSTS:</b> ${escapeHtml(sec.hsts_present ?? "—")}</div>
          <div><b>CSP:</b> ${escapeHtml(sec.csp_present ?? "—")}</div>
          <div><b>X-Frame-Options:</b> ${escapeHtml(sec.x_frame_options_present ?? "—")}</div>
          <div><b>X-Content-Type-Options:</b> ${escapeHtml(sec.x_content_type_options_present ?? "—")}</div>
          <div><b>Referrer-Policy:</b> ${escapeHtml(sec.referrer_policy_present ?? "—")}</div>
        </div>
        <div class="mono">${escapeHtml(prettyJSON(sec))}</div>
      </details>
    `;
  }

  function renderFindings(findings) {
    const root = $("findingsRoot");
    if (!root) return;
    root.innerHTML = "";

    const list = Array.isArray(findings) ? findings : [];

    if (!list.length) {
      root.innerHTML = `<div class="summary">No issues returned from this scan.</div>`;
      return;
    }

    for (const f of list) {
      const title = typeof f.title === "string" ? f.title : "Finding";
      const impact = typeof f.impact === "string" ? f.impact : "";
      const severity = typeof f.severity === "string" ? f.severity : "info";
      const evidence = safeObj(f.evidence);

      const el = document.createElement("div");
      el.className = "finding";
      el.innerHTML = `
        <div class="finding-head">
          <div>
            <div class="finding-title">${escapeHtml(title)}</div>
            <div class="finding-block"><b>Impact:</b> ${escapeHtml(impact || "—")}</div>
          </div>
          <div class="sev">${escapeHtml(severity)}</div>
        </div>
        <div class="finding-block"><b>Evidence:</b></div>
        <div class="mono">${escapeHtml(prettyJSON(evidence))}</div>
      `;
      root.appendChild(el);
    }
  }

  function renderFixPlan(fixPlan) {
    const root = $("fixPlanRoot");
    if (!root) return;
    root.innerHTML = "";

    const phases = Array.isArray(fixPlan) ? fixPlan : [];

    if (!phases.length) {
      root.innerHTML = `<div class="summary">No fix plan returned from this scan.</div>`;
      return;
    }

    for (const p of phases) {
      const phaseNum = p?.phase ?? "";
      const title = typeof p?.title === "string" ? p.title : `Phase ${phaseNum}`;
      const why = typeof p?.why === "string" ? p.why : "";
      const actions = Array.isArray(p?.actions) ? p.actions : [];

      const el = document.createElement("div");
      el.className = "phase";

      const listItems = actions.length
        ? actions.map(a => {
            const actionText = typeof a?.action === "string" ? a.action : "Action";
            const fid = typeof a?.finding_id === "string" ? a.finding_id : "";
            return `<li><strong>${escapeHtml(actionText)}</strong>${fid ? ` <span style="color:var(--muted2);">(${escapeHtml(fid)})</span>` : ""}</li>`;
          }).join("")
        : `<li><strong>No actions listed for this phase yet.</strong></li>`;

      el.innerHTML = `
        <div class="phase-title">${escapeHtml(`Phase ${phaseNum}: ${title}`)}</div>
        <div class="phase-why"><b>Why:</b> ${escapeHtml(why || "—")}</div>
        <ul>${listItems}</ul>
      `;

      root.appendChild(el);
    }
  }

  // -----------------------------
  // Main
  // -----------------------------
  async function main() {
    applyTheme(getTheme());
    wireThemeToggle();
    wireRefresh();

    const loaderSection = $("loaderSection");
    const reportRoot = $("reportRoot");
    const statusEl = $("loaderStatus");

    const reportId = getReportIdFromUrl();
    if (!reportId) {
      statusEl.textContent = "Missing report_id in URL. Example: report.html?report_id=WEB-XXXX";
      return;
    }

    try {
      statusEl.textContent = "Fetching report payload…";
      const data = await fetchReportData(reportId);

      // Expect locked v1.0
      const header = safeObj(data.header);
      const scores = safeObj(data.scores);

      // Header
      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      // Render core
      renderOverall(scores);
      renderSignals(scores, data.delivery_signals);
      renderNarrative(data.narrative);
      renderMetrics(data.key_metrics);
      renderFindings(data.findings);
      renderFixPlan(data.fix_plan);

      // Show report, hide loader
      loaderSection.style.display = "none";
      reportRoot.style.display = "block";
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Failed to load report data: ${err?.message || String(err)}`;
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
