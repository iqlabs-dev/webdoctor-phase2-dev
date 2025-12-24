/* === FILE: /assets/js/report-data.js ===
   iQWEB Report UI — Contract v1.0.3 (LOCKED)
   - Six-card grid (3×2 desktop; responsive fallback)
   - Score shown ONCE (right side only)
   - No evidence expanders inside cards
   - Evidence rendered in dedicated "Signal Evidence" section below
   - Narrative optional; never blocks render

   PATCH (PDF reliability):
   - Allow PDF mode via window.__IQWEB_PDF_MODE
   - Allow bootstrap/inlined data via window.__IQWEB_BOOTSTRAP_DATA (so Prince/DocRaptor never needs fetch/XHR)
*/

(function () {
  const $ = (id) => document.getElementById(id);

  function safeObj(v) { return v && typeof v === "object" ? v : {}; }
  function asArray(v) { return Array.isArray(v) ? v : []; }

  function asInt(v, fallback = 0) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
  }

  function setText(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = text ?? "";
  }

  function setHtml(id, html) {
    const el = $(id);
    if (!el) return;
    el.innerHTML = html ?? "";
  }

  function fmtDate(iso) {
    try {
      if (!iso) return "";
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return String(iso);
      return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
    } catch {
      return String(iso || "");
    }
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function scoreClass(score) {
    const n = asInt(score, 0);
    if (n >= 80) return "good";
    if (n >= 60) return "warn";
    return "bad";
  }

  function setProgress(cardRoot, score) {
    const root = cardRoot;
    if (!root) return;
    const bar = root.querySelector(".bar > span");
    const val = root.querySelector(".score");
    const n = asInt(score, 0);
    if (bar) {
      bar.style.width = `${n}%`;
      bar.setAttribute("data-score", String(n));
    }
    if (val) val.textContent = String(n);
    root.classList.remove("good", "warn", "bad");
    root.classList.add(scoreClass(n));
  }

  function setOverallScore(score) {
    const box = $("overallScore");
    if (!box) return;
    box.textContent = String(asInt(score, 0));
    box.classList.remove("good", "warn", "bad");
    box.classList.add(scoreClass(score));
  }

  function renderNarrative(narr) {
    const narrative = safeObj(narr);
    const lines = asArray(safeObj(narrative.overall).lines).filter(Boolean);
    if (!lines.length) {
      // keep section visible, but show minimal placeholder
      setHtml("narrativeText", `<div class="muted">Narrative not available yet.</div>`);
      return;
    }
    const html = lines.map((l) => `<div class="line">${escapeHtml(l)}</div>`).join("");
    setHtml("narrativeText", html);
  }

  function renderSignalCard(cardId, signal) {
    const card = $(cardId);
    if (!card) return;
    const s = safeObj(signal);
    const score = asInt(s.score, 0);
    const title = s.title || "";
    const subtitle = s.subtitle || "";
    const narrative = s.narrative || "";

    // Title
    const titleEl = card.querySelector(".card-title");
    if (titleEl) titleEl.textContent = title;

    // Score/progress
    setProgress(card, score);

    // Card narrative
    const body = card.querySelector(".card-body");
    if (body) body.textContent = narrative || subtitle || "";
  }

  function renderEvidenceGroup(groupEl, group) {
    const g = safeObj(group);
    const title = g.title || "";
    const items = asArray(g.items);

    const section = document.createElement("section");
    section.className = "evidence-group";

    const h = document.createElement("h3");
    h.textContent = title;
    section.appendChild(h);

    if (!items.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No evidence items available.";
      section.appendChild(p);
      groupEl.appendChild(section);
      return;
    }

    const grid = document.createElement("div");
    grid.className = "evidence-grid";

    for (const it of items) {
      const item = safeObj(it);
      const label = item.label || "";
      const value = item.value ?? "";

      const box = document.createElement("div");
      box.className = "evidence-item";

      const l = document.createElement("div");
      l.className = "evidence-label";
      l.textContent = label;

      const v = document.createElement("div");
      v.className = "evidence-value";
      v.textContent = String(value);

      box.appendChild(l);
      box.appendChild(v);
      grid.appendChild(box);
    }

    section.appendChild(grid);
    groupEl.appendChild(section);
  }

  function renderEvidence(evidence) {
    const ev = safeObj(evidence);
    const groups = asArray(ev.groups);

    const root = $("evidenceRoot");
    if (!root) return;
    root.innerHTML = "";

    if (!groups.length) {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "No evidence available.";
      root.appendChild(p);
      return;
    }

    for (const g of groups) renderEvidenceGroup(root, g);
  }

  function buildEvidenceFromSignals(data) {
    // If your backend already sends a dedicated evidence block, use it.
    // Otherwise we derive a simple evidence view from delivery_signals evidence payloads.
    const d = safeObj(data);
    const signals = safeObj(d.delivery_signals);
    const order = [
      ["performance", "Performance"],
      ["mobile", "Mobile Experience"],
      ["seo", "SEO Foundations"],
      ["security", "Security & Trust"],
      ["structure", "Structure & Semantics"],
      ["accessibility", "Accessibility"],
    ];

    const groups = [];

    for (const [key, title] of order) {
      const sig = safeObj(signals[key]);
      const ev = safeObj(sig.evidence);
      const items = [];

      // Common buckets used by your pipeline
      for (const [label, v] of Object.entries(safeObj(ev.observations))) {
        items.push({ label, value: v });
      }
      for (const [label, v] of Object.entries(safeObj(ev.flags))) {
        items.push({ label, value: v });
      }
      for (const [label, v] of Object.entries(safeObj(ev.metrics))) {
        items.push({ label, value: v });
      }

      groups.push({ title, items });
    }

    return { groups };
  }

  function renderHeader(header) {
    const h = safeObj(header);
    setText("hdrWebsite", h.website || h.url || "");
    setText("hdrReportId", h.report_id || h.reportId || "");
    setText("hdrReportDate", fmtDate(h.created_at || h.report_date || h.createdAt));
  }

  function renderScores(scores) {
    const s = safeObj(scores);
    setOverallScore(s.overall ?? s.overall_score ?? 0);
  }

  function renderSignals(deliverySignals) {
    const ds = safeObj(deliverySignals);

    // Map your six cards
    renderSignalCard("cardPerformance", ds.performance);
    renderSignalCard("cardMobile", ds.mobile);
    renderSignalCard("cardSeo", ds.seo);
    renderSignalCard("cardSecurity", ds.security);
    renderSignalCard("cardStructure", ds.structure);
    renderSignalCard("cardAccessibility", ds.accessibility);

    // Overall delivery bar (if present in DOM)
    const overall = safeObj(ds.overall);
    const overallScore = asInt(overall.score ?? 0);
    const overallBar = $("overallBar");
    const overallVal = $("overallBarValue");
    if (overallBar) overallBar.style.width = `${overallScore}%`;
    if (overallVal) overallVal.textContent = String(overallScore);
    const overallText = $("overallText");
    if (overallText) overallText.textContent = overall.narrative || "";
  }

  async function fetchReportData(reportId) {
    const url = `/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
    const res = await fetch(url, { headers: { "Accept": "application/json" } });
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.success === false) {
      const msg = (json && (json.error || json.message)) || `Failed to load report data (HTTP ${res.status})`;
      throw new Error(msg);
    }
    return json;
  }

  async function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  // PDF readiness flag used by DocRaptor wait_for_javascript
  window.__IQWEB_REPORT_READY = false;

  async function waitForPdfReady() {
    // Small settle delay so fonts/layout finish
    await sleep(200);
    window.__IQWEB_REPORT_READY = true;
  }

  async function main() {
    const params = new URLSearchParams(window.location.search);
    const pdfMode = (params.get("pdf") === "1") || (window.__IQWEB_PDF_MODE === true);
    const reportId = params.get("report_id") || params.get("id");

    if (!reportId) {
      setHtml("narrativeText", `<div class="muted">Missing report_id.</div>`);
      window.__IQWEB_REPORT_READY = true;
      return;
    }

    try {
      const bootstrap = window.__IQWEB_BOOTSTRAP_DATA;
      const data = (bootstrap && typeof bootstrap === "object") ? bootstrap : await fetchReportData(reportId);

      renderHeader(data.header);
      renderScores(data.scores);
      renderSignals(data.delivery_signals);

      // Narrative
      renderNarrative(data.narrative);

      // Evidence
      const evidence = data.evidence && data.evidence.groups ? data.evidence : buildEvidenceFromSignals(data);
      renderEvidence(evidence);

      if (pdfMode) {
        await waitForPdfReady();
      } else {
        window.__IQWEB_REPORT_READY = true;
      }
    } catch (err) {
      setHtml("narrativeText", `<div class="muted">Error: ${escapeHtml(err.message || String(err))}</div>`);
      window.__IQWEB_REPORT_READY = true;
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", main);
  } else {
    main();
  }
})();
