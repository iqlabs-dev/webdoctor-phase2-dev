// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.3 (LOCKED)
// - Cards must never be missing
// - Discussion-first: compact 6-card grid + 2-line deterministic summary
// - Evidence is ALWAYS available (collapsed by default)
// - Missing is never neutral: explicit penalties and reasons shown in Evidence
// - Narrative is optional and must never block render
// - UI enforces locked card order (even if backend changes order)

(function () {
  const $ = (id) => document.getElementById(id);

  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

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
      year: "numeric", month: "short", day: "2-digit",
      hour: "2-digit", minute: "2-digit"
    });
  }

  function verdict(score) {
    const n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  // -----------------------------
  // Theme
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
    btn.addEventListener("click", () => applyTheme(getTheme() === "dark" ? "light" : "dark"));
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
  // Overall (single number)
  // -----------------------------
  function renderOverall(scores) {
    const overall = asInt(scores.overall, 0);

    const num = $("overallPill");
    if (num) num.textContent = `${overall}`; // single number only

    const bar = $("overallBar");
    if (bar) bar.style.width = `${overall}%`;

    const note = $("overallNote");
    if (note) {
      note.textContent =
        `Overall: ${verdict(overall)} (${overall}). Scores are backed by deterministic checks. Evidence is available per signal.`;
    }
  }

  // -----------------------------
  // Locked UI order (rule)
  // Performance → Mobile → SEO → Security → Structure → Accessibility
  // Match by id OR label (case-insensitive).
  // -----------------------------
  const ORDER = [
    { key: "performance", match: ["performance"] },
    { key: "mobile", match: ["mobile", "mobile experience"] },
    { key: "seo", match: ["seo", "seo foundations"] },
    { key: "security", match: ["security", "security & trust", "trust"] },
    { key: "structure", match: ["structure", "structure & semantics", "semantics"] },
    { key: "accessibility", match: ["accessibility"] },
  ];

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  function indexSignals(deliverySignals) {
    const list = asArray(deliverySignals);
    const byKey = new Map();

    for (const sig of list) {
      const id = norm(sig?.id);
      const label = norm(sig?.label);

      for (const spec of ORDER) {
        if (spec.match.includes(id) || spec.match.includes(label)) {
          if (!byKey.has(spec.key)) byKey.set(spec.key, sig);
        }
      }
    }

    return { list, byKey };
  }

  function orderedSignals(deliverySignals) {
    const { list, byKey } = indexSignals(deliverySignals);

    // If we can map all 6 by rule: return in that exact order.
    const out = [];
    for (const spec of ORDER) {
      const s = byKey.get(spec.key);
      if (s) out.push(s);
    }

    // Fill any missing with remaining signals (stable) to avoid gaps.
    if (out.length < list.length) {
      const used = new Set(out);
      for (const s of list) if (!used.has(s)) out.push(s);
    }

    return out;
  }

  // -----------------------------
  // Deterministic 2-line summaries (no AI)
  // -----------------------------
  function summaryTwoLines(signal) {
    const label = String(signal?.label || signal?.id || "Signal");
    const score = asInt(signal?.score, 0);
    const base = asInt(signal?.base_score, score);
    const penalty = Number.isFinite(Number(signal?.penalty_points))
      ? Math.max(0, Math.round(Number(signal.penalty_points)))
      : Math.max(0, base - score);

    const issues = asArray(signal?.issues);
    const deds = asArray(signal?.deductions);

    const line1 = `${verdict(score)} (${score}).`;

    let line2 = "";
    if (penalty > 0) {
      const first = deds.find(d => typeof d?.reason === "string" && d.reason.trim());
      const reason = first ? first.reason.trim() : "Explicit deductions applied from observed checks.";
      line2 = `Deductions: -${penalty}. ${reason}`;
    } else if (issues.length > 0) {
      const first = issues.find(i => typeof i?.title === "string" && i.title.trim());
      line2 = first ? `Issue detected: ${first.title.trim()}` : "Issues detected in deterministic checks.";
    } else {
      line2 = "No penalties. Deterministic checks passed based on observed signals in this scan.";
    }

    // Keep tight
    return { title: label, line1, line2 };
  }

  // -----------------------------
  // Evidence renderer (collapsed)
  // IMPORTANT: don’t spam empty blocks — show a compact message.
  // -----------------------------
  function renderEvidenceBlock(signal) {
    const obs = asArray(signal?.observations);
    const deds = asArray(signal?.deductions);
    const issues = asArray(signal?.issues);

    const hasObs = obs.length > 0;
    const hasDeds = deds.length > 0;
    const hasIssues = issues.length > 0;

    // If literally nothing, still show evidence container (rule),
    // but keep it minimal and honest.
    if (!hasObs && !hasDeds && !hasIssues) {
      return `
        <details>
          <summary>Evidence (click to expand)</summary>
          <div class="small-note" style="margin-top:10px;">
            No evidence objects returned for this signal in the current scan payload.
            If the score exists, the backend should return observations and/or deductions explaining it.
          </div>
        </details>
      `;
    }

    const obsRows = hasObs
      ? obs.map(o => {
          const label = escapeHtml(o?.label ?? "Observation");
          const value = escapeHtml(String(o?.value ?? "null"));
          const src = escapeHtml(String(o?.source ?? ""));
          return `<div style="display:flex;justify-content:space-between;gap:10px;">
            <span style="color:var(--muted);">${label}</span>
            <span title="${src}" style="font-weight:750;">${value}</span>
          </div>`;
        }).join("")
      : `<div class="small-note">No observations returned for this signal.</div>`;

    const dedRows = hasDeds
      ? `<ul style="margin:8px 0 0 18px;padding:0;">
          ${deds.map(d => {
            const reason = escapeHtml(d?.reason ?? "Deduction");
            const pts = escapeHtml(String(d?.points ?? 0));
            const code = escapeHtml(d?.code ?? "");
            return `<li style="margin:6px 0;color:var(--muted);">
              <strong style="color:var(--text);">-${pts}</strong> ${reason}
              ${code ? `<span style="color:var(--muted2);">(${code})</span>` : ""}
            </li>`;
          }).join("")}
        </ul>`
      : `<div class="small-note">No explicit deductions returned for this signal.</div>`;

    const issueBlocks = hasIssues
      ? issues.map(i => {
          const title = escapeHtml(i?.title ?? "Issue");
          const sev = escapeHtml(i?.severity ?? "low");
          const impact = escapeHtml(i?.impact ?? "—");
          const ev = i?.evidence ?? {};
          return `
            <div style="margin-top:10px;padding:12px;border:1px solid var(--border);border-radius:14px;background:var(--panel);">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">
                <div style="font-weight:760;">${title}</div>
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
        }).join("")
      : `<div class="small-note">No issues returned for this signal.</div>`;

    return `
      <details>
        <summary>Evidence (click to expand)</summary>

        <div style="margin-top:10px;font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">
          Observations (inputs)
        </div>
        <div style="margin-top:8px;display:grid;gap:6px;">${obsRows}</div>

        <div style="margin-top:14px;font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">
          Explicit Deductions
        </div>
        ${dedRows}

        <div style="margin-top:14px;font-size:12px;color:var(--muted);letter-spacing:.08em;text-transform:uppercase;">
          Issues (if any)
        </div>
        ${issueBlocks}
      </details>
    `;
  }

  // -----------------------------
  // Delivery Signals (6-card grid)
  // IMPORTANT:
  // - Use "card" (span 6) not "card-wide"
  // - Score: single number only
  // -----------------------------
  function renderSignals(deliverySignals) {
    const grid = $("signalsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const ordered = orderedSignals(deliverySignals);

    if (!ordered.length) {
      grid.innerHTML = `<div class="summary">Contract violation: delivery_signals missing.</div>`;
      return;
    }

    for (const sig of ordered) {
      const score = asInt(sig?.score, 0);
      const { title, line1, line2 } = summaryTwoLines(sig);

      const card = document.createElement("div");
      card.className = "card"; // <-- 6-card grid

      card.innerHTML = `
        <div class="card-top">
          <div>
            <h3>${escapeHtml(title)}</h3>
          </div>
          <div class="score-mini">${score}</div>
        </div>

        <div class="bar"><div style="width:${score}%;"></div></div>

        <div class="summary" style="min-height:unset;">
          <div style="color:var(--text); font-weight:700;">${escapeHtml(line1)}</div>
          <div style="margin-top:6px;">${escapeHtml(line2)}</div>
        </div>

        ${renderEvidenceBlock(sig)}
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
    if (!textEl || !statusEl) return;

    if (lead) {
      textEl.innerHTML = escapeHtml(lead).replaceAll("\n", "<br>");
      statusEl.textContent = "";
      return;
    }

    textEl.textContent = "Narrative not generated — insufficient signal context at this stage.";
    const reason = typeof status.reason === "string" ? status.reason : "";
    statusEl.textContent = reason
      ? `Signal Contract: narrative optional. (${reason})`
      : "Signal Contract: narrative optional.";
  }

  // -----------------------------
  // Key Metrics (unchanged)
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
  // Fix plan
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

      const header = safeObj(data.header);
      const scores = safeObj(data.scores);

      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      renderOverall(scores);
      renderSignals(data.delivery_signals);   // backend provides signals, UI enforces order
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
