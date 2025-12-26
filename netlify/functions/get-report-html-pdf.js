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
      });
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

    // ---- Robust signal discovery ----
    function pickSignals(j) {
      const candidates = [
        j?.delivery_signals,
        j?.deliverySignals,
        j?.signals,
        j?.delivery?.signals,
        j?.delivery?.delivery_signals,
      ];
      for (const c of candidates) {
        if (Array.isArray(c) && c.length) return c;
      }
      return [];
    }

    // Map signal -> canonical key
    function safeSignalKey(sig) {
      const id = String((sig && (sig.id || sig.key || sig.label || sig.name)) || "").toLowerCase();
      if (id.includes("perf")) return "performance";
      if (id.includes("mobile")) return "mobile";
      if (id.includes("seo")) return "seo";
      if (id.includes("sec") || id.includes("trust")) return "security";
      if (id.includes("struct") || id.includes("semantic")) return "structure";
      if (id.includes("access")) return "accessibility";
      return null;
    }

    // Find the best matching narrative key inside an object by substring
    function findKeyByHint(obj, hints) {
      if (!obj || typeof obj !== "object") return null;
      const keys = Object.keys(obj);
      const lower = keys.map((k) => [k, String(k).toLowerCase()]);
      for (const h of hints) {
        const hh = String(h).toLowerCase();
        const hit = lower.find(([, lk]) => lk === hh);
        if (hit) return hit[0];
      }
      for (const h of hints) {
        const hh = String(h).toLowerCase();
        const hit = lower.find(([, lk]) => lk.includes(hh));
        if (hit) return hit[0];
      }
      return null;
    }

    function getNarrativeBundle(narrativeObj) {
      // common buckets we might store signal narratives under
      return {
        signals: narrativeObj?.signals,
        delivery_signals: narrativeObj?.delivery_signals,
        deliverySignals: narrativeObj?.deliverySignals,
        cards: narrativeObj?.cards,
      };
    }

    // Pull signal narrative from signal object OR any narrative bundle bucket.
    // If none exists -> [] (render nothing).
    function getSignalNarrativeLines(sig, narrativeObj) {
      // 1) Signal object may already carry the narrative (OSD-style)
      const direct =
        sig?.narrative?.lines ||
        sig?.narrative ||
        sig?.summary?.lines ||
        sig?.summary ||
        sig?.text?.lines ||
        sig?.text ||
        sig?.description?.lines ||
        sig?.description ||
        sig?.notes?.lines ||
        sig?.notes ||
        sig?.message?.lines ||
        sig?.message;

      const directLines = lineify(direct);
      if (directLines.length) return directLines;

      // 2) Otherwise hunt in narrative bundles
      const key = safeSignalKey(sig);
      if (!key) return [];

      const bundles = getNarrativeBundle(narrativeObj);

      const hintMap = {
        performance: ["performance", "perf"],
        mobile: ["mobile", "mobile_experience", "mobileexperience"],
        seo: ["seo", "seo_foundations", "seofoundations"],
        security: ["security", "security_trust", "security&trust", "trust"],
        structure: ["structure", "structure_semantics", "structure&semantics", "semantics"],
        accessibility: ["accessibility", "a11y", "access"],
      };

      const hints = hintMap[key] || [key];

      // check each bucket (signals/delivery_signals/cards) for a matching key
      for (const bucketName of Object.keys(bundles)) {
        const bucket = bundles[bucketName];
        if (!bucket || typeof bucket !== "object") continue;

        const matchKey = findKeyByHint(bucket, hints);
        if (!matchKey) continue;

        const candidate = bucket[matchKey];
        const lines = lineify(candidate?.lines || candidate);
        if (lines.length) return lines;
      }

      return [];
    }

    // Force stable signal order (doctor-report consistency)
    const SIGNAL_ORDER = ["performance", "mobile", "seo", "security", "structure", "accessibility"];
    function sortSignals(list) {
      const arr = Array.isArray(list) ? list.slice() : [];
      arr.sort((a, b) => {
        const ka = safeSignalKey(a);
        const kb = safeSignalKey(b);
        const ia = ka ? SIGNAL_ORDER.indexOf(ka) : 999;
        const ib = kb ? SIGNAL_ORDER.indexOf(kb) : 999;
        if (ia !== ib) return ia - ib;
        return String(a?.label || a?.name || a?.id || "").localeCompare(String(b?.label || b?.name || b?.id || ""));
      });
      return arr;
    }

    // ---- Data ----
    const header = json?.header || {};
    const narrativeObj = json?.narrative || null;

    const deliverySignalsRaw = pickSignals(json);
    const deliverySignals = sortSignals(deliverySignalsRaw);

    // ---- Executive Narrative ----
    const execLines = narrativeObj?.overall?.lines || null;
    const executiveNarrativeHtml = (() => {
      const lines = lineify(execLines);
      if (!lines.length) return "";
      return "<ul>" + lines.map((ln) => "<li>" + esc(ln) + "</li>").join("") + "</ul>";
    })();

    // ---- Delivery Signals (render ONLY signals that have narrative) ----
    const deliverySignalsHtml = (() => {
      if (!deliverySignals.length) return "";

      const blocks = deliverySignals
        .map((sig) => {
          const name = String(sig?.label || sig?.name || sig?.id || "Signal");
          const score = asInt(sig?.score, "");

          const lines = getSignalNarrativeLines(sig, narrativeObj);
          if (!lines.length) return ""; // your rule: narrative or nothing

          const narr = lines.slice(0, 3).map((ln) => `<p class="sig-narr">${esc(ln)}</p>`).join("");

          return `
            <div class="sig">
              <div class="sig-head">
                <div class="sig-name">${esc(name)}</div>
                <div class="sig-score">${esc(score)}</div>
              </div>
              ${narr}
            </div>
          `;
        })
        .filter(Boolean);

      if (!blocks.length) return "";
      return blocks.join("");
    })();

    // ---- Signal Evidence ----
    const signalEvidenceHtml = (() => {
      if (!deliverySignals.length) return "";

      const blocks = deliverySignals
        .map((sig) => {
          const name = String(sig?.label || sig?.name || sig?.id || "Signal").trim();
          const rows = buildEvidenceRows(sig);
          if (!rows.length) return ""; // no fallback

          const trs = rows
            .slice(0, 30)
            .map((r) => `<tr><td class="m">${esc(r.k)}</td><td class="val">${esc(r.v)}</td></tr>`)
            .join("");

          return `
            <div class="ev-block">
              <h3 class="ev-title">Signal Evidence — ${esc(name)}</h3>
              <table class="tbl">
                <thead>
                  <tr><th>Metric</th><th>Value</th></tr>
                </thead>
                <tbody>${trs}</tbody>
              </table>
            </div>
          `;
        })
        .filter(Boolean);

      if (!blocks.length) return "";
      return blocks.join("");
    })();

    // ---- Print CSS (simple + clinical) ----
    const css = `
      @page { size: A4; margin: 14mm; }
      * { box-sizing: border-box; }
      body { font-family: Arial, Helvetica, sans-serif; color: #111; }
      h2 { font-size: 13px; margin: 18px 0 8px; border-bottom: 1px solid #ddd; padding-bottom: 6px; }
      h3 { font-size: 12px; margin: 14px 0 8px; }
      p, li { font-size: 10.5px; line-height: 1.35; }
      .muted { color: #666; }

      .topbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
      .brand { font-weight: 700; font-size: 14px; }
      .meta { font-size: 10px; text-align: right; line-height: 1.3; }
      .brand-block { font-size: 10px; line-height: 1.3; }
      .hr { border-top: 1px solid #ddd; margin: 12px 0 12px; }

      .sig { border: 1px solid #e5e5e5; border-radius: 8px; padding: 10px; margin: 10px 0; page-break-inside: avoid; }
      .sig-head { display: flex; justify-content: space-between; align-items: baseline; }
      .sig-name { font-weight: 700; font-size: 11px; }
      .sig-score { font-weight: 700; font-size: 13px; }
      .sig-narr { margin: 6px 0 0; }

      .ev-block { margin: 14px 0; page-break-inside: avoid; }
      .ev-title { margin: 0 0 8px; font-size: 12px; font-weight: 700; }

      .tbl { width: 100%; border-collapse: collapse; }
      .tbl th { text-align: left; font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #ddd; }
      .tbl td { font-size: 10px; padding: 7px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
      .tbl .m { width: 55%; }
      .tbl .val { width: 45%; word-break: break-word; }

      .footer { margin-top: 16px; font-size: 9px; color: #666; display: flex; justify-content: space-between; }
    `;

    // ---- Sections: only output a section if it has cntent ----
    const executiveSection = executiveNarrativeHtml
      ? `<h2>Executive Narrative</h2>${executiveNarrativeHtml}`
      : "";

    const deliverySection = deliverySignalsHtml
      ? `<h2>Delivery Signals</h2>${deliverySignalsHtml}`
      : "";

    const evidenceSection = signalEvidenceHtml
      ? `<h2>Signal Evidence</h2>${signalEvidenceHtml}`
      : "";

    const website = header.website || header.url || header.site || "";

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
    <div class="brand-block">
      <div class="brand">iQWEB</div>
      <div class="muted">Powered by Λ i Q™</div>
      ${website ? `<div><strong>Website:</strong> ${esc(website)}</div>` : ""}
    </div>
    <div class="meta">
      <div><strong>Report ID:</strong> ${esc(header.report_id || reportId)}</div>
      <div><strong>Report Date:</strong> ${esc(formatDateTime(header.created_at))}</div>
    </div>
  </div>

  <div class="hr"></div>

  ${executiveSection}
  ${deliverySection}
  ${evidenceSection}

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
