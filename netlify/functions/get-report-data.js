// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.1 (LOCKED)
// - Cards must never be missing
// - Every score must show evidence: observations + deductions + issues
// - Missing is never neutral: explicit penalties are displayed
// - Narrative is optional and must never block render

(function () {
  const $ = (id) => document.getElementById(id);

  function safeObj(v) {
    return v && typeof v === "object" ? v : {};
  }

  function asArray(v) {
    return Array.isArray(v) ? v : [];
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
  // Theme (simple + stable)
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
      applyTheme(getTheme() === "dark" ? "light" : "dark");
    });
  }

  function wireRefresh() {
    const btn = $("btnRefresh");
    if (!btn) return;
    btn.addEventListener("click", () => window.location.reload());
  }

  // -----------------------------
  // Header setters
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
  // Fetch
  // -----------------------------
  function getReportIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("report_id") || params.get("id") || "";
  }

  async function fetchReportData(reportId) {
    const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
    const res = await fetch(url, { method: "GET" });

    const text = await res.text().catch(() => "");
    let data = null;
    try { data = JSON.parse(text); } catch { /* ignore */ }

    if (!res.ok) {
      const msg = data?.detail || data?.error || text || `HTTP ${res.status}`;
      throw new Error(msg);
    }

    if (data && data.success === false) {
      const msg = data?.detail || data?.error || "Unknown error";
      throw new Error(msg);
    }

    return data;
  }

  // -----------------------------
  // Render: Overall
  // -----------------------------
  function renderOverall(scores) {
    const overall = asInt(scores.overall, 0);

    const pill = $("overallPill");
    if (pill) pill.textContent = `${overall}/100`;

    setBar($("overallBar"), overall);

    const note = $("overallNote");
    if (note) {
      note.textContent = `Overall: ${verdict(overall)} (${overall}/100). Every score is backed by visible evidence and explicit deductions.`;
    }
  }

  // -----------------------------
  // Delivery Signals — Locked card format
  // Title + Impact + Evidence + Severity
  // Plus explicit deductions for missing/failed signals.
  // -----------------------------
  function severityFromSignal(signal) {
    // If any "high" issues exist -> high; else if any "med" -> med; else low.
    const issues = asArray(signal.issues);
    if (issues.some(i => i?.severity === "high")) return "high";
    if (issues.some(i => i?.severity === "med")) return "med";
    if (issues.some(i => i?.severity === "low")) return "low";
    return "low";
  }

  function signalImpactText(signal) {
    // Prefer first issue impact; otherwise a safe framing statement.
    const issues = asArray(signal.issues);
    const first = issues.find(i => typeof i?.impact === "string" && i.impact.trim());
    if (first) return first.impact.trim();
    return "This score reflects deterministic checks from this scan. Any missing observability is penalised explicitly to preserve report completeness.";
  }

  function renderObservations(observations) {
    const obs = asArray(observations);
    if (!obs.length) return `<div class="small-note">No observations recorded.</div>`;

    const rows = obs.map(o => {
      const label = escapeHtml(o?.label ?? "Observation");
      const value = escapeHtml(String(o?.value ?? "null"));
      const src = escapeHtml(String(o?.source ?? ""));
      return `<div style="display:flex;justify-content:space-between;gap:10px;">
        <span style="color:var(--muted);">${label}</span>
        <span title="${src}" style="font-weight:700;">${value}</span>
      </div>`;
    }).join("");

    return `<div style="margin-top:10px;display:grid;gap:6px;">${rows}</div>`;
  }

  function renderDeductions(deductions) {
    const deds = asArray(deductions);
    if (!deds.length) return `<div class="small-note" style="margin-top:10px;">No deductions applied.</div>`;

    const items = deds.map(d => {
      const reason = escapeHtml(d?.reason ?? "Deduction");
      const pts = escapeHtml(String(d?.points ?? 0));
      const code = escapeHtml(d?.code ?? "");
      return `<li style="margin:6px 0;color:var(--muted);">
        <strong style="color:var(--text);">-${pts}</strong> ${reason}
        ${code ? `<span style="color:var(--muted2);">(${code})</span>` : ""}
      </li>`;
    }).join("");

    return `<div style="margin-top:10px;">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">Deductions (explicit)</div>
      <ul style="margin:8px 0 0 18px;padding:0;">${items}</ul>
    </div>`;
  }

  function renderIssues(issues) {
    const list = asArray(issues);
    if (!list.length) {
      return `<div class="small-note" style="margin-top:10px;">No issues detected for this signal.</div>`;
    }

    // Keep it compact: title + severity + impact + evidence JSON
    const blocks = list.map(i => {
      const title = escapeHtml(i?.title ?? "Issue");
      const sev = escapeHtml(i?.severity ?? "low");
      const impact = escapeHtml(i?.impact ?? "—");
      const ev = i?.evidence ?? {};
      return `
        <div style="margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--panel);">
          <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
            <div style="font-weight:750;">${title}</div>
            <div style="padding:6px 10px;border-radius:999px;border:1px solid var(--border);font-size:12px;font-weight:800;text-transform:uppercase;">
              ${sev}
            </div>
          </div>
          <div style="margin-top:8px;color:var(--muted);font-size:12.5px;line-height:1.5;">
            <b style="color:var(--text);">Impact:</b> ${impact}
          </div>
          <div class="mono" style="margin-top:8px;">${escapeHtml(prettyJSON(ev))}</div>
        </div>
      `;
    }).join("");

    return `<div style="margin-top:10px;">
      <div style="font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">Issues (visible)</div>
      ${blocks}
    </div>`;
  }

  function renderSignals(deliverySignals) {
    const grid = $("signalsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const list = asArray(deliverySignals);
    if (!list.length) {
      // This should never happen if backend obeys contract.
      grid.innerHTML = `<div class="summary">Contract violation: delivery_signals missing.</div>`;
      return;
    }

    for (const sig of list) {
      const id = String(sig?.id ?? "");
      const label = String(sig?.label ?? id);
      const score = asInt(sig?.score, 0);
      const base = asInt(sig?.base_score, score);
      const penalty = Number(sig?.penalty_points);
      const penaltyPts = Number.isFinite(penalty) ? penalty : (base - score);

      const severity = severityFromSignal(sig);
      const impact = signalImpactText(sig);

      const card = document.createElement("div");
      card.className = "card card-wide";

      card.innerHTML = `
        <div class="card-top">
          <div>
            <h3>${escapeHtml(label)}</h3>
            <div class="det-badge">Deterministic • Evidence-backed</div>
          </div>
          <div class="score-mini">${score}/100</div>
        </div>

        <div class="bar"><div style="width:${score}%;"></div></div>

        <div style="margin-top:10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
          <div class="pill">Base: <b>${base}</b></div>
          <div class="pill">Penalty: <b>${Math.max(0, Math.round(penaltyPts))}</b></div>
          <div class="pill">Severity: <b>${escapeHtml(severity)}</b></div>
        </div>

        <div style="margin-top:10px;">
          <div style="font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">Impact</div>
          <div class="summary" style="min-height:unset;margin-top:6px;">${escapeHtml(impact)}</div>
        </div>

        <div style="margin-top:10px;">
          <div style="font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">Evidence (observations)</div>
          ${renderObservations(sig?.observations)}
        </div>

        ${renderDeductions(sig?.deductions)}

        ${renderIssues(sig?.issues)}
      `;

      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Narrative (optional)
  // -----------------------------
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

    textEl.textContent = "Narrative not generated — insufficient signal context at this stage.";
    const reason = typeof status.reason === "string" ? status.reason : "";
    statusEl.textContent = reason ? `Signal Contract: narrative optional. (${reason})` : "Signal Contract: narrative optional.";
  }

  // -----------------------------
  // Key Metrics
  // -----------------------------
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

          <div><b>Title Present:</b> ${escapeHtml(page.title_present ?? "—")}</div>
          <div><b>Canonical Present:</b> ${escapeHtml(page.canonical_present ?? "—")}</div>
          <div><b>H1 Present:</b> ${escapeHtml(page.h1_present ?? "—")}</div>
          <div><b>Viewport Present:</b> ${escapeHtml(page.viewport_present ?? "—")}</div>

          <div><b>HTML Bytes:</b> ${escapeHtml(content.html_bytes ?? "—")}</div>
          <div><b>Images:</b> ${escapeHtml(content.img_count ?? "—")}</div>
          <div><b>Images w/ ALT:</b> ${escapeHtml(content.img_alt_count ?? "—")}</div>
        </div>
        <div class="mono">${escapeHtml(prettyJSON({ http, page, content }))}</div>
      </details>

      <details>
        <summary>Freshness Signals</summary>
        <div class="kv">
          <div><b>Last-Modified Present:</b> ${escapeHtml(freshness.last_modified_header_present ?? "—")}</div>
          <div><b>Last-Modified Value:</b> ${escapeHtml(freshness.last_modified_header_value ?? "—")}</div>
          <div><b>Copyright:</b> ${escapeHtml((freshness.copyright_year_min ?? "—") + "–" + (freshness.copyright_year_max ?? "—"))}</div>
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

  // -----------------------------
  // Findings
  // -----------------------------
  function renderFindings(findings) {
    const root = $("findingsRoot");
    if (!root) return;
    root.innerHTML = "";

    const list = asArray(findings);

    if (!list.length) {
      root.innerHTML = `<div class="summary">No issues returned from this scan.</div>`;
      return;
    }

    for (const f of list) {
      const id = escapeHtml(f?.id ?? "");
      const title = escapeHtml(f?.title ?? "Finding");
      const impact = escapeHtml(f?.impact ?? "—");
      const severity = escapeHtml(f?.severity ?? "low");
      const ev = safeObj(f?.evidence);

      const el = document.createElement("div");
      el.className = "finding";

      el.innerHTML = `
        <div class="finding-head">
          <div>
            <div class="finding-title">${title} ${id ? `<span style="color:var(--muted2);font-weight:650;">(${id})</span>` : ""}</div>
            <div class="finding-block"><b>Impact:</b> ${impact}</div>
          </div>
          <div class="sev">${severity}</div>
        </div>
        <div class="finding-block"><b>Evidence:</b></div>
        <div class="mono">${escapeHtml(prettyJSON(ev))}</div>
      `;

      root.appendChild(el);
    }
  }

  // -----------------------------
  // Fix Plan
  // -----------------------------
  function renderFixPlan(plan) {
    const root = $("fixPlanRoot");
    if (!root) return;
    root.innerHTML = "";

    const phases = asArray(plan);

    if (!phases.length) {
      root.innerHTML = `<div class="summary">No fix plan returned from this scan.</div>`;
      return;
    }

    for (const p of phases) {
      const phaseNum = escapeHtml(p?.phase ?? "");
      const title = escapeHtml(p?.title ?? `Phase ${phaseNum}`);
      const why = escapeHtml(p?.why ?? "—");
      const actions = asArray(p?.actions);

      const items = actions.length
        ? actions.map(a => {
            const actionText = escapeHtml(a?.action ?? "Action");
            const fid = escapeHtml(a?.finding_id ?? "");
            return `<li><strong style="color:var(--text);">${actionText}</strong>${fid ? ` <span style="color:var(--muted2);">(${fid})</span>` : ""}</li>`;
          }).join("")
        : `<li><strong style="color:var(--text);">No actions listed for this phase yet.</strong></li>`;

      const el = document.createElement("div");
      el.className = "phase";
      el.innerHTML = `
        <div class="phase-title">${phaseNum ? `Phase ${phaseNum} — ` : ""}${title}</div>
        <div class="phase-why"><b>Why:</b> ${why}</div>
        <ul>${items}</ul>
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

      // Contract v1.0.1
      const header = safeObj(data.header);
      const scores = safeObj(data.scores);

      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      renderOverall(scores);
      renderSignals(data.delivery_signals);
      renderNarrative(data.narrative);
      renderMetrics(data.key_metrics);
      renderFindings(data.findings);
      renderFixPlan(data.fix_plan);

      loaderSection.style.display = "none";
      reportRoot.style.display = "block";
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Failed to load report data: ${err?.message || String(err)}`;
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
