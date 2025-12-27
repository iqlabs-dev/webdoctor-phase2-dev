// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// Data source:
// - /.netlify/functions/get-report-data-pdf?report_id=...

const DATA_FETCH_TIMEOUT_MS = 20000;
const RETRY_ON_TIMEOUT_ONCE = true;

exports.handler = async (event) => {
  // Preflight
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Accept",
        "Cache-Control": "no-store",
      },
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        Allow: "GET, OPTIONS",
        "Access-Control-Allow-Origin": "*",
      },
      body: JSON.stringify({ error: "Method not allowed" }),
    };
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id || event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: "Missing report_id",
      };
    }

    // ---- Fetch JSON (server-side) ----
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const rawText = await fetchJsonWithTimeoutAndRetry(dataUrl);

    let json;
    try {
      json = JSON.parse(rawText || "{}");
    } catch (e) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: "Report data endpoint returned non-JSON: " + rawText.slice(0, 600),
      };
    }

    if (!json || json.success !== true) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Access-Control-Allow-Origin": "*" },
        body: "Report data endpoint returned success=false",
      };
    }

    // ---- Helpers ----
    function esc(s) {
      return String(s == null ? "" : s)
        .split("&").join("&amp;")
        .split("<").join("&lt;")
        .split(">").join("&gt;")
        .split('"').join("&quot;")
        .split("'").join("&#039;");
    }

    function asInt(v, fallback = "—") {
      const n = Number(v);
      if (!Number.isFinite(n)) return fallback;
      return String(Math.round(n));
    }

    function lineify(v) {
      if (!v) return [];
      if (Array.isArray(v)) return v.filter(Boolean).map(String);
      if (typeof v === "string") {
        return v
          .split("\n")
          .map((x) => String(x || "").trim())
          .filter(Boolean);
      }
      if (typeof v === "object" && Array.isArray(v.lines)) return v.lines.filter(Boolean).map(String);
      return [];
    }

    function renderLines(lines, max = 3) {
      const arr = lineify(lines).slice(0, max);
      if (!arr.length) return `<div class="muted">No narrative available for this section.</div>`;
      return `<div class="sig-lines">${arr.map((ln) => `<div class="sig-line">${esc(ln)}</div>`).join("")}</div>`;
    }

    function prettifyKey(k) {
      k = String(k || "").split("_").join(" ");
      return k.replace(/\b\w/g, (m) => m.toUpperCase());
    }

    function isEmptyValue(v) {
      if (v === null || typeof v === "undefined") return true;
      if (typeof v === "string" && v.trim() === "") return true;
      if (typeof v === "object") {
        if (Array.isArray(v) && v.length === 0) return true;
        if (!Array.isArray(v) && Object.keys(v).length === 0) return true;
      }
      return false;
    }

    function formatValue(v) {
      if (v === null || typeof v === "undefined") return "";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "string") return v.trim();
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }

    // Prefer sig.observations (already label/value). Otherwise use sig.evidence object.
    function buildEvidenceRows(sig) {
      if (Array.isArray(sig?.observations) && sig.observations.length) {
        const rows = sig.observations
          .map((o) => ({
            k: String(o?.label || "").trim(),
            v: formatValue(o?.value),
          }))
          .filter((r) => r.k && !isEmptyValue(r.v));
        return rows;
      }

      const ev = sig?.evidence && typeof sig.evidence === "object" ? sig.evidence : null;
      if (ev && !Array.isArray(ev)) {
        const keys = Object.keys(ev);
        keys.sort((a, b) => String(a).localeCompare(String(b)));
        const rows = keys
          .map((k) => ({ k: prettifyKey(k), v: formatValue(ev[k]) }))
          .filter((r) => r.k && !isEmptyValue(r.v));
        return rows;
      }

      return [];
    }

    // Map signal label/id -> canonical key
    function safeSignalKey(sig) {
      const id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("sec") || id.includes("trust")) return "security";
      if (id.includes("struct") || id.includes("semantic")) return "structure";
      if (id.includes("access")) return "accessibility";
      return null;
    }

    const SIGNAL_ORDER = ["performance", "mobile", "seo", "security", "structure", "accessibility"];

    function sortSignals(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      arr.sort((a, b) => {
        const ka = safeSignalKey(a);
        const kb = safeSignalKey(b);
        const ia = ka ? SIGNAL_ORDER.indexOf(ka) : 999;
        const ib = kb ? SIGNAL_ORDER.indexOf(kb) : 999;
        if (ia !== ib) return ia - ib;
        return String(a?.label || a?.id || "").localeCompare(String(b?.label || b?.id || ""));
      });
      return arr;
    }

    // Deterministic recommended fix order
    const FIX_ORDER = ["security", "seo", "accessibility", "performance", "structure", "mobile"];
    function fixLabel(key) {
      switch (key) {
        case "security":
          return "Security headers + policy baselines (CSP, X-Frame-Options, Permissions-Policy).";
        case "seo":
          return "SEO foundations (H1 presence, robots meta, canonical consistency).";
        case "accessibility":
          return "Accessibility quick wins (empty links/buttons, labels, focus targets).";
        case "performance":
          return "Performance stability (reduce payload bloat; tame inline script count).";
        case "structure":
          return "Structure + semantics (document structure and markup clarity).";
        case "mobile":
          return "Mobile experience validation (re-test after changes).";
        default:
          return "";
      }
    }

    // Pull per-signal narrative robustly (this fixes your “No narrative…” problem)
    function getSignalNarrativeLines(sig, key, findings, narrativeObj) {
      // 1) Most common: narrative embedded on the signal itself (OSD often uses this)
      const fromSig =
        sig?.narrative?.lines ||
        sig?.summary?.lines ||
        sig?.findings?.lines ||
        sig?.narrative ||
        sig?.summary ||
        sig?.findings;

      const arr1 = lineify(fromSig);
      if (arr1.length) return arr1;

      // 2) Some payloads store narrative under narrative.signals[key].lines
      const fromNarrObj = narrativeObj?.signals?.[key]?.lines || narrativeObj?.[key]?.lines || null;
      const arr2 = lineify(fromNarrObj);
      if (arr2.length) return arr2;

      // 3) Your current deterministic path: findings[key].lines
      const fromFindings = findings?.[key]?.lines || findings?.[key] || null;
      const arr3 = lineify(fromFindings);
      if (arr3.length) return arr3;

      return [];
    }

    // ---- Data extraction ----
    const header = json?.header || {};
    const scores = json?.scores || {};
    const findings = (json?.findings && typeof json.findings === "object") ? json.findings : {};
    const narrativeObj = json?.narrative || {};

    const deliverySignalsRaw = Array.isArray(json?.delivery_signals) ? json.delivery_signals : [];
    const deliverySignals = sortSignals(deliverySignalsRaw);

    // ============================
    // SECTION 1: Executive Narrative
    // ============================
    const execLines =
      (findings?.executive?.lines) ||
      (narrativeObj?.overall?.lines) ||
      (narrativeObj?.executive?.lines) ||
      null;

    const executiveNarrativeHtml = (() => {
      const lines = lineify(execLines);
      if (!lines.length) return `<p class="muted">No executive narrative was available for this report.</p>`;
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ============================
    // SECTION 2: Delivery Signals (with narrative)
    // Order:
    // overall, performance, mobile, seo, security, structure, accessibility
    // ============================
    const deliverySignalsHtml = (() => {
      const cards = [];

      // Overall first
      const overallLines =
        (findings?.overall?.lines) ||
        (narrativeObj?.overall?.lines) ||
        null;

      cards.push(`
        <div class="card">
          <div class="card-row">
            <div class="card-title">Overall Delivery Score</div>
            <div class="card-score">${esc(asInt(scores.overall, "—"))}</div>
          </div>
          ${renderLines(overallLines, 3)}
        </div>
      `);

      // Render delivery_signals in canonical order with narratives
      if (deliverySignals.length) {
        for (const sig of deliverySignals) {
          const name = String(sig.label || sig.id || "Signal").trim() || "Signal";
          const score = asInt(sig.score, "—");
          const key = safeSignalKey(sig);

          const lines = key ? getSignalNarrativeLines(sig, key, findings, narrativeObj) : [];
          cards.push(`
            <div class="card">
              <div class="card-row">
                <div class="card-title">${esc(name)}</div>
                <div class="card-score">${esc(score)}</div>
              </div>
              ${renderLines(lines, 3)}
            </div>
          `);
        }
        return cards.join("");
      }

      // Fallback: no delivery_signals -> render from scores only
      const fallback = [
        { title: "Performance", score: scores.performance },
        { title: "Mobile Experience", score: scores.mobile },
        { title: "SEO Foundations", score: scores.seo },
        { title: "Security & Trust", score: scores.security },
        { title: "Structure & Semantics", score: scores.structure },
        { title: "Accessibility", score: scores.accessibility },
      ];

      for (const s of fallback) {
        cards.push(`
          <div class="card">
            <div class="card-row">
              <div class="card-title">${esc(s.title)}</div>
              <div class="card-score">${esc(asInt(s.score, "—"))}</div>
            </div>
            <div class="muted">No per-signal narrative available (missing delivery_signals/findings).</div>
          </div>
        `);
      }
      return cards.join("");
    })();

    // ============================
    // SECTION 3: Key Insight Metrics (Strength / Risk / Focus / Next)
    // ============================
    function deriveKeyInsights() {
      // Use explicit payload if provided
      const k = json?.key_insight_metrics || json?.key_insights || null;
      if (k && typeof k === "object") {
        const strength = k.strength || k.STRONG || k.Strength || "";
        const risk = k.risk || k.Risk || "";
        const focus = k.focus || k.Focus || "";
        const next = k.next || k.Next || "";
        const out = {
          strength: String(strength || "").trim(),
          risk: String(risk || "").trim(),
          focus: String(focus || "").trim(),
          next: String(next || "").trim(),
        };
        if (out.strength || out.risk || out.focus || out.next) return out;
      }

      // Derive from scores as a clean fallback
      const sigScores = [
        { key: "performance", label: "Performance", v: Number(scores.performance) },
        { key: "mobile", label: "Mobile Experience", v: Number(scores.mobile) },
        { key: "seo", label: "SEO Foundations", v: Number(scores.seo) },
        { key: "security", label: "Security & Trust", v: Number(scores.security) },
        { key: "structure", label: "Structure & Semantics", v: Number(scores.structure) },
        { key: "accessibility", label: "Accessibility", v: Number(scores.accessibility) },
      ].filter((x) => Number.isFinite(x.v));

      sigScores.sort((a, b) => b.v - a.v);
      const best = sigScores[0] || null;
      const worst = sigScores[sigScores.length - 1] || null;

      const strength = best
        ? `${best.label} appears strongest in this scan.`
        : "A clear strength could not be determined from the available scores.";

      const focus = worst
        ? `Focus: ${worst.label} is the lowest scoring area in this scan.`
        : "Focus: a clear lowest scoring area could not be determined.";

      const topIssues = Array.isArray(json?.top_issues) ? json.top_issues : [];
      const risk = topIssues.length
        ? `Risk: ${String(topIssues[0]).replace(/^.*?:\s*/, "")}`
        : "Risk: no structured high-risk issues were provided in this scan output.";

      const next = worst
        ? `Next: start with ${worst.label}, then re-run the scan to confirm measurable improvement.`
        : "Next: address the highest leverage fixes first, then re-run the scan.";

      return { strength, risk, focus, next };
    }

    const keyInsights = deriveKeyInsights();

    const keyInsightMetricsHtml = (() => {
      const rows = [
        { k: "Strength", v: keyInsights.strength },
        { k: "Risk", v: keyInsights.risk },
        { k: "Focus", v: keyInsights.focus },
        { k: "Next", v: keyInsights.next },
      ].filter((r) => String(r.v || "").trim());

      if (!rows.length) return `<p class="muted">No key insight metrics were available for this report.</p>`;

      const trs = rows
        .map((r) => `<tr><td class="m"><strong>${esc(r.k)}</strong></td><td class="val">${esc(r.v)}</td></tr>`)
        .join("");

      return `
        <table class="tbl">
          <thead><tr><th>Insight</th><th>Detail</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      `;
    })();

    // Keep score table (useful for print) as Key Metric Scores
    const keyMetricScoresHtml = (() => {
      const rows = [
        { k: "Overall Delivery Score", v: asInt(scores.overall, "—") },
        { k: "Performance Score", v: asInt(scores.performance, "—") },
        { k: "Mobile Experience Score", v: asInt(scores.mobile, "—") },
        { k: "SEO Foundations Score", v: asInt(scores.seo, "—") },
        { k: "Security & Trust Score", v: asInt(scores.security, "—") },
        { k: "Structure & Semantics Score", v: asInt(scores.structure, "—") },
        { k: "Accessibility Score", v: asInt(scores.accessibility, "—") },
      ];

      const trs = rows
        .map((r) => `<tr><td class="m">${esc(r.k)}</td><td class="val right">${esc(r.v)}</td></tr>`)
        .join("");

      return `
        <table class="tbl">
          <thead><tr><th>Metric</th><th class="right">Value</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      `;
    })();

    // ============================
    // SECTION 4: Top Issues Detected
    // ============================
    const topIssuesHtml = (() => {
      const issues = Array.isArray(json?.top_issues) ? json.top_issues : [];
      if (issues.length) {
        return `<ul class="issues">` + issues.map((t) => `<li>${esc(t)}</li>`).join("") + `</ul>`;
      }

      // Fallback from delivery_signals deductions
      const out = [];
      const seen = new Set();
      for (const sig of deliverySignals) {
        const sigName = String(sig?.label || sig?.id || "Signal").trim() || "Signal";
        const deds = Array.isArray(sig?.deductions) ? sig.deductions : [];
        for (const d of deds) {
          const reason = String(d?.reason || "").trim();
          if (!reason) continue;
          const item = `${sigName}: ${reason}`;
          if (seen.has(item)) continue;
          seen.add(item);
          out.push(item);
          if (out.length >= 8) break;
        }
        if (out.length >= 8) break;
      }

      if (!out.length) return `<p class="muted">No structured issues detected in this scan output.</p>`;
      return `<ul class="issues">` + out.map((t) => `<li>${esc(t)}</li>`).join("") + `</ul>`;
    })();

    // ============================
    // SECTION 5: Recommended Fix Sequence
    // ============================
    const fixSeqHtml = (() => {
      const items = FIX_ORDER.map((k) => fixLabel(k)).filter(Boolean);
      return `<ol class="fix">` + items.map((t) => `<li>${esc(t)}</li>`).join("") + `</ol>`;
    })();

    // ============================
    // SECTION 6: Signal Evidence (tables per signal, in signal order)
    // ============================
    const evidenceHtml = (() => {
      if (!deliverySignals.length) return `<p class="muted">No signal evidence was available for this report.</p>`;

      const blocks = deliverySignals
        .map((sig) => {
          const name = String(sig.label || sig.id || "Signal").trim() || "Signal";
          const rows = buildEvidenceRows(sig);
          if (!rows.length) return "";

          const trs = rows
            .slice(0, 50)
            .map((r) => `<tr><td class="m">${esc(r.k)}</td><td class="val">${esc(r.v)}</td></tr>`)
            .join("");

          return `
            <div class="ev-block">
              <h3 class="ev-title">Evidence — ${esc(name)}</h3>
              <table class="tbl">
                <thead><tr><th>Metric</th><th>Value</th></tr></thead>
                <tbody>${trs}</tbody>
              </table>
            </div>
          `;
        })
        .filter(Boolean);

      if (!blocks.length) return `<p class="muted">No evidence rows were provided in this scan output.</p>`;
      return blocks.join("");
    })();

    // ============================
    // SECTION 7: Final Notes
    // ============================
    const finalNotesHtml = `
      <ul class="notes">
        <li>This PDF reflects deterministic checks and extracted scan evidence only.</li>
        <li>Narrative lines are tied to measured signals; treat them as diagnostic guidance, not absolute truth.</li>
        <li>Re-run the scan after changes to confirm improvements and catch regressions.</li>
      </ul>
    `;

    // ---- Print CSS (clinical, clean) ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h1 { font-size: 18px; margin: 0 0 10px; }
      h2 { font-size: 13px; margin: 16px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      h3 { font-size: 12px; margin: 14px 0 8px; }
      p, li, td, th { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }

      .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

      .cards { margin-top: 6px; }
      .card { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .card-row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .card-title { font-weight: 700; font-size: 11px; }
      .card-score { font-weight: 700; font-size: 13px; }
      .sig-lines { margin-top: 6px; }
      .sig-line { font-size: 10.5px; line-height: 1.35; margin-top: 4px; }

      ul { margin: 6px 0 0 18px; padding: 0; }
      li { margin: 4px 0; }

      .tbl { width: 100%; border-collapse: collapse; }
      .tbl th { text-align: left; font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #ddd; }
      .tbl td { font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
      .tbl .m { width: 30%; }
      .tbl .val { width: 70%; word-break: break-word; }
      .right { text-align: right; }

      .issues { margin: 6px 0 0 18px; padding: 0; }
      .fix { margin: 6px 0 0 18px; }

      .ev-block { margin: 14px 0; page-break-inside: avoid; }
      .ev-title { margin: 0 0 8px; font-size: 12px; font-weight: 700; }

      .notes { margin: 6px 0 0 18px; }
      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    // ---- FINAL HTML (ORDER EXACTLY AS YOU SPECIFIED) ----
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report — ${esc(header.report_id || reportId)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${css}</style>
</head>
<body>
  <div class="topbar">
    <div>
      <div class="brand">iQWEB</div>
      <div class="muted" style="font-size:10px;">Powered by Λ i Q™</div>
      <div class="muted" style="font-size:10px; margin-top:4px;"><strong>Website:</strong> ${esc(header.website || "")}</div>
    </div>
    <div class="meta">
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(header.created_at || "")}</div>
    </div>
  </div>

  <div class="hr"></div>

  <h2>Executive Narrative</h2>
  ${executiveNarrativeHtml}

  <h2>Delivery Signals</h2>
  <div class="cards">${deliverySignalsHtml}</div>

  <h2>Key Insight Metrics</h2>
  ${keyInsightMetricsHtml}

  <h2>Key Metric Scores</h2>
  ${keyMetricScoresHtml}

  <h2>Top Issues Detected</h2>
  ${topIssuesHtml}

  <h2>Recommended Fix Sequence</h2>
  ${fixSeqHtml}

  <h2>Signal Evidence</h2>
  ${evidenceHtml}

  <h2>Final Notes</h2>
  ${finalNotesHtml}

  <div class="footer">
    <div>© 2025 iQWEB — All rights reserved.</div>
    <div>${esc(header.report_id || reportId)}</div>
  </div>
</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*" },
      body: JSON.stringify({ error: err && err.message ? err.message : "Unknown error" }),
    };
  }
};

/* ---------- fetch helpers ---------- */

async function fetchWithTimeout(url, ms, opts) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

async function fetchJsonWithTimeoutAndRetry(url) {
  const attempt = async () => {
    const resp = await fetchWithTimeout(url, DATA_FETCH_TIMEOUT_MS, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    const rawText = await resp.text().catch(() => "");
    if (!resp.ok) {
      throw new Error(`Failed to fetch report data (${resp.status}): ${rawText.slice(0, 600)}`);
    }
    if (!rawText || rawText.length < 2) {
      throw new Error("Report data endpoint returned empty response");
    }
    return rawText;
  };

  try {
    return await attempt();
  } catch (e) {
    const msg = String(e?.message || "");
    const isTimeout = msg.includes("Timeout after");
    if (!RETRY_ON_TIMEOUT_ONCE || !isTimeout) throw e;

    console.warn("[get-report-html-pdf] data fetch timed out; retrying once:", url);
    return await attempt();
  }
}
