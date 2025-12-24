// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.8 (DocRaptor-safe transport + PDF ready signalling)
//
// Key fix:
// - DocRaptor/Prince often does NOT support window.fetch reliably.
// - This file uses fetch when available, but falls back to XMLHttpRequest for PDF rendering.
// - Prevents "Building Report" PDFs by ensuring data load works in Prince.

window.__IQWEB_REPORT_READY ??= false;

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

  function formatDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    });
  }

  function verdict(score) {
    const n = asInt(score, 0);
    if (n >= 90) return "Strong";
    if (n >= 75) return "Good";
    if (n >= 55) return "Needs work";
    return "Needs attention";
  }

  function normalizeLines(text, maxLines) {
    const s = String(text ?? "").replace(/\r\n/g, "\n").trim();
    if (!s) return [];
    return s.split("\n").map(l => l.trim()).filter(Boolean).slice(0, maxLines);
  }

  function stripAuthorityLineIfPresent(lines) {
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
      const s = String(lines[i] || "").trim();
      const low = s.toLowerCase();
      if (
        i === 2 &&
        (low === "no action required." ||
          low === "no action required at this time." ||
          low === "no action required" ||
          low === "no immediate fixes are required in this area." ||
          low === "no issues to address in this area." ||
          low === "no improvements needed in this area.")
      ) continue;
      cleaned.push(s);
    }
    return cleaned.filter(Boolean);
  }

  // -----------------------------
  // Header setters (MATCH report.html IDs)
  // -----------------------------
  function setHeaderWebsite(url) {
    const el = $("siteUrl");
    if (!el) return;

    if (typeof url === "string" && url.trim()) {
      const u = url.trim();
      el.textContent = u;
      el.setAttribute("href", u.startsWith("http") ? u : `https://${u}`);
    } else {
      el.textContent = "—";
      el.removeAttribute("href");
    }
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
  // URL helpers
  // -----------------------------
  function getReportIdFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("report_id") || params.get("id") || "";
  }

  // -----------------------------
  // Transport (fetch + XHR fallback for DocRaptor/Prince)
  // -----------------------------
  function canUseFetch() {
    try { return typeof fetch === "function"; } catch { return false; }
  }

  function xhrRequest(method, url, bodyObj) {
    return new Promise((resolve, reject) => {
      try {
        const xhr = new XMLHttpRequest();
        xhr.open(method, url, true);
        xhr.setRequestHeader("Accept", "application/json");
        if (method !== "GET") xhr.setRequestHeader("Content-Type", "application/json");

        xhr.onreadystatechange = () => {
          if (xhr.readyState !== 4) return;
          const text = xhr.responseText || "";
          let data = null;
          try { data = JSON.parse(text); } catch { /* ignore */ }

          if (xhr.status < 200 || xhr.status >= 300) {
            const msg = (data && (data.detail || data.error)) || text || `HTTP ${xhr.status}`;
            reject(new Error(msg));
            return;
          }
          if (data && data.success === false) {
            const msg = data.detail || data.error || "Unknown error";
            reject(new Error(msg));
            return;
          }
          resolve(data);
        };

        xhr.onerror = () => reject(new Error("Network error"));
        xhr.send(method === "GET" ? null : JSON.stringify(bodyObj || {}));
      } catch (e) {
        reject(e);
      }
    });
  }

  async function httpJson(method, url, bodyObj) {
    if (canUseFetch()) {
      const opts = { method, headers: { "Accept": "application/json" } };
      if (method !== "GET") {
        opts.headers["Content-Type"] = "application/json";
        opts.body = JSON.stringify(bodyObj || {});
      }
      const res = await fetch(url, opts);
      const text = await res.text().catch(() => "");
      let data = null;
      try { data = JSON.parse(text); } catch { /* ignore */ }

      if (!res.ok) {
        const msg = (data && (data.detail || data.error)) || text || `HTTP ${res.status}`;
        throw new Error(msg);
      }
      if (data && data.success === false) {
        const msg = data.detail || data.error || "Unknown error";
        throw new Error(msg);
      }
      return data;
    }

    // DocRaptor/Prince fallback
    return xhrRequest(method, url, bodyObj);
  }

  async function fetchReportData(reportId) {
    const qs = new URLSearchParams(window.location.search);
    const isPdf = qs.get("pdf") === "1";

    if (isPdf) {
      const token = qs.get("pdf_token") || "";
      const url =
        `/.netlify/functions/get-report-data-pdf?report_id=${encodeURIComponent(reportId)}` +
        `&pdf_token=${encodeURIComponent(token)}`;

      if (!token) {
        throw new Error("Missing pdf_token (PDF mode).");
      }

      return httpJson("GET", url);
    }

    const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
    return httpJson("GET", url);
  }

  async function generateNarrative(reportId) {
    return httpJson("POST", "/.netlify/functions/generate-narrative", { report_id: reportId });
  }

  function wireBackToDashboard() {
    const btn = document.getElementById("backToDashboard");
    if (!btn) return;
    btn.addEventListener("click", () => { window.location.href = "/dashboard.html"; });
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
  // Deterministic fallback
  // -----------------------------
  function summaryFallback(sig) {
    const score = asInt(sig?.score, 0);
    const label = String(sig?.label ?? sig?.id ?? "This signal");
    const base = `${label} is measured at ${score}/100 from deterministic checks in this scan.`;
    const issues = asArray(sig?.issues);

    if (issues.length) {
      const first = issues.find(i => typeof i?.title === "string" && i.title.trim());
      if (first) return `${base}\nObserved: ${first.title.trim()}`;
      return `${base}\nObserved issues were detected in deterministic checks.`;
    }
    return `${base}\nUse the evidence below to decide what to prioritise.`;
  }

  // -----------------------------
  // Narrative
  // -----------------------------
  function parseNarrativeFlexible(v) {
    if (v == null) return { kind: "empty", text: "" };

    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return { kind: "empty", text: "" };

      if ((s.startsWith("{") && s.endsWith("}")) || (s.startsWith("[") && s.endsWith("]"))) {
        try { return { kind: "obj", obj: JSON.parse(s) }; } catch { /* ignore */ }
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

    if (parsed.kind === "text") {
      const lines = normalizeLines(parsed.text, 5);
      if (lines.length) {
        textEl.innerHTML = escapeHtml(lines.join("\n")).replaceAll("\n", "<br>");
        return true;
      }
      textEl.textContent = "Narrative not generated yet.";
      return false;
    }

    if (parsed.kind === "obj") {
      const n = safeObj(parsed.obj);

      const overallLines = asArray(n?.overall?.lines).map(l => String(l || "").trim()).filter(Boolean);
      const lines = normalizeLines(overallLines.join("\n"), 5);
      if (lines.length) {
        textEl.innerHTML = escapeHtml(lines.join("\n")).replaceAll("\n", "<br>");
        return true;
      }

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

    if (renderNarrative(currentNarrative)) return;

    const key = `iqweb_narrative_requested_${reportId}`;
    try {
      if (typeof sessionStorage !== "undefined") {
        if (sessionStorage.getItem(key) === "1") return;
        sessionStorage.setItem(key, "1");
      }
    } catch (_) {}

    if (narrativeInFlight) return;
    narrativeInFlight = true;

    textEl.textContent = "Generating narrative…";

    try {
      await generateNarrative(reportId);
      const ok = await pollForNarrative(reportId);
      if (!ok) textEl.textContent = "Narrative still generating. Refresh in a moment.";
    } catch (e) {
      console.error(e);
      textEl.textContent = `Narrative generation failed: ${e?.message || String(e)}`;
    } finally {
      narrativeInFlight = false;
    }
  }

  // -----------------------------
  // PDF gating (FINAL – DO NOT TOUCH)
  // -----------------------------
  function expandEvidenceForPDF() {
    try {
      document
        .querySelectorAll("details.evidence-block")
        .forEach(d => d.open = true);
    } catch (_) {}
  }

  async function waitForPdfReady() {
    try {
      // Ensure everything visible is expanded
      expandEvidenceForPDF();

      // Give Prince one layout frame
      await new Promise(r => setTimeout(r, 350));
    } finally {
      // IMPORTANT:
      // - Set the wait flag for DocRaptor "javascript_wait_function"
      // - ALSO call docraptorJavaScriptFinished (safe no-op if not defined)
      window.__IQWEB_REPORT_READY = true;

      try {
        if (typeof window.docraptorJavaScriptFinished === "function") {
          window.docraptorJavaScriptFinished();
        }
      } catch (_) {}
    }
  }

  // -----------------------------
  // Delivery Signals
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

    const narrSignals =
      safeObj(narrObj?.signals) ||
      safeObj(narrObj?.delivery_signals) ||
      safeObj(narrObj?.deliverySignals) ||
      {};

    const keyFromSig = (sig) => {
      const id = String(sig?.id || sig?.label || "").toLowerCase();
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("structure") || id.includes("semantic")) return "structure";
      if (id.includes("sec") || id.includes("trust")) return "security";
      if (id.includes("access")) return "accessibility";
      return id.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || null;
    };

    for (const sig of list) {
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);

      const key = keyFromSig(sig);
      const rawLines = key
        ? asArray(narrSignals?.[key]?.lines).map(l => String(l || "").trim()).filter(Boolean)
        : [];

      const cardLines = normalizeLines(rawLines.join("\n"), 3);
      const safeLines = stripAuthorityLineIfPresent(cardLines);

      const bodyText = safeLines.length ? safeLines.join("\n") : summaryFallback(sig);

      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `
        <div class="card-top">
          <h3>${escapeHtml(label)}</h3>
          <div class="score-right">${escapeHtml(String(score))}</div>
        </div>
        <div class="bar"><div style="width:${score}%;"></div></div>
        <div class="summary" style="min-height:unset;">
          ${escapeHtml(bodyText).replaceAll("\n", "<br>")}
        </div>
      `;
      grid.appendChild(card);
    }
  }

  // -----------------------------
  // Evidence fallback + evidence section
  // -----------------------------
  function prettifyKey(k) {
    return String(k || "").replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function evidenceToObs(evidence) {
    const ev = safeObj(evidence);
    const entries = Object.entries(ev);
    if (!entries.length) return [];

    const priority = [
      "title_present","meta_description_present","canonical_present","canonical_matches_url",
      "h1_present","h1_count","viewport_present","device_width_present",
      "https","hsts","content_security_policy","x_frame_options","x_content_type_options",
      "referrer_policy","permissions_policy",
      "img_count","img_alt_count","alt_ratio","html_bytes","inline_script_count","head_script_block_present",
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

  function renderSignalEvidence(deliverySignals) {
    const root = $("signalEvidenceRoot");
    if (!root) return;
    root.innerHTML = "";

    const list = asArray(deliverySignals);
    if (!list.length) {
      root.innerHTML = `<div class="summary">No signal evidence available (delivery_signals missing).</div>`;
      return;
    }

    for (const sig of list) {
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);

      let obs = asArray(sig?.observations);
      if (!obs.length) obs = evidenceToObs(sig?.evidence);

      const block = document.createElement("details");
      block.className = "evidence-block";

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
          const value =
            o?.value === null ? "null" :
            o?.value === undefined ? "—" :
            String(o.value);

          kv.innerHTML = `
            <div class="k">${escapeHtml(o?.label ?? "Observation")}</div>
            <div class="v">${escapeHtml(value)}</div>
          `;
          listEl.appendChild(kv);
        }
      } else {
        const none = document.createElement("div");
        none.className = "summary";
        none.textContent = "No observations recorded.";
        body.appendChild(none);
      }

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
              <div class="k" style="text-transform:none; letter-spacing:0;">Impact: <span class="impact-text" style="font-weight:700;">${impact}</span></div>
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
  // Key insights / issues / fix sequence / notes
  // (kept identical behaviour to your v1.0.7)
  // -----------------------------
  function keyFromLabelOrId(sig) {
    const id = String(sig?.id || sig?.label || "").toLowerCase();
    if (id.includes("perf")) return "performance";
    if (id.includes("seo")) return "seo";
    if (id.includes("struct") || id.includes("semantic")) return "structure";
    if (id.includes("mob")) return "mobile";
    if (id.includes("sec") || id.includes("trust")) return "security";
    if (id.includes("access")) return "accessibility";
    return "";
  }

  function renderKeyInsights(scores, deliverySignals, narrative) {
    const root = $("keyMetricsRoot");
    if (!root) return;

    const overall = asInt(scores?.overall, 0);
    const list = asArray(deliverySignals);

    const parsedNarr = parseNarrativeFlexible(narrative);
    const narrObj = parsedNarr.kind === "obj" ? safeObj(parsedNarr.obj) : {};
    const narrSignals =
      safeObj(narrObj?.signals) ||
      safeObj(narrObj?.delivery_signals) ||
      safeObj(narrObj?.deliverySignals) ||
      {};

    const scoreBy = {};
    for (const sig of list) {
      const k = keyFromLabelOrId(sig);
      if (!k) continue;
      scoreBy[k] = asInt(sig?.score, 0);
    }

    const signalScores = Object.entries(scoreBy).sort((a, b) => a[1] - b[1]);
    const weakest = signalScores[0]?.[0];
    const strongest = signalScores[signalScores.length - 1]?.[0];

    function narrativeOneLineForSignal(key) {
      const rawLines = asArray(narrSignals?.[key]?.lines)
        .map(l => String(l || "").trim())
        .filter(Boolean);
      const lines = normalizeLines(rawLines.join("\n"), 1);
      return lines[0] || "";
    }

    function fallbackLine(label, key) {
      const s = Number.isFinite(scoreBy[key]) ? scoreBy[key] : null;
      if (s === null) return `${label} insight not available from this scan output.`;
      if (s >= 90) return `${label} appears strong in this scan.`;
      if (s >= 75) return `${label} appears generally good, with room for improvement.`;
      if (s >= 55) return `${label} shows gaps worth reviewing.`;
      return `${label} shows the largest improvement potential in this scan.`;
    }

    const strengthKey = strongest || "mobile";
    const riskKey = weakest || "security";

    const strengthText = narrativeOneLineForSignal(strengthKey) || fallbackLine("Strength", strengthKey);
    const riskText = narrativeOneLineForSignal(riskKey) || fallbackLine("Risk", riskKey);

    const focusText =
      weakest ? `Focus: ${prettifyKey(weakest)} is the lowest scoring area in this scan.`
             : `Focus: address the lowest scoring signal areas first for highest leverage.`;

    const nextText =
      overall >= 75
        ? "Next: apply the changes you choose, then re-run the scan to confirm measurable improvement."
        : "Next: start with Phase 1 fast wins, then re-run the scan to confirm measurable improvement.";

    root.innerHTML = `
      <div class="insight-list">
        <div class="insight"><div class="tag">Strength</div><div class="text">${escapeHtml(strengthText)}</div></div>
        <div class="insight"><div class="tag">Risk</div><div class="text">${escapeHtml(riskText)}</div></div>
        <div class="insight"><div class="tag">Focus</div><div class="text">${escapeHtml(focusText)}</div></div>
        <div class="insight"><div class="tag">Next</div><div class="text">${escapeHtml(nextText)}</div></div>
      </div>
    `;
  }

  function softImpactLabel(severity) {
    const s = String(severity || "").toLowerCase();
    if (s.includes("high") || s.includes("critical")) return "High leverage";
    if (s.includes("med") || s.includes("warn")) return "Worth addressing";
    return "Monitor";
  }

  function renderTopIssues(deliverySignals) {
    const root = $("topIssuesRoot");
    if (!root) return;
    root.innerHTML = "";

    const list = asArray(deliverySignals);
    const all = [];

    for (const sig of list) {
      const issues = asArray(sig?.issues);
      for (const it of issues) {
        all.push({
          title: String(it?.title || "Issue").trim() || "Issue",
          why: String(it?.impact || it?.description || "This can affect real user delivery and measurable performance.").trim(),
          severity: it?.severity || "low",
        });
      }
    }

    if (!all.length) {
      root.innerHTML = `
        <div class="issue">
          <div class="issue-top">
            <p class="issue-title">No issue list available from this scan output yet</p>
            <span class="issue-label">Monitor</span>
          </div>
          <div class="issue-why">
            This section summarises the highest-leverage issues detected from the evidence captured during this scan.
          </div>
        </div>
      `;
      return;
    }

    const seen = new Set();
    const unique = [];
    for (const it of all) {
      const key = it.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(it);
      if (unique.length >= 10) break;
    }

    root.innerHTML = unique.map(it => {
      const label = softImpactLabel(it.severity);
      return `
        <div class="issue">
          <div class="issue-top">
            <p class="issue-title">${escapeHtml(it.title)}</p>
            <span class="issue-label">${escapeHtml(label)}</span>
          </div>
          <div class="issue-why">${escapeHtml(it.why)}</div>
        </div>
      `;
    }).join("");
  }

  function renderFixSequence(scores, deliverySignals) {
    const root = $("fixSequenceRoot");
    if (!root) return;

    const list = asArray(deliverySignals);
    const scorePairs = list
      .map(s => ({
        key: keyFromLabelOrId(s),
        label: String(s?.label ?? s?.id ?? "Signal"),
        score: asInt(s?.score, 0),
      }))
      .filter(x => x.key);

    scorePairs.sort((a, b) => a.score - b.score);
    const low = scorePairs.slice(0, 2).map(x => x.label);

    root.innerHTML = `
      <div class="summary">
        Suggested order (from this scan): start with <b>${escapeHtml(low.join(" + ") || "highest-leverage fixes")}</b>, then re-run the scan to confirm measurable improvement.
      </div>
    `;
  }

  function renderFinalNotes() {
    const root = $("finalNotesRoot");
    if (!root) return;
    if ((root.textContent || "").trim().length > 30) return;

    root.innerHTML = `
      <div class="summary">
        This report is a diagnostic snapshot based on measurable signals captured during this scan. Where iQWEB cannot measure a signal reliably, it will show “Not available” rather than guess.
        <br><br>
        Trust matters: scan output is used to generate this report and is not sold. Payment details are handled by the payment provider and are not stored in iQWEB.
      </div>
    `;
  }

  // -----------------------------
  // Main
  // -----------------------------
  async function main() {
    wireBackToDashboard();

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

      window.__iqweb_lastData = data;

      const header = safeObj(data.header);
      const scores = safeObj(data.scores);

      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      renderOverall(scores);
      renderNarrative(data.narrative);
      renderSignals(data.delivery_signals, data.narrative);
      renderSignalEvidence(data.delivery_signals);
      renderKeyInsights(scores, data.delivery_signals, data.narrative);
      renderTopIssues(data.delivery_signals);
      renderFixSequence(scores, data.delivery_signals);
      renderFinalNotes();

      if (loaderSection) loaderSection.style.display = "none";
      if (reportRoot) reportRoot.style.display = "block";

      // PDF vs normal mode handling
      if (window.location.search.includes("pdf=1")) {
        // PDF mode: finish cleanly for DocRaptor (do NOT hang)
        try {
          await waitForPdfReady();
        } catch (_) {
          // even if something explodes, do not hang DocRaptor
          window.__IQWEB_REPORT_READY = true;
          try {
            if (typeof window.docraptorJavaScriptFinished === "function") {
              window.docraptorJavaScriptFinished();
            }
          } catch (_) {}
        }
      } else {
        // Normal interactive mode
        ensureNarrative(header.report_id || reportId, data.narrative);
      }

    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = `Failed to load report data: ${err?.message || String(err)}`;

      // If we're generating a PDF and fail, don't hang forever — finish so you at least get an error PDF.
      if (window.location.search.includes("pdf=1")) {
        try {
          await waitForPdfReady();
        } catch (_) {
          // last-ditch: do not hang DocRaptor
          window.__IQWEB_REPORT_READY = true;
          try {
            if (typeof window.docraptorJavaScriptFinished === "function") window.docraptorJavaScriptFinished();
          } catch (_) {}
        }
      }
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
