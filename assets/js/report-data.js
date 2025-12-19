// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.5 (Locked wiring fix)
// - Keeps scoring + cards exactly as-is
// - Fixes ID mismatches with report.html
// - Evidence accordions rendered using your CSS blocks
// - Narrative supports text OR JSON and polls until available
// - Enforces v5.2 line caps in UI:
//   - Executive narrative max 5 lines
//   - Signal card narrative max 3 lines

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

  // v5.2 UI clamp helper (THIS WAS MISSING — causes the errors)
  function normalizeLines(text, maxLines) {
    const s = String(text ?? "").replace(/\r\n/g, "\n").trim();
    if (!s) return [];
    return s
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, maxLines);
  }

  // -----------------------------
  // Header setters (MATCH report.html IDs)
  // -----------------------------
  function setHeaderWebsite(url) {
    const el = $("siteUrl");
    if (!el) return;
    el.textContent = (typeof url === "string" && url.trim()) ? url.trim() : "—";
  }
  function setHeaderReportId(reportId) {
    const el = $("reportId");
    if (!el) return;
    el.textContent = reportId ? String(reportId) : "—";
  }
  function setHeaderReportDate(isoString) {
    const el = $("reportDate");
    if (!el) return;
    el.textContent = formatDate(isoString);
  }

  // -----------------------------
  // Fetch helpers
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

  async function generateNarrative(reportId) {
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

    if (penalty > 0) {
      const first = deds.find(d => typeof d?.reason === "string" && d.reason.trim());
      const reason = first ? first.reason.trim() : "Explicit deductions applied from observed checks.";
      return { line2: `Deductions: -${penalty}. ${reason}` };
    }

    if (issues.length > 0) {
      const first = issues.find(i => typeof i?.title === "string" && i.title.trim());
      return { line2: first ? `Issue detected: ${first.title.trim()}` : "Issues detected in deterministic checks." };
    }

    return { line2: "No penalties. Deterministic checks passed based on observed signals." };
  }

  // -----------------------------
  // Narrative (display + auto-generate + poll)
  // -----------------------------
  function parseNarrativeFlexible(v) {
    // Accept:
    // - plain string (most common)
    // - { text: "..." }
    // - JSON string
    // - JSON object with overall.lines + signals.*
    if (v == null) return { kind: "empty", text: "" };

    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return { kind: "empty", text: "" };

      // try JSON string
      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try {
          const obj = JSON.parse(s);
          return { kind: "obj", obj };
        } catch {
          // fall through to plain text
        }
      }
      return { kind: "text", text: s };
    }

    if (typeof v === "object") return { kind: "obj", obj: v };

    return { kind: "text", text: String(v) };
  }

  function renderNarrative(narrative) {
    const textEl = $("narrativeText");
    if (!textEl) return false;

    const parsed = parseNarrativeFlexible(narrative);

    // Plain text path (clamp to 5 lines)
    if (parsed.kind === "text") {
      const lines = normalizeLines(parsed.text, 5);
      if (lines.length) {
        textEl.innerHTML = escapeHtml(lines.join("\n")).replaceAll("\n", "<br>");
        return true;
      }
      textEl.textContent = "Narrative not generated yet.";
      return false;
    }

    // Object path (prefer v5.2 overall.lines, clamp to 5)
    if (parsed.kind === "obj") {
      const n = safeObj(parsed.obj);

      const overallLines = asArray(n?.overall?.lines)
        .map(l => String(l || "").trim())
        .filter(Boolean);

      const lines = normalizeLines(overallLines.join("\n"), 5);
      if (lines.length) {
        textEl.innerHTML = escapeHtml(lines.join("\n")).replaceAll("\n", "<br>");
        return true;
      }

      // fallback: { text: "..." } or legacy field
      if (typeof n.text === "string" && n.text.trim()) {
        const tLines = normalizeLines(n.text.trim(), 5);
        if (tLines.length) {
          textEl.innerHTML = escapeHtml(tLines.join("\n")).replaceAll("\n", "<br>");
          return true;
        }
      }
    }

    textEl.textContent = "Narrative not generated yet.";
    return false;
  }

  let narrativeInFlight = false;

  async function pollForNarrative(reportId, maxMs = 60000, intervalMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < maxMs) {
      const refreshed = await fetchReportData(reportId).catch(() => null);
      if (refreshed && renderNarrative(refreshed?.narrative)) return true;
      await new Promise(r => setTimeout(r, intervalMs));
    }
    return false;
  }

  async function ensureNarrative(reportId, currentNarrative) {
    const textEl = $("narrativeText");
    if (!textEl) return;

    // already present → done
    if (renderNarrative(currentNarrative)) return;

    // prevent repeats this session (per report)
    const key = `iqweb_narrative_requested_${reportId}`;
    if (sessionStorage.getItem(key) === "1") return;
    sessionStorage.setItem(key, "1");

    if (narrativeInFlight) return;
    narrativeInFlight = true;

    textEl.textContent = "Generating narrative…";

    try {
      await generateNarrative(reportId);

      // Poll until narrative actually exists in get-report-data
      const ok = await pollForNarrative(reportId);
      if (!ok) {
        textEl.textContent = "Narrative still generating. Refresh in a moment.";
      }
    } catch (e) {
      console.error(e);
      textEl.textContent = `Narrative generation failed: ${e?.message || String(e)}`;
    } finally {
      narrativeInFlight = false;
    }
  }

  // -----------------------------
  // Delivery Signals — six clean cards
  // Style fix:
  // - Score sits TOP-RIGHT (not mid-card)
  // - Narrative starts higher (less dead space)
  // - Layout: Title + Score (top row) → Bar → Narrative
  // -----------------------------
  function renderSignals(deliverySignals, narrative) {
    const grid = $("signalsGrid");
    if (!grid) return;
    grid.innerHTML = "";

    const list = asArray(deliverySignals);
    if (!list.length) {
      grid.innerHTML = `<div class="summary">Contract violation: delivery_signals missing.</div>`;
      return;
    }

    const parsedNarr = parseNarrativeFlexible(narrative);
    const narrObj = parsedNarr.kind === "obj" ? safeObj(parsedNarr.obj) : {};
    const narrSignals = safeObj(narrObj?.signals);

    // Map delivery signal ids → narrative keys
    const keyFromSig = (sig) => {
      const id = String(sig?.id || "").toLowerCase();
      if (id.includes("perf")) return "performance";
      if (id.includes("seo")) return "seo";
      if (id.includes("struct")) return "structure";
      if (id.includes("mob")) return "mobile";
      if (id.includes("sec")) return "security";
      if (id.includes("access")) return "accessibility";
      return id || null;
    };

    for (const sig of list) {
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);

      const key = keyFromSig(sig);
      const rawLines = asArray(narrSignals?.[key]?.lines)
        .map(l => String(l || "").trim())
        .filter(Boolean);

      // Card line cap: max 3
      const cardLines = normalizeLines(rawLines.join("\n"), 3);

      // Fallback (if no narrative yet)
      const fallback = summaryTwoLines(sig)?.line2 || "—";
      const bodyText = cardLines.length ? cardLines.join("\n") : fallback;

      const card = document.createElement("div");
      card.className = "card";

      // Score top-right + narrative starts higher
      card.innerHTML = `
        <div class="card-top" style="align-items:flex-start;">
          <div style="width:100%;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
              <h3 style="margin:0; padding:0;">${escapeHtml(label)}</h3>
              <div class="score-right" style="margin-top:2px;">${escapeHtml(String(score))}</div>
            </div>

            <div class="bar" style="margin-top:10px;">
              <div style="width:${score}%;"></div>
            </div>
          </div>
        </div>

        <div class="summary" style="min-height:unset; margin-top:10px;">
          ${escapeHtml(bodyText).replaceAll("\n", "<br>")}
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
  // Signal Evidence section (dropdowns styled to match your CSS)
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

    for (let i = 0; i < list.length; i++) {
      const sig = list[i];
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);

      let obs = asArray(sig?.observations);
      if (!obs.length) obs = evidenceToObs(sig?.evidence);

      const block = document.createElement("details");
      block.className = "evidence-block";
      if (i === 0) block.open = true;

      const summary = document.createElement("summary");
      summary.innerHTML = `
        <span class="acc-title">${escapeHtml(label)}</span>
        <span class="acc-score">${escapeHtml(String(score))}</span>
      `;

      const body = document.createElement("div");
      body.className = "acc-body";

      const title = document.createElement("div");
      title.className = "evidence-title";
      title.textContent = "Observations";

      const listEl = document.createElement("div");
      listEl.className = "evidence-list";

      if (obs.length) {
        for (const o of obs.slice(0, 24)) {
          const kv = document.createElement("div");
          kv.className = "kv";
          kv.innerHTML = `
            <div class="k">${escapeHtml(o?.label ?? "Observation")}</div>
            <div class="v">${escapeHtml(String(o?.value ?? "null"))}</div>
          `;
          listEl.appendChild(kv);
        }
      } else {
        const none = document.createElement("div");
        none.className = "summary";
        none.textContent = "No observations recorded.";
        body.appendChild(none);
      }

      // Issues (compact, but still visible)
      const issues = asArray(sig?.issues);
      const issuesTitle = document.createElement("div");
      issuesTitle.className = "evidence-title";
      issuesTitle.style.marginTop = "14px";
      issuesTitle.textContent = "Issues";

      const issuesBox = document.createElement("div");
      if (!issues.length) {
        issuesBox.className = "summary";
        issuesBox.textContent = "No issues detected for this signal.";
      } else {
        issuesBox.innerHTML = issues.slice(0, 6).map(it => {
          const t = escapeHtml(it?.title ?? "Issue");
          const sev = escapeHtml(it?.severity ?? "low");
          const impact = escapeHtml(it?.impact ?? "—");
          return `
            <div class="kv" style="flex-direction:column; align-items:flex-start;">
              <div style="display:flex; width:100%; justify-content:space-between; gap:10px;">
                <div style="font-weight:800;color:var(--ink);">${t}</div>
                <div style="font-weight:800;opacity:.85;">${sev}</div>
              </div>
              <div class="k" style="text-transform:none; letter-spacing:0;">Impact: <span class="v" style="font-weight:700;">${impact}</span></div>
            </div>
          `;
        }).join("");
      }

      body.appendChild(title);
      body.appendChild(listEl);
      body.appendChild(issuesTitle);
      body.appendChild(issuesBox);

      block.appendChild(summary);
      block.appendChild(body);
      root.appendChild(block);
    }
  }

  // -----------------------------
  // Key Metrics (FIX ID: keyMetricsRoot)
  // -----------------------------
  function renderMetrics(keyMetrics) {
    const root = $("keyMetricsRoot");
    if (!root) return;
    root.innerHTML = "";

    const km = safeObj(keyMetrics);
    const http = safeObj(km.http);
    const page = safeObj(km.page);
    const content = safeObj(km.content);
    const freshness = safeObj(km.freshness);
    const sec = safeObj(km.security);

    root.innerHTML = `
      <details class="evidence-block" open>
        <summary><span class="acc-title">HTTP & Page Basics</span><span class="acc-score">+</span></summary>
        <div class="acc-body">
          <div class="evidence-list">
            <div class="kv"><div class="k">Status</div><div class="v">${escapeHtml(http.status ?? "—")}</div></div>
            <div class="kv"><div class="k">Content-Type</div><div class="v">${escapeHtml(http.content_type ?? "—")}</div></div>
            <div class="kv"><div class="k">Final URL</div><div class="v">${escapeHtml(http.final_url ?? "—")}</div></div>

            <div class="kv"><div class="k">Title Present</div><div class="v">${escapeHtml(page.title_present ?? "—")}</div></div>
            <div class="kv"><div class="k">Canonical Present</div><div class="v">${escapeHtml(page.canonical_present ?? "—")}</div></div>
            <div class="kv"><div class="k">H1 Present</div><div class="v">${escapeHtml(page.h1_present ?? "—")}</div></div>
            <div class="kv"><div class="k">Viewport Present</div><div class="v">${escapeHtml(page.viewport_present ?? "—")}</div></div>

            <div class="kv"><div class="k">HTML Bytes</div><div class="v">${escapeHtml(content.html_bytes ?? "—")}</div></div>
            <div class="kv"><div class="k">Images</div><div class="v">${escapeHtml(content.img_count ?? "—")}</div></div>
            <div class="kv"><div class="k">Images w/ ALT</div><div class="v">${escapeHtml(content.img_alt_count ?? "—")}</div></div>
          </div>
          <div class="summary" style="margin-top:10px;">${escapeHtml(prettyJSON({ http, page, content }))}</div>
        </div>
      </details>

      <details class="evidence-block">
        <summary><span class="acc-title">Freshness Signals</span><span class="acc-score">+</span></summary>
        <div class="acc-body">
          <div class="evidence-list">
            <div class="kv"><div class="k">Last-Modified Present</div><div class="v">${escapeHtml(freshness.last_modified_header_present ?? "—")}</div></div>
            <div class="kv"><div class="k">Last-Modified Value</div><div class="v">${escapeHtml(freshness.last_modified_header_value ?? "—")}</div></div>
            <div class="kv"><div class="k">Copyright</div><div class="v">${escapeHtml((freshness.copyright_year_min ?? "—") + "–" + (freshness.copyright_year_max ?? "—"))}</div></div>
          </div>
          <div class="summary" style="margin-top:10px;">${escapeHtml(prettyJSON(freshness))}</div>
        </div>
      </details>

      <details class="evidence-block">
        <summary><span class="acc-title">Security Headers Snapshot</span><span class="acc-score">+</span></summary>
        <div class="acc-body">
          <div class="evidence-list">
            <div class="kv"><div class="k">HTTPS</div><div class="v">${escapeHtml(sec.https ?? "—")}</div></div>
            <div class="kv"><div class="k">HSTS</div><div class="v">${escapeHtml(sec.hsts_present ?? "—")}</div></div>
            <div class="kv"><div class="k">CSP</div><div class="v">${escapeHtml(sec.csp_present ?? "—")}</div></div>
            <div class="kv"><div class="k">X-Frame-Options</div><div class="v">${escapeHtml(sec.x_frame_options_present ?? "—")}</div></div>
            <div class="kv"><div class="k">X-Content-Type-Options</div><div class="v">${escapeHtml(sec.x_content_type_options_present ?? "—")}</div></div>
            <div class="kv"><div class="k">Referrer-Policy</div><div class="v">${escapeHtml(sec.referrer_policy_present ?? "—")}</div></div>
          </div>
          <div class="summary" style="margin-top:10px;">${escapeHtml(prettyJSON(sec))}</div>
        </div>
      </details>
    `;

    // Make the +/- indicator correct
    root.querySelectorAll("details.evidence-block").forEach(d => {
      const s = d.querySelector("summary .acc-score");
      if (!s) return;
      const set = () => { s.textContent = d.open ? "−" : "+"; };
      set();
      d.addEventListener("toggle", set);
    });
  }

  // -----------------------------
  // Main
  // -----------------------------
  async function main() {
    const loaderSection = $("loaderSection");
    const reportRoot = $("reportRoot");
    const statusEl = $("loaderStatus");

    const reportId = getReportIdFromUrl();
    if (!reportId) {
      if (statusEl) statusEl.textContent = "Missing report_id in URL. Example: report.html?report_id=WEB-XXXX";
      return;
    }

    try {
      if (statusEl) statusEl.textContent = "Fetching report payload…";
      const data = await fetchReportData(reportId);

      const header = safeObj(data.header);
      const scores = safeObj(data.scores);

      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      renderOverall(scores);

      // Narrative first (exec lead)
      renderNarrative(data.narrative);

      // Cards: narrative first, score second (clamped)
      renderSignals(data.delivery_signals, data.narrative);

      // Evidence + Metrics
      renderSignalEvidence(data.delivery_signals);
      renderMetrics(data.key_metrics);

      if (loaderSection) loaderSection.style.display = "none";
      if (reportRoot) reportRoot.style.display = "block";

      // non-blocking auto-generate AFTER report visible
      ensureNarrative(header.report_id || reportId, data.narrative);
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = `Failed to load report data: ${err?.message || String(err)}`;
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
