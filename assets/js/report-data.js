// /assets/js/report-data.js
// iQWEB Report UI — Contract v1.0.7 (Delivery Signals narrative wiring)
// - Keeps scoring + cards + evidence wiring intact
// - FIXES Delivery Signal cards: prefer TRUE narrative lines from data.narrative (not score-script)
// - FIXES Key Insight Metrics: render as STATIC insights (no dropdowns)
// - Adds safe renderers for Top Issues, Fix Sequence, Final Notes (optional IDs)
// - Narrative supports text OR JSON and polls until available
// - Enforces v5.2 line caps in UI:
//   - Executive narrative max 5 lines
//   - Signal card narrative max 3 lines (hard cap in UI)

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

  // v5.2 UI clamp helper
  function normalizeLines(text, maxLines) {
    const s = String(text ?? "").replace(/\r\n/g, "\n").trim();
    if (!s) return [];
    return s
      .split("\n")
      .map(l => l.trim())
      .filter(Boolean)
      .slice(0, maxLines);
  }

  // Remove "authority" line if present as 3rd line in signal cards
  function stripAuthorityLineIfPresent(lines) {
    const cleaned = [];
    for (let i = 0; i < lines.length; i++) {
      const s = String(lines[i] || "").trim();
      const low = s.toLowerCase();
      // only strip if it's the classic "no action required" instruction line
      if (
        i === 2 &&
        (low === "no action required." ||
          low === "no action required at this time." ||
          low === "no action required" ||
          low === "no immediate fixes are required in this area." ||
          low === "no issues to address in this area." ||
          low === "no improvements needed in this area.")
      ) {
        continue;
      }
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
  // Deterministic fallback (neutral, explain-only)
  // -----------------------------
  function summaryFallback(sig) {
    const score = asInt(sig?.score, 0);
    const label = String(sig?.label ?? sig?.id ?? "This signal");

    // Keep it calm + non-authoritative (no "do X now", no "no action required")
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
  // Narrative (display + auto-generate + poll)
  // -----------------------------
  function parseNarrativeFlexible(v) {
    if (v == null) return { kind: "empty", text: "" };

    if (typeof v === "string") {
      const s = v.trim();
      if (!s) return { kind: "empty", text: "" };

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

      const overallLines = asArray(n?.overall?.lines)
        .map(l => String(l || "").trim())
        .filter(Boolean);

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
    if (sessionStorage.getItem(key) === "1") return;
    sessionStorage.setItem(key, "1");

    if (narrativeInFlight) return;
    narrativeInFlight = true;

    textEl.textContent = "Generating narrative…";

    try {
      await generateNarrative(reportId);

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
  // Delivery Signals — TRUE narrative first (max 3 lines)
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

    // Accept multiple possible shapes to avoid brittle wiring
    const narrSignals =
      safeObj(narrObj?.signals) ||
      safeObj(narrObj?.delivery_signals) ||
      safeObj(narrObj?.deliverySignals) ||
      {};

    const keyFromSig = (sig) => {
      const id = String(sig?.id || sig?.label || "").toLowerCase();

      // common variants
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("seo foundations")) return "seo";
      if (id.includes("structure")) return "structure";
      if (id.includes("semantic")) return "structure";
      if (id.includes("sec")) return "security";
      if (id.includes("trust")) return "security";
      if (id.includes("access")) return "accessibility";

      // fallback to a cleaned key
      return id.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || null;
    };

    for (const sig of list) {
      const label = String(sig?.label ?? sig?.id ?? "Signal");
      const score = asInt(sig?.score, 0);

      const key = keyFromSig(sig);

      const rawLines = key
        ? asArray(narrSignals?.[key]?.lines)
            .map(l => String(l || "").trim())
            .filter(Boolean)
        : [];

      // ✅ HARD cap for cards: max 3 lines (v5.2 locked)
      const cardLines = normalizeLines(rawLines.join("\n"), 3);
      const safeLines = stripAuthorityLineIfPresent(cardLines);

      const bodyText = safeLines.length
        ? safeLines.join("\n")
        : summaryFallback(sig);

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
  // Key Insight Metrics (STATIC)
  // -----------------------------
  function keyFromLabelOrId(sig) {
    const id = String(sig?.id || sig?.label || "").toLowerCase();
    if (id.includes("perf")) return "performance";
    if (id.includes("seo")) return "seo";
    if (id.includes("struct")) return "structure";
    if (id.includes("semantic")) return "structure";
    if (id.includes("mob")) return "mobile";
    if (id.includes("sec")) return "security";
    if (id.includes("trust")) return "security";
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

    const signalScores = Object.entries(scoreBy);
    signalScores.sort((a, b) => a[1] - b[1]); // lowest first
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
      weakest
        ? `Focus: ${prettifyKey(weakest)} is the lowest scoring area in this scan.`
        : `Focus: address the lowest scoring signal areas first for highest leverage.`;

    const nextText =
      overall >= 75
        ? "Next: apply the changes you choose, then re-run the scan to confirm measurable improvement."
        : "Next: start with Phase 1 fast wins, then re-run the scan to confirm measurable improvement.";

    root.innerHTML = `
      <div class="insight-list">
        <div class="insight">
          <div class="tag">Strength</div>
          <div class="text">${escapeHtml(strengthText)}</div>
        </div>
        <div class="insight">
          <div class="tag">Risk</div>
          <div class="text">${escapeHtml(riskText)}</div>
        </div>
        <div class="insight">
          <div class="tag">Focus</div>
          <div class="text">${escapeHtml(focusText)}</div>
        </div>
        <div class="insight">
          <div class="tag">Next</div>
          <div class="text">${escapeHtml(nextText)}</div>
        </div>
      </div>
    `;
  }

  // -----------------------------
  // Top Issues Detected (Contextual, Not Alarmist) — optional section
  // -----------------------------
  function softImpactLabel(severity) {
    const s = String(severity || "").toLowerCase();
    if (s.includes("high") || s.includes("critical")) return "High leverage";
    if (s.includes("med") || s.includes("warn")) return "Worth addressing";
    return "Monitor";
  }

  function renderTopIssues(deliverySignals) {
    const root = $("topIssuesRoot");
    if (!root) return; // section optional
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

  // -----------------------------
  // Recommended Fix Sequence (Phased) — optional section
  // -----------------------------
  function renderFixSequence(scores, deliverySignals) {
    const root = $("fixSequenceRoot");
    if (!root) return; // section optional

    const hasPhases = root.querySelector?.(".phase");
    if (hasPhases) return;

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

  // -----------------------------
  // Final Notes — optional section
  // -----------------------------
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

      // (Optional) quick debug handle
      window.__iqweb_lastData = data;

      const header = safeObj(data.header);
      const scores = safeObj(data.scores);

      setHeaderWebsite(header.website);
      setHeaderReportId(header.report_id || reportId);
      setHeaderReportDate(header.created_at);

      renderOverall(scores);

      // Executive narrative (separate; stays max 5 lines)
      renderNarrative(data.narrative);

      // ✅ Delivery Signals — TRUE narrative first
      renderSignals(data.delivery_signals, data.narrative);

      // Evidence + other sections
      renderSignalEvidence(data.delivery_signals);

      renderKeyInsights(scores, data.delivery_signals, data.narrative);

      renderTopIssues(data.delivery_signals);
      renderFixSequence(scores, data.delivery_signals);
      renderFinalNotes();

      if (loaderSection) loaderSection.style.display = "none";
      if (reportRoot) reportRoot.style.display = "block";

      // Ensure narrative exists (async)
      ensureNarrative(header.report_id || reportId, data.narrative);
    } catch (err) {
      console.error(err);
      if (statusEl) statusEl.textContent = `Failed to load report data: ${err?.message || String(err)}`;
    }
  }

  document.addEventListener("DOMContentLoaded", main);
})();
