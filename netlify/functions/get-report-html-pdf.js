// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// IMPORTANT:
// - DO NOT change get-report-data-pdf.js (keep it a pure proxy)
// - This file only renders the existing JSON into print-friendly HTML.
//
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

    function prettifyKey(k) {
      k = String(k || "").split("_").join(" ");
      return k.replace(/\b\w/g, (m) => m.toUpperCase());
    }

    function evidenceToObs(evidence) {
      const ev = evidence && typeof evidence === "object" ? evidence : {};
      const entries = [];
      for (const key in ev) {
        if (Object.prototype.hasOwnProperty.call(ev, key)) entries.push([key, ev[key]]);
      }
      entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return entries.map(([k, v]) => ({ label: prettifyKey(k), value: v }));
    }

    // Map signal -> narrative key (matches your OSD signal set)
    function safeSignalKey(sig) {
      const id = String((sig && (sig.id || sig.label)) || "").toLowerCase();
      if (id.includes("overall")) return "overall";
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("sec") || id.includes("trust")) return "security";
      if (id.includes("struct") || id.includes("semantic")) return "structure";
      if (id.includes("access")) return "accessibility";
      return null;
    }

    const header = (json && json.header) ? json.header : {};
    const scores = (json && json.scores) ? json.scores : {};
    const deliverySignals = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];
    const narrativeObj = (json && json.narrative) ? json.narrative : null;

    // ---- Executive Narrative ----
    const execLines =
      (narrativeObj && narrativeObj.overall && narrativeObj.overall.lines)
        ? narrativeObj.overall.lines
        : null;

    const executiveNarrativeHtml = (() => {
      const lines = lineify(execLines);
      if (!lines.length) return '<p class="muted">Narrative not available for this report.</p>';
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ---- Delivery Signals (include narrative per signal) ----
    const deliverySignalsHtml = (() => {
      const narrSignals =
        (narrativeObj && narrativeObj.signals && typeof narrativeObj.signals === "object")
          ? narrativeObj.signals
          : {};

      if (!deliverySignals.length) {
        return '<div class="block"><p class="muted">No delivery signals in this scan output.</p></div>';
      }

      return deliverySignals.map((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");

        const key = safeSignalKey(sig);
        const lines = key && narrSignals && narrSignals[key] ? lineify(narrSignals[key].lines) : [];
        const narr =
          lines.length
            ? lines.slice(0, 3).map((ln) => '<p class="sig-narr">' + esc(ln) + "</p>").join("")
            : '<p class="sig-narr muted">No signal narrative available for this report.</p>';

        return `
          <div class="block">
            <div class="row">
              <div class="label">${esc(name)}</div>
              <div class="score">${esc(score)}</div>
            </div>
            ${narr}
          </div>
        `;
      }).join("");
    })();

    // ---- Signal Evidence (observations + issues) ----
    const signalEvidenceHtml = (() => {
      if (!deliverySignals.length) return '<p class="muted">No evidence available.</p>';

      return deliverySignals.map((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");

        const obs = Array.isArray(sig.observations) && sig.observations.length
          ? sig.observations.map((o) => ({ label: o.label || "Observation", value: o.value }))
          : evidenceToObs(sig.evidence);

        const obsRows = obs.slice(0, 60).map((o) => {
          const v = (o.value === null) ? "null" : (typeof o.value === "undefined") ? "—" : String(o.value);
          return `<tr><td class="k">${esc(o.label)}</td><td class="v">${esc(v)}</td></tr>`;
        }).join("");

        const issues = Array.isArray(sig.issues) ? sig.issues : [];
        const issuesHtml = issues.length
          ? "<ul class=\"issues\">" +
              issues.slice(0, 20).map((it) => {
                const t = it && it.title ? String(it.title) : "Issue";
                const impact = it && (it.impact || it.description) ? String(it.impact || it.description) : "—";
                return `<li><strong>${esc(t)}</strong> — ${esc(impact)}</li>`;
              }).join("") +
            "</ul>"
          : "<p class=\"muted\">No issues detected for this signal.</p>";

        return `
          <div class="block">
            <div class="row">
              <div class="label">${esc(name)} — Evidence</div>
              <div class="score">${esc(score)}</div>
            </div>

            <h3>Observations</h3>
            <table class="tbl">
              <thead><tr><th>Observation</th><th>Value</th></tr></thead>
              <tbody>${obsRows || "<tr><td class=\"k\">—</td><td class=\"v\">—</td></tr>"}</tbody>
            </table>

            <h3>Issues</h3>
            ${issuesHtml}
          </div>
        `;
      }).join("");
    })();

    // ---- Key Insight Metrics ----
    const insight = (() => {
      const scored = deliverySignals
        .map((s) => ({ label: String(s.label || s.id || "Signal"), score: Number(s.score) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score);

      const weakest = scored.length ? scored[0] : null;
      const strongest = scored.length ? scored[scored.length - 1] : null;

      return {
        strength: strongest ? `${strongest.label} is the strongest measured area in this scan.` : "Strength not available.",
        risk: weakest ? `${weakest.label} is the most constrained measured area in this scan.` : "Risk not available.",
        focus: weakest ? `Focus: start with ${weakest.label} first for highest leverage.` : "Focus: address the lowest scoring signal areas first.",
        next: "Next: apply the changes you choose, then re-run the scan to confirm measurable improvement.",
      };
    })();

    // ---- Top Issues Detected ----
    const topIssuesHtml = (() => {
      const all = [];
      deliverySignals.forEach((sig) => {
        const issues = Array.isArray(sig.issues) ? sig.issues : [];
        issues.forEach((it) => {
          all.push({
            title: String((it && it.title) || "Issue"),
            why: String((it && (it.impact || it.description)) || "This can affect measurable delivery."),
            severity: String((it && it.severity) || "low"),
          });
        });
      });

      if (!all.length) return '<p class="muted">No issues listed in this scan output.</p>';

      const seen = {};
      const uniq = [];
      for (let i = 0; i < all.length; i++) {
        const key = all[i].title.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        uniq.push(all[i]);
        if (uniq.length >= 12) break;
      }

      return "<ul>" + uniq.map((x) => `<li><strong>${esc(x.title)}</strong> — ${esc(x.why)}</li>`).join("") + "</ul>";
    })();

    // ---- Fix Sequence ----
    const fixSequenceHtml = (() => {
      const scored = deliverySignals
        .map((s) => ({ label: String(s.label || s.id || "Signal"), score: Number(s.score) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score);

      if (!scored.length) return '<p class="muted">Fix order not available from this scan.</p>';

      const summary = scored[1]
        ? `Suggested order: start with ${scored[0].label} + ${scored[1].label}, then re-run the scan.`
        : `Suggested order: start with ${scored[0].label}, then re-run the scan.`;

      const list = "<ol>" + scored.slice(0, 6).map((x) => `<li>${esc(x.label)}</li>`).join("") + "</ol>";

      return `<p>${esc(summary)}</p>${list}`;
    })();

    const finalNotesHtml = `
      <p>This report is a diagnostic snapshot based on measurable signals captured during this scan. Where iQWEB cannot measure a signal reliably, it will show “Not available” rather than guess.</p>
      <p>Trust matters: scan output is used to generate this report and is not sold. Payment details are handled by the payment provider and are not stored in iQWEB.</p>
    `;

    // ---- Plain print CSS (Phase 1: text-first) ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h1 { font-size: 18px; margin: 0 0 10px; }
      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      h3 { font-size: 11px; margin: 12px 0 6px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }
      .top { display: flex; justify-content: space-between; gap: 10px; }
      .brand { font-weight: 700; font-size: 13px; }
      .meta { font-size: 10px; text-align: right; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0; }

      .block { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .row { display: flex; justify-content: space-between; align-items: baseline; gap: 10px; }
      .label { font-weight: 700; font-size: 11px; }
      .score { font-weight: 700; font-size: 14px; }
      .sig-narr { margin: 6px 0 0; }

      .tbl { width: 100%; border-collapse: collapse; margin-top: 6px; }
      .tbl th { text-align: left; font-size: 10px; padding: 6px; border-bottom: 1px solid #ddd; }
      .tbl td { font-size: 10px; padding: 6px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
      .tbl .k { width: 55%; }
      .tbl .v { width: 45%; word-break: break-word; }

      .issues { margin: 6px 0 0 18px; padding: 0; }
      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report — ${esc(header.report_id || reportId)}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>${css}</style>
</head>
<body>
  <div class="top">
    <div>
      <div class="brand">iQWEB</div>
      <div class="muted" style="font-size:10px;">Powered by Λ i Q™</div>
    </div>
    <div class="meta">
      <div><strong>Website:</strong> ${esc(header.website || "")}</div>
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(header.created_at || "")}</div>
    </div>
  </div>

  <div class="hr"></div>

  <h2>Executive Narrative</h2>
  ${executiveNarrativeHtml}

  <h2>Delivery Signals</h2>
  <p class="muted">Delivery scores reflect deterministic checks only.</p>
  <div class="block">
    <div class="row">
      <div class="label">Overall Delivery Score</div>
      <div class="score">${esc(asInt(scores.overall, "—"))}</div>
    </div>
    <p class="muted">Overall delivery score (deterministic checks).</p>
  </div>
  ${deliverySignalsHtml}

  <h2>Signal Evidence</h2>
  <p class="muted">Evidence below shows measurable observations captured during this scan.</p>
  ${signalEvidenceHtml}

  <h2>Key Insight Metrics</h2>
  <div class="block"><div class="label">Strength</div><p>${esc(insight.strength)}</p></div>
  <div class="block"><div class="label">Risk</div><p>${esc(insight.risk)}</p></div>
  <div class="block"><div class="label">Focus</div><p>${esc(insight.focus)}</p></div>
  <div class="block"><div class="label">Next</div><p>${esc(insight.next)}</p></div>

  <h2>Top Issues Detected</h2>
  ${topIssuesHtml}

  <h2>Recommended Fix Sequence</h2>
  ${fixSequenceHtml}

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
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ error: err && err.message ? err.message : "Unknown error" }),
    };
  }
};
