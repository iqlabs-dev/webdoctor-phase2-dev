// netlify/functions/get-report-html-pdf.js
// PDF HTML renderer (NO JS). DocRaptor prints this HTML directly.
// IMPORTANT:
// - DO NOT change get-report-data-pdf.js (keep it a pure proxy)
// - This file only *renders* the existing JSON into print-friendly HTML via templates/report_pdf.html

const fs = require("fs");
const path = require("path");

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

    const resp = await fetch(dataUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });

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

    const header = json && json.header ? json.header : {};
    const scores = json && json.scores ? json.scores : {};
    const deliverySignals = Array.isArray(json.delivery_signals) ? json.delivery_signals : [];
    const narrativeObj = json && json.narrative ? json.narrative : null;

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
        if (Object.prototype.hasOwnProperty.call(ev, key)) {
          entries.push([key, ev[key]]);
        }
      }
      entries.sort((a, b) => String(a[0]).localeCompare(String(b[0])));
      return entries.map(([k, v]) => ({ label: prettifyKey(k), value: v }));
    }

    // Map signal -> narrative key (matches OSD signal set)
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
        return '<p class="muted">No delivery signals in this scan output.</p>';
      }

      return deliverySignals.map((sig) => {
        const name = String(sig.label || sig.id || "Signal");
        const score = asInt(sig.score, "—");

        const key = safeSignalKey(sig);
        const lines = key && narrSignals && narrSignals[key] ? lineify(narrSignals[key].lines) : [];
        const narr =
          lines.length
            ? "<ul>" + lines.slice(0, 3).map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>"
            : '<p class="muted">No signal narrative available for this report.</p>';

        return (
          '<div class="signal">' +
            '<p><strong>' + esc(name) + ":</strong> " + esc(score) + "</p>" +
            narr +
          "</div>"
        );
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

        // keep it controlled so PDF doesn’t explode
        const obsRows = obs.slice(0, 16).map((o) => {
          const v = (o.value === null) ? "null" : (typeof o.value === "undefined") ? "—" : String(o.value);
          return "<tr><td class=\"key\">" + esc(o.label) + "</td><td class=\"val\">" + esc(v) + "</td></tr>";
        }).join("");

        const issues = Array.isArray(sig.issues) ? sig.issues : [];
        const issuesHtml = issues.length
          ? "<ul>" +
              issues.slice(0, 8).map((it) => {
                const t = it && it.title ? String(it.title) : "Issue";
                const impact = it && (it.impact || it.description) ? String(it.impact || it.description) : "—";
                return "<li><strong>" + esc(t) + "</strong> — " + esc(impact) + "</li>";
              }).join("") +
            "</ul>"
          : "<ul><li>No issues detected for this signal.</li></ul>";

        return (
          '<div class="evidence-signal">' +
            "<h3>" + esc(name) + " (" + esc(score) + ")</h3>" +
            "<h3>Observations</h3>" +
            "<table>" +
              "<thead><tr><th>Observation</th><th>Value</th></tr></thead>" +
              "<tbody>" + (obsRows || "<tr><td class=\"key\">—</td><td class=\"val\">—</td></tr>") + "</tbody>" +
            "</table>" +
            "<h3>Issues</h3>" +
            issuesHtml +
          "</div>"
        );
      }).join("");
    })();

    // ---- Key Insight Metrics (derived) ----
    const insight = (() => {
      const scored = deliverySignals
        .map((s) => ({ label: String(s.label || s.id || "Signal"), score: Number(s.score) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score);

      const weakest = scored.length ? scored[0] : null;
      const strongest = scored.length ? scored[scored.length - 1] : null;

      return {
        strength: strongest
          ? (strongest.label + " is the strongest measured area in this scan.")
          : "Strength insight not available from this scan output.",
        risk: weakest
          ? (weakest.label + " is the most constrained measured area in this scan.")
          : "Risk insight not available from this scan output.",
        focus: weakest
          ? ("Focus: start with " + weakest.label + " first for highest leverage.")
          : "Focus: address the lowest scoring areas first for highest leverage.",
        next:
          "Next: apply the changes you choose, then re-run the scan to confirm measurable improvement.",
      };
    })();

    // ---- Top Issues Detected (flatten + de-dupe) ----
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

      if (!all.length) {
        return "<p class=\"muted\">No issue list available from this scan output yet.</p>";
      }

      const seen = {};
      const uniq = [];
      for (const item of all) {
        const key = item.title.toLowerCase();
        if (seen[key]) continue;
        seen[key] = true;
        uniq.push(item);
        if (uniq.length >= 8) break;
      }

      function badgeLabel(sev) {
        const s = String(sev || "").toLowerCase();
        if (s.includes("high") || s.includes("critical")) return "High leverage";
        if (s.includes("med") || s.includes("warn")) return "Worth addressing";
        return "Monitor";
      }

      return uniq.map((x) => {
        return (
          "<p><strong>" + esc(x.title) + "</strong> — " + esc(x.why) +
          " <span class=\"muted\">(" + esc(badgeLabel(x.severity)) + ")</span></p>"
        );
      }).join("");
    })();

    // ---- Fix Sequence ----
    const fixSequenceSummary = (() => {
      const scored = deliverySignals
        .map((s) => ({ label: String(s.label || s.id || "Signal"), score: Number(s.score) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score);

      const a = scored[0] ? scored[0].label : null;
      const b = scored[1] ? scored[1].label : null;

      if (a && b) return "Suggested order (from this scan): start with " + a + " + " + b + ", then re-run the scan.";
      if (a) return "Suggested order (from this scan): start with " + a + ", then re-run the scan.";
      return "Suggested order: start with the lowest scoring areas first, then re-run the scan.";
    })();

    const fixSequenceList = (() => {
      const scored = deliverySignals
        .map((s) => ({ label: String(s.label || s.id || "Signal"), score: Number(s.score) }))
        .filter((x) => Number.isFinite(x.score))
        .sort((a, b) => a.score - b.score);

      if (!scored.length) return "";

      return "<ol>" + scored.slice(0, 6).map((x) => "<li>" + esc(x.label) + "</li>").join("") + "</ol>";
    })();

    // ---- Final Notes ----
    const finalNotesHtml = (() => {
      return (
        "<p>This report is a diagnostic snapshot based on measurable signals captured during this scan. Where iQWEB cannot measure a signal reliably, it shows “Not available” rather than guess.</p>" +
        "<p>Trust matters: scan output is used to generate this report and is not sold. Payment details are handled by the payment provider and are not stored in iQWEB.</p>"
      );
    })();

    // ---- Load template (controls layout) ----
    const templatePath = path.join(__dirname, "templates", "report_pdf.html");
    let tpl = "";
    try {
      tpl = fs.readFileSync(templatePath, "utf8");
    } catch (e) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
        body:
          "Missing PDF template file. Expected: " + templatePath +
          "\n\nEnsure report_pdf.html exists at: netlify/functions/templates/report_pdf.html",
      };
    }

    function replaceAll(str, token, value) {
      return String(str).split(token).join(value);
    }

    // ---- Fill placeholders ----
    let out = tpl;

    out = replaceAll(out, "{{website_url}}", esc(header.website || ""));
    out = replaceAll(out, "{{report_id}}", esc(header.report_id || reportId));
    out = replaceAll(out, "{{report_date}}", esc(header.created_at || ""));

    out = replaceAll(out, "{{executive_narrative}}", executiveNarrativeHtml);

    out = replaceAll(out, "{{overall_score}}", esc(asInt(scores.overall, "—")));
    out = replaceAll(out, "{{overall_delivery_note}}", esc("Overall delivery score (deterministic checks)."));

    out = replaceAll(out, "{{delivery_signals}}", deliverySignalsHtml);
    out = replaceAll(out, "{{signal_evidence}}", signalEvidenceHtml);

    out = replaceAll(out, "{{insight_strength}}", esc(insight.strength));
    out = replaceAll(out, "{{insight_risk}}", esc(insight.risk));
    out = replaceAll(out, "{{insight_focus}}", esc(insight.focus));
    out = replaceAll(out, "{{insight_next}}", esc(insight.next));

    out = replaceAll(out, "{{top_issues}}", topIssuesHtml);

    out = replaceAll(out, "{{fix_sequence_summary}}", esc(fixSequenceSummary));
    out = replaceAll(out, "{{fix_sequence_list}}", fixSequenceList);

    out = replaceAll(out, "{{final_notes}}", finalNotesHtml);

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
      body: out,
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
