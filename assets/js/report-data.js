// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.3 (LOCKED)
// - Six-card grid (3×2 desktop; responsive fallback)
// - Score shown ONCE (right side only)
// - No evidence expanders inside cards
// - Evidence rendered in dedicated "Signal Evidence" section below
// - Narrative optional; never blocks render

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
  // Narrative generator call
  // -----------------------------
  async function requestNarrative(reportId) {
    const res = await fetch("/.netlify/functions/generate-narrative", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ report_id: reportId }),
    });

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

  function wireGenerateNarrative(reportId) {
    const btn = $("btnGenerateNarrative");
    const statusEl = $("narrativeStatus");
    const textEl = $("narrativeText");
    if (!btn || !statusEl || !textEl) return;

    btn.addEventListener("click", async () => {
      try {
        btn.disabled = true;
        statusEl.textContent = "Generating narrative…";
        // call function (writes to scan_results.narrative)
        await requestNarrative(reportId);

        statusEl.textContent = "Saved. Refreshing report narrative…";
        // re-fetch just to pull the saved narrative back
        const fresh = await fetchReportData(reportId);
        renderNarrative(fresh?.narrative);

        statusEl.textContent = "";
      } catch (err) {
        statusEl.textContent = `Narrative failed: ${err?.message || String(err)}`;
      } finally {
        btn.disabled = false;
      }
    });
  }

  // -----------------------------
  // Overall
  // -----------------------------
  function renderOverall(scores) {
    const overall = asInt(scores?.overall, 0);

    const pill = $("overallPill");
    if (pill) pill.textContent = String(overall);

    const bar = $("overallBar");
    if (bar) bar.style.width = `${overall}%`;

    const note = $("overallNote");
    if (note) {
      note.textContent =
        `Overall delivery is ${verdict(overall).toLowerCase()}. ` +
        `This score reflects deterministic checks only and does not measure brand or content effectiveness.`;
    }
  }

  // -----------------------------
  // Two-line deterministic summary (compact)
  // -----------------------------
  function summaryTwoLines(signal) {
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
      line2 = "No penalties. Deterministic checks passed based on observed signals.";
    }

    return { line1, line2 };
  }

  // -----------------------------
  // Delivery Signals — six clean cards (NO expanders)
  // -----------------------------
  function renderSignals(deliverySignals) {
    const grid = $("signalsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const list = asArray(deliverySignals);
    if (!list.length) {
      grid.innerHTML = `<div class="summary">Contract violation: delivery_signals missing.</div>`;
      return;
    }

    for (const sig of list) {
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);
      const { line2 } = summaryTwoLines(sig);

      const card = document.createElement("div");
      card.className = "card";

      card.innerHTML = `
        <div class="card-top">
          <h3>${escapeHtml(label)}</h3>
          <div class="score-right">${escapeHtml(String(score))}</div>
        </div>

        <div class="bar"><div style="width:${score}%;"></div></div>

        <div class="summary" style="min-height:unset;">
          <div style="margin-top:6px;">
            ${escapeHtml(line2)}
          </div>
        </div>
      `;

      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Evidence fallback: if observations missing, derive from evidence object
  // -----------------------------
  function prettifyKey(k) {
    return String(k || "")
      .replace(/_/g, " ")
      .replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function evidenceToObs(evidence) {
    const ev = safeObj(evidence);
    const entries = Object.entries(ev);
    if (!entries.length) return [];

    const priority = [
      "title_present",
      "meta_description_present",
      "canonical_present",
      "canonical_matches_url",
      "h1_present",
      "h1_count",
      "viewport_present",
      "device_width_present",
      "https",
      "hsts",
      "content_security_policy",
      "x_frame_options",
      "x_content_type_options",
      "referrer_policy",
      "permissions_policy",
      "img_count",
      "img_alt_count",
      "alt_ratio",
      "html_bytes",
      "inline_script_count",
      "head_script_block_present",
    ];

    const ranked = entries.sort((a, b) => {
      const ai = priority.indexOf(a[0]);
      const bi = priority.indexOf(b[0]);
      const ar = ai === -1 ? 999 : ai;
      const br = bi === -1 ? 999 : bi;
      if (ar !== br) return ar - br;
      return String(a[0]).localeCompare(String(b[0]));
    });

    return ranked.map(([key, value]) => ({
      label: prettifyKey(key),
      value: value === undefined ? null : value,
      source: "evidence",
    }));
  }

  // -----------------------------
  // Signal Evidence section (separate from cards)
  // -----------------------------
  function renderSignalEvidence(deliverySignals) {
    const root = $("signalEvidenceRoot");
    if (!root) return;
    root.innerHTML = "";

    const list = asArray(deliverySignals);
    if (!list.length) {
      root.innerHTML = `<div class="summary">No signal evidence available (delivery_signals missing).</div>`;
      return;
    }

    const blocks = list.map(sig => {
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);

      let obs = asArray(sig?.observations);
      if (!obs.length) {
        obs = evidenceToObs(sig?.evidence);
      }

      const deds = asArray(sig?.deductions);
      const issues = asArray(sig?.issues);

      const obsRows = obs.length
        ? obs.map(o => {
            const k = escapeHtml(o?.label ?? "Observation");
            const v = escapeHtml(String(o?.value ?? "null"));
            const src = escapeHtml(String(o?.source ?? ""));
            return `<div style="display:flex;justify-content:space-between;gap:10px;">
              <span style="color:var(--muted);">${k}</span>
              <span title="${src}" style="font-weight:750;">${v}</span>
            </div>`;
          }).join("")
        : `<div class="small-note">No observations recorded.</div>`;

      const dedRows = deds.length
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
        : `<div class="small-note">No deductions applied.</div>`;

      const issueBlocks = issues.length
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
        : `<div class="small-note">No issues detected for this signal.</div>`;

      return `
        <details>
          <summary>${escapeHtml(label)} — ${escapeHtml(String(score))}</summary>

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
    }).join("");

    root.innerHTML = blocks;
  }

  // -----------------------------
  // Narrative (optional)
  // Supports BOTH:
  // - legacy: { executive_lead: "..." }
  // - v5.2:   { overall: { lines: [...] }, signals: {...} }
  // -----------------------------
  function renderNarrative(narrative) {
    const n = safeObj(narrative);

    const textEl = $("narrativeText");
    const statusEl = $("narrativeStatus");
    if (!textEl || !statusEl) return;

    // legacy
    const lead = typeof n.executive_lead === "string" ? n.executive_lead.trim() : "";
    if (lead) {
      textEl.innerHTML = escapeHtml(lead).replaceAll("\n", "<br>");
      statusEl.textContent = "";
      return;
    }

    // v5.2
    const overallLines = asArray(n?.overall?.lines).map(l => String(l || "").trim()).filter(Boolean);
    if (overallLines.length) {
      textEl.innerHTML = escapeHtml(overallLines.join("\n")).replaceAll("\n", "<br>");
      statusEl.textContent = "";
      return;
    }

    // fallback
    textEl.textContent = "Narrative not generated yet.";
    statusEl.textContent = "Click “Generate Narrative” to create the Λ i Q narrative for this report.";
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
      renderSignals(data.delivery_signals);
      renderSignalEvidence(data.delivery_signals);
      renderNarrative(data.narrative);
      renderMetrics(data.key_metrics);
      renderFindings(data.findings);
      renderFixPlan(data.fix_plan);

      // ✅ wire button AFTER elements exist + we have reportId
      wireGenerateNarrative(reportId);

      loaderSection.style.display = "none";
      reportRoot.style.display = "block";
    } catch (err) {
      console.error(err);
      statusEl.textContent = `Failed to load report data: ${err?.message || String(err)}`;
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
function wireGenerateNarrative(reportId) {
  const btn = document.getElementById("btnGenerateNarrative");
  const status = document.getElementById("narrativeStatus");

  if (!btn) return;

  btn.addEventListener("click", async () => {
    try {
      btn.disabled = true;
      if (status) status.textContent = "Generating narrative…";

      const res = await fetch("/.netlify/functions/generate-narrative", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });

      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch {}

      if (!res.ok || data?.success === false) {
        throw new Error(data?.error || text || "Narrative generation failed");
      }

      if (status) status.textContent = "Narrative generated. Reloading…";
      window.location.reload();
    } catch (err) {
      console.error(err);
      if (status) status.textContent = err.message || "Narrative failed";
    } finally {
      btn.disabled = false;
    }
  });
}
