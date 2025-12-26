// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// IMPORTANT:
// - DO NOT change get-report-data-pdf.js (keep it a pure proxy)
// - This file only *renders* the existing JSON into print-friendly HTML.
// Data source:
// - /.netlify/functions/get-report-data-pdf?report_id=...

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
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Missing report_id",
      };
    }

    // ---- Fetch JSON (server-side) ----
    const siteUrl = process.env.URL || "https://iqweb.ai";
    const dataUrl =
      siteUrl +
      "/.netlify/functions/get-report-data-pdf?report_id=" +
      encodeURIComponent(reportId);

    const resp = await fetch(dataUrl, { method: "GET", headers: { Accept: "application/json" } });
    const rawText = await resp.text().catch(() => "");

    if (!resp.ok) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Failed to fetch report data (" + resp.status + "): " + rawText,
      };
    }

    let json;
    try {
      json = JSON.parse(rawText || "{}");
    } catch (e) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body: "Report data endpoint returned non-JSON: " + rawText.slice(0, 600),
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

    function formatDateTime(iso) {
      if (!iso) return "";
      const d = new Date(iso);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "UTC",
        timeZoneName: "short",
      });
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

    function renderBullets(lines, max = 6) {
      const arr = lineify(lines).slice(0, max);
      if (!arr.length) return "";
      return "<ul>" + arr.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    }

    function renderLines(lines, max = 3) {
      const arr = lineify(lines).slice(0, max);
      if (!arr.length) return "";
      return `<div class="sig-lines">${arr
        .map((ln) => `<div class="sig-line">${esc(ln)}</div>`)
        .join("")}</div>`;
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
      if (v === null) return "";
      if (typeof v === "undefined") return "";
      if (typeof v === "number") return String(v);
      if (typeof v === "boolean") return v ? "true" : "false";
      if (typeof v === "string") return v.trim();
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }

    // Prefer sig.observations (label/value). Otherwise use sig.evidence object.
    function buildEvidenceRows(sig) {
      if (Array.isArray(sig?.observations) && sig.observations.length) {
        return sig.observations
          .map((o) => ({
            k: String(o?.label || "").trim(),
            v: formatValue(o?.value),
          }))
          .filter((r) => r.k && !isEmptyValue(r.v));
      }

      const ev = sig?.evidence && typeof sig.evidence === "object" ? sig.evidence : null;
      if (ev && !Array.isArray(ev)) {
        const keys = Object.keys(ev).sort((a, b) => String(a).localeCompare(String(b)));
        return keys
          .map((k) => ({ k: prettifyKey(k), v: formatValue(ev[k]) }))
          .filter((r) => r.k && !isEmptyValue(r.v));
      }

      return [];
    }

    // Map signal -> key used by findings
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

    // ---- Data ----
    const header = (json && json.header) || {};
    const scores = (json && json.scores) || {};
    const deliverySignalsRaw = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];
    const deliverySignals = sortSignals(deliverySignalsRaw);

    // Prefer findings.* for narrative parity with OSD; fallback to narrative.*
    const findings = json && json.findings && typeof json.findings === "object" ? json.findings : {};
    const narrativeObj = json && json.narrative && typeof json.narrative === "object" ? json.narrative : {};

    // ---- Executive Narrative ----
    const execLines =
      (findings && findings.executive && findings.executive.lines) ||
      (narrativeObj && narrativeObj.overall && narrativeObj.overall.lines) ||
      null;

    const executiveHtml = execLines ? renderBullets(execLines, 6) : "";

    // ---- Key Insight Metrics ----
    function labelForKey(k) {
      switch (k) {
        case "performance":
          return "Performance Score";
        case "mobile":
          return "Mobile Experience Score";
        case "seo":
          return "SEO Foundations Score";
        case "security":
          return "Security & Trust Score";
        case "structure":
          return "Structure & Semantics Score";
        case "accessibility":
          return "Accessibility Score";
        default:
          return prettifyKey(k);
      }
    }

    const keyInsightRows = (() => {
      const rows = [];
      // Overall first
      rows.push({ m: "Overall Delivery Score", v: asInt(scores.overall, "—") });

      // Then each signal (stable order)
      const byKey = {};
      deliverySignals.forEach((s) => {
        const k = safeSignalKey(s);
        if (k) byKey[k] = s;
      });

      SIGNAL_ORDER.forEach((k) => {
        const sig = byKey[k];
        if (!sig) return;
        rows.push({ m: labelForKey(k), v: asInt(sig.score, "—") });
      });

      return rows;
    })();

    const keyInsightsHtml = (() => {
      if (!keyInsightRows.length) return "";
      const trs = keyInsightRows
        .map((r) => `<tr><td>${esc(r.m)}</td><td class="num">${esc(r.v)}</td></tr>`)
        .join("");
      return `
        <table class="tbl compact">
          <thead><tr><th>Metric</th><th class="num">Value</th></tr></thead>
          <tbody>${trs}</tbody>
        </table>
      `;
    })();

    // ---- Delivery Signals block (with narrative per signal) ----
    const deliverySignalsHtml = (() => {
      if (!deliverySignals.length) return "";

      const overallScore = asInt(scores.overall, "—");
      const overallLines =
        (findings && findings.overall && findings.overall.lines) ||
        (findings && findings.executive && findings.executive.lines) ||
        (narrativeObj && narrativeObj.overall && narrativeObj.overall.lines) ||
        null;

      const cards = [];

      // Overall card (with narrative)
      cards.push(`
        <div class="card">
          <div class="card-row">
            <div class="card-title">Overall Delivery Score</div>
            <div class="card-score">${esc(overallScore)}</div>
          </div>
          ${renderLines(overallLines, 3)}
        </div>
      `);

      // Per signal cards
      deliverySignals.forEach((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");
        const key = safeSignalKey(sig);

        const lines =
          (key && findings && findings[key] && findings[key].lines) ||
          // legacy fallback (some old payloads may use narrative.signals.<key>.lines)
          (key &&
            narrativeObj &&
            narrativeObj.signals &&
            narrativeObj.signals[key] &&
            narrativeObj.signals[key].lines) ||
          null;

        cards.push(`
          <div class="card">
            <div class="card-row">
              <div class="card-title">${esc(name)}</div>
              <div class="card-score">${esc(score)}</div>
            </div>
            ${renderLines(lines, 3)}
          </div>
        `);
      });

      return `<div class="cards">${cards.join("")}</div>`;
    })();

    // ---- Top Issues Detected (derive from deductions across signals) ----
    const topIssuesHtml = (() => {
      const items = [];

      deliverySignals.forEach((sig) => {
        const sigName = String(sig.label || sig.id || "Signal");
        const deds = Array.isArray(sig.deductions) ? sig.deductions : [];
        deds.forEach((d) => {
          const pts = Number(d?.points);
          const points = Number.isFinite(pts) ? pts : 0;
          const reason = String(d?.reason || d?.code || "").trim();
          if (!reason) return;
          items.push({
            points,
            txt: `${sigName}: ${reason}${points ? ` (${points} pts)` : ""}`,
          });
        });
      });

      items.sort((a, b) => (b.points || 0) - (a.points || 0) || a.txt.localeCompare(b.txt));

      const top = items.slice(0, 10);
      if (!top.length) return `<p class="muted">No structured issues detected in this scan output.</p>`;

      return `<ul>${top.map((x) => `<li>${esc(x.txt)}</li>`).join("")}</ul>`;
    })();

    // ---- Recommended Fix Sequence ----
    const fixSeqHtml = (() => {
      const lines =
        (findings && findings.fix_sequence && findings.fix_sequence.lines) ||
        (findings && findings.fixSequence && findings.fixSequence.lines) ||
        null;

      const defaultSeq = [
        "Security headers + policy baselines (CSP, X-Frame-Options, Permissions-Policy).",
        "SEO foundations (H1 presence, robots meta, canonical consistency).",
        "Accessibility quick wins (empty links/buttons, labels, focus targets).",
        "Performance stability (reduce payload bloat; tame inline script count).",
        "Structure + semantics (document structure and markup clarity).",
        "Mobile experience validation (already strong — maintain, re-test after changes).",
      ];

      const seq = lineify(lines);
      const use = seq.length ? seq.slice(0, 8) : defaultSeq;
      return `<ol>${use.map((ln) => `<li>${esc(ln)}</li>`).join("")}</ol>`;
    })();

    // ---- Evidence ----
    const evidenceHtml = (() => {
      if (!deliverySignals.length) return "";

      const blocks = deliverySignals
        .map((sig) => {
          const name = String(sig.label || sig.id || "Signal").trim();
          const rows = buildEvidenceRows(sig).slice(0, 12); // keep compact
          if (!rows.length) return "";

          const trs = rows
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

      if (!blocks.length) return `<p class="muted">No evidence rows available in this scan output.</p>`;
      return blocks.join("");
    })();

    // ---- Final Notes ----
    const finalNotesHtml = (() => {
      const lines =
        (findings && findings.final_notes && findings.final_notes.lines) ||
        (findings && findings.finalNotes && findings.finalNotes.lines) ||
        null;

      const fallback = [
        "This PDF reflects deterministic checks and extracted scan evidence only.",
        "Narrative lines are generated summaries tied to measured signals; treat them as diagnostic guidance, not absolute truth.",
        "Re-run the scan after changes to confirm improvements and catch regressions.",
      ];

      const use = lineify(lines);
      const out = use.length ? use.slice(0, 6) : fallback;
      return renderBullets(out, 6);
    })();

    // ---- Print CSS ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      html, body { padding: 0; margin: 0; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }

      h2 {
        font-size: 12.5px;
        margin: 14px 0 8px;
        border-bottom: 1px solid #ddd;
        padding-bottom: 6px;
      }
      h3 { font-size: 11.5px; margin: 12px 0 8px; }

      p, li { font-size: 10.5px; line-height: 1.35; }
      ul, ol { margin: 8px 0 0 18px; }

      .muted { color: #666; }

      .topbar {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 14px;
      }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; white-space: nowrap; }
      .hr { border-top: 1px solid #ddd; margin: 10px 0 10px; }

      .cards { margin-top: 6px; }
      .card {
        border: 1px solid #e5e5e5;
        border-radius: 8px;
        padding: 10px;
        margin: 10px 0;
        page-break-inside: avoid;
      }
      .card-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        gap: 10px;
      }
      .card-title { font-weight: 700; font-size: 11px; }
      .card-score { font-weight: 700; font-size: 13px; }

      .sig-lines { margin-top: 6px; }
      .sig-line { font-size: 10.5px; line-height: 1.35; margin-top: 4px; }

      .tbl { width: 100%; border-collapse: collapse; }
      .tbl th { text-align: left; font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #ddd; }
      .tbl td { font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
      .tbl .m { width: 65%; }
      .tbl .val { width: 35%; word-break: break-word; }
      .tbl .num { text-align: right; width: 20%; }
      .tbl.compact th, .tbl.compact td { padding: 6px 8px; }

      .ev-block { margin: 12px 0; page-break-inside: avoid; }
      .ev-title { margin: 0 0 8px; font-size: 11.5px; font-weight: 700; }

      .footer {
        margin-top: 14px;
        font-size: 9px;
        color: #666;
        display: flex;
        justify-content: space-between;
        border-top: 1px solid #eee;
        padding-top: 8px;
      }
    `;

    // ---- Sections ----
    const executiveSection = executiveHtml ? `<h2>Executive Narrative</h2>${executiveHtml}` : "";

    const keyInsightsSection = keyInsightsHtml ? `<h2>Key Insight Metrics</h2>${keyInsightsHtml}` : "";

    const deliverySection = deliverySignalsHtml ? `<h2>Delivery Signals</h2>${deliverySignalsHtml}` : "";

    const issuesSection = `<h2>Top Issues Detected</h2>${topIssuesHtml}`;

    const fixSeqSection = `<h2>Recommended Fix Sequence</h2>${fixSeqHtml}`;

    const evidenceSection = `<h2>Evidence</h2>${evidenceHtml}`;

    const finalNotesSection = `<h2>Final Notes</h2>${finalNotesHtml}`;

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
      <div class="muted" style="font-size:10px; margin-top:4px;"><strong>Website:</strong> ${esc(
        header.website || ""
      )}</div>
    </div>
    <div class="meta">
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
    </div>
  </div>

  <div class="hr"></div>

  ${executiveSection}
  ${keyInsightsSection}
  ${deliverySection}
  ${issuesSection}
  ${fixSeqSection}
  ${evidenceSection}
  ${finalNotesSection}

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
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err && err.message ? err.message : "Unknown error" }),
    };
  }
};
