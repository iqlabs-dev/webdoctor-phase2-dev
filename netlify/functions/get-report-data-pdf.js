// netlify/functions/get-report-html-pdf.js
// Full PDF HTML renderer (server-side, DocRaptor/print safe)
//
// Inputs:
//   GET /.netlify/functions/get-report-html-pdf?report_id=WEB-xxxx
//
// Dependencies:
//   - Uses your existing JSON endpoint:
//       /.netlify/functions/get-report-data-pdf?report_id=...
//     which returns:
//       { success, header, scores, narrative, raw }
//
// Output:
//   - Returns text/html with a full print-first report.
//   - Renders: Header, Exec Narrative, Key Metrics, Top Issues, Fix Sequence,
//              Delivery Signals (7), Evidence tables, Final Notes, Footer.
//
// Notes:
//   - No JS required in output HTML.
//   - Deterministic "Top Issues" + "Fix Sequence" derived from evidence & scores.
//   - Signal narratives are deterministic summaries tied to evidence and score.

exports.handler = async (event) => {
  // CORS / preflight
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

  try {
    if (event.httpMethod !== "GET") {
      return json(405, { error: "Method not allowed" }, { Allow: "GET, OPTIONS" });
    }

    const reportId = (event.queryStringParameters?.report_id || event.queryStringParameters?.reportId || "").trim();
    if (!reportId) return json(400, { error: "Missing report_id" });

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const srcUrl = `${siteUrl}/.netlify/functions/get-report-data-pdf?report_id=${encodeURIComponent(reportId)}`;

    const resp = await fetch(srcUrl, { method: "GET", headers: { Accept: "application/json" } });
    const text = await resp.text().catch(() => "");
    if (!resp.ok) {
      return json(500, { error: "Upstream get-report-data-pdf failed", status: resp.status, details: text });
    }

    let data = {};
    try {
      data = JSON.parse(text || "{}");
    } catch {
      return json(500, { error: "Upstream returned non-JSON", details: (text || "").slice(0, 500) });
    }

    if (!data?.success) return json(500, { error: "Upstream success=false", details: data });

    const header = safeObj(data.header);
    const scores = normalizeScores(data.scores);
    const narrativeOverallLines = asLines(data?.narrative?.overall?.lines);

    // Evidence source: prefer raw.report / raw.evidence / raw.signals depending on your existing endpoint
    const raw = safeObj(data.raw);
    const evidence = extractEvidence(raw);

    // Build deterministic Top Issues + Fix Sequence
    const topIssues = buildTopIssues(scores, evidence);
    const fixSeq = buildFixSequence(scores, evidence);

    // Build deterministic signal narratives
    const signalNarratives = buildSignalNarratives(scores, evidence, narrativeOverallLines);

    const html = renderHtml({
      header,
      scores,
      narrativeOverallLines,
      topIssues,
      fixSeq,
      signalNarratives,
      evidence,
    });

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
    console.error("[get-report-html-pdf] crash:", err);
    return json(500, { error: err?.message || "Unknown error" });
  }
};

/* ---------------- helpers ---------------- */

function json(statusCode, obj, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      ...extraHeaders,
    },
    body: JSON.stringify(obj),
  };
}

function safeObj(v) {
  return v && typeof v === "object" ? v : {};
}
function asLines(v) {
  if (!v) return [];
  if (Array.isArray(v)) return v.filter(Boolean).map((x) => String(x).trim()).filter(Boolean);
  if (typeof v === "string") return v.split("\n").map((s) => s.trim()).filter(Boolean);
  if (typeof v === "object" && Array.isArray(v.lines)) return asLines(v.lines);
  return [];
}
function clampScore(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return null;
  return Math.max(0, Math.min(100, Math.round(x)));
}

function normalizeScores(scoresIn) {
  const s = safeObj(scoresIn);
  return {
    overall: clampScore(s.overall),
    performance: clampScore(s.performance),
    mobile: clampScore(s.mobile),
    seo: clampScore(s.seo),
    security: clampScore(s.security),
    structure: clampScore(s.structure),
    accessibility: clampScore(s.accessibility),
  };
}

/**
 * Attempts to extract evidence buckets in a stable, printable way.
 * Returns:
 * {
 *   performance: { key: value, ... },
 *   mobile: {...},
 *   seo: {...},
 *   security: {...},
 *   structure: {...},
 *   accessibility: {...},
 * }
 */
function extractEvidence(raw) {
  // Most common shapes we’ve seen in your builds:
  // raw.evidence.performance, raw.report.evidence.performance,
  // raw.signals.performance.evidence, raw.report.signals.performance.evidence, etc.
  const buckets = {
    performance: {},
    mobile: {},
    seo: {},
    security: {},
    structure: {},
    accessibility: {},
  };

  const candidates = [
    raw?.evidence,
    raw?.report?.evidence,
    raw?.signals,
    raw?.report?.signals,
    raw?.metrics,
    raw?.report?.metrics,
  ].filter(Boolean);

  // Helper: map many possible key names into our canonical buckets
  const mapKey = (k) => {
    const key = String(k || "").toLowerCase();
    if (key.includes("perf")) return "performance";
    if (key.includes("mobile")) return "mobile";
    if (key.includes("seo")) return "seo";
    if (key.includes("security") || key.includes("trust")) return "security";
    if (key.includes("structure") || key.includes("semantic")) return "structure";
    if (key.includes("access")) return "accessibility";
    return null;
  };

  for (const cand of candidates) {
    // If cand is a "signals" object, evidence may live under each signal
    for (const [k, v] of Object.entries(safeObj(cand))) {
      const canon = mapKey(k);
      if (!canon) continue;

      // value could be: { evidence: {...} } OR evidence directly
      const obj = safeObj(v);
      const ev = safeObj(obj.evidence || obj.evidence_data || obj.metrics || obj);
      // Flatten only primitives for table readability
      buckets[canon] = { ...buckets[canon], ...flattenEvidence(ev) };
    }
  }

  return buckets;
}

function flattenEvidence(obj) {
  const out = {};
  for (const [k, v] of Object.entries(safeObj(obj))) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
      out[humanizeKey(k)] = String(v);
    } else if (Array.isArray(v)) {
      out[humanizeKey(k)] = v.filter((x) => x != null).map(String).join(", ");
    } else if (typeof v === "object") {
      // shallow flatten one level if small
      const inner = Object.entries(v);
      if (inner.length && inner.length <= 6 && inner.every(([, iv]) => ["string","number","boolean"].includes(typeof iv))) {
        out[humanizeKey(k)] = inner.map(([ik, iv]) => `${humanizeKey(ik)}: ${String(iv)}`).join(" | ");
      } else {
        // avoid dumping huge nested objects
        out[humanizeKey(k)] = "[object]";
      }
    }
  }
  return out;
}

function humanizeKey(k) {
  return String(k)
    .replace(/[_\-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function scoreBand(score) {
  if (score === null) return "unknown";
  if (score >= 90) return "excellent";
  if (score >= 75) return "good";
  if (score >= 55) return "fair";
  return "weak";
}

function buildTopIssues(scores, evidence) {
  const issues = [];

  // Security: missing key headers
  const sec = evidence.security || {};
  const csp = asBool(sec["Csp Present"] ?? sec["CSP Present"] ?? sec["Content Security Policy Present"]);
  const xfo = asBool(sec["X Frame Options Present"] ?? sec["X-Frame-Options Present"]);
  const perm = asBool(sec["Permissions Policy Present"] ?? sec["Permissions-Policy Present"]);
  if (scores.security !== null && scores.security < 70) {
    if (!csp) issues.push("Missing Content-Security-Policy (CSP).");
    if (!xfo) issues.push("Missing X-Frame-Options (clickjacking protection).");
    if (!perm) issues.push("Missing Permissions-Policy (browser capability restrictions).");
  }

  // SEO: H1 / robots
  const seo = evidence.seo || {};
  const h1Count = num(seo["H1 Count"]);
  const robotsMeta = asBool(seo["Robots Meta Present"]);
  if (scores.seo !== null && scores.seo < 85) {
    if (h1Count !== null && h1Count === 0) issues.push("No H1 heading detected (page clarity + SEO structure).");
    if (!robotsMeta) issues.push("Robots meta tag not detected (indexing directives unclear).");
  }

  // Accessibility: empty links / buttons
  const acc = evidence.accessibility || {};
  const emptyLinks = num(acc["Empty Links Detected"]);
  const emptyButtons = num(acc["Empty Buttons Detected"]);
  if (scores.accessibility !== null && scores.accessibility < 92) {
    if (emptyLinks !== null && emptyLinks > 0) issues.push(`Empty link elements detected (${emptyLinks}).`);
    if (emptyButtons !== null && emptyButtons > 0) issues.push(`Empty button elements detected (${emptyButtons}).`);
  }

  // Performance: script bloat
  const perf = evidence.performance || {};
  const inlineScripts = num(perf["Inline Script Count"]);
  const htmlBytes = num(perf["Html Bytes"]);
  if (scores.performance !== null && scores.performance < 70) {
    if (inlineScripts !== null && inlineScripts > 25) issues.push(`High inline script count (${inlineScripts}) may impact load/TTI.`);
    if (htmlBytes !== null && htmlBytes > 400000) issues.push("Large HTML payload may slow first render.");
  }

  // Structure: H1/required inputs missing
  const str = evidence.structure || {};
  const reqMissing = asBool(str["Required Inputs Missing"]);
  if (reqMissing) issues.push("Required input elements appear missing (form reliability risk).");

  // If nothing specific found, keep it honest
  if (!issues.length) {
    issues.push("No high-severity structured issues detected from the available scan evidence.");
  }

  // Cap it to keep report tidy
  return issues.slice(0, 6);
}

function buildFixSequence(scores, evidence) {
  const seq = [];

  // Always prioritize security baselines if security is weak or headers missing
  const sec = evidence.security || {};
  const csp = asBool(sec["Csp Present"] ?? sec["CSP Present"]);
  const xfo = asBool(sec["X Frame Options Present"] ?? sec["X-Frame-Options Present"]);
  const perm = asBool(sec["Permissions Policy Present"] ?? sec["Permissions-Policy Present"]);
  const securityNeeds = (scores.security !== null && scores.security < 80) || (!csp || !xfo || !perm);
  if (securityNeeds) seq.push("Security headers + policy baselines (CSP, X-Frame-Options, Permissions-Policy).");

  // SEO structure
  const seo = evidence.seo || {};
  const h1Count = num(seo["H1 Count"]);
  const robotsMeta = asBool(seo["Robots Meta Present"]);
  const seoNeeds = (scores.seo !== null && scores.seo < 90) && ((h1Count !== null && h1Count === 0) || !robotsMeta);
  if (seoNeeds) seq.push("SEO foundations (H1 presence, robots meta, canonical consistency).");

  // Accessibility quick wins
  const acc = evidence.accessibility || {};
  const emptyLinks = num(acc["Empty Links Detected"]);
  const emptyButtons = num(acc["Empty Buttons Detected"]);
  const accNeeds = (scores.accessibility !== null && scores.accessibility < 95) && ((emptyLinks || 0) > 0 || (emptyButtons || 0) > 0);
  if (accNeeds) seq.push("Accessibility quick wins (empty links/buttons, labels, focus targets).");

  // Performance stabilization
  if (scores.performance !== null && scores.performance < 80) seq.push("Performance stabilization (reduce payload bloat; tame inline script count).");

  // Structure semantics
  if (scores.structure !== null && scores.structure < 85) seq.push("Structure + semantics (document hierarchy and markup clarity).");

  // Mobile is often fine; keep as validation step
  seq.push("Mobile experience validation (re-test after changes).");

  // Keep it numbered and tight
  return seq.slice(0, 6);
}

function buildSignalNarratives(scores, evidence, overallNarrativeLines) {
  const makeLines = (arr, max = 2) =>
    arr.filter(Boolean).map((s) => String(s).trim()).filter(Boolean).slice(0, max);

  const overall = makeLines(
    overallNarrativeLines.length
      ? overallNarrativeLines
      : [
          "The delivery across signals shows a mix of strengths and weaknesses.",
          "Prioritize the lowest-scoring categories first to improve overall reliability.",
        ],
    3
  );

  // Per-signal deterministic narratives
  const perfLines = [];
  if (scores.performance === null) perfLines.push("Performance data was not available for this scan.");
  else if (scores.performance >= 85) perfLines.push("Performance delivery appears strong with no major bottlenecks detected.");
  else {
    const inlineScripts = num((evidence.performance || {})["Inline Script Count"]);
    if (inlineScripts !== null && inlineScripts > 25) perfLines.push("High script density may be contributing to slower interaction readiness.");
    perfLines.push("Reducing payload and script overhead is the fastest path to improvement.");
  }

  const mobLines = [];
  if (scores.mobile === null) mobLines.push("Mobile experience data was not available for this scan.");
  else if (scores.mobile >= 90) mobLines.push("Mobile experience appears robust and well-optimized for typical devices.");
  else mobLines.push("Mobile experience shows room for improvement; re-test after core fixes.");

  const seoLines = [];
  if (scores.seo === null) seoLines.push("SEO data was not available for this scan.");
  else if (scores.seo >= 90) seoLines.push("SEO foundations are largely in place with strong baseline signals.");
  else {
    const h1Count = num((evidence.seo || {})["H1 Count"]);
    if (h1Count === 0) seoLines.push("Missing H1 structure can reduce clarity for both users and search engines.");
    seoLines.push("Tightening page structure and indexing signals is the next best step.");
  }

  const secLines = [];
  if (scores.security === null) secLines.push("Security signals were not available for this scan.");
  else if (scores.security >= 85) secLines.push("Security baselines look reasonable with no major exposure flags detected.");
  else {
    secLines.push("Several protection headers appear missing, increasing baseline risk.");
    secLines.push("Implementing modern security headers is a high-impact, low-effort improvement.");
  }

  const strLines = [];
  if (scores.structure === null) strLines.push("Structure & semantics data was not available for this scan.");
  else if (scores.structure >= 85) strLines.push("Structural organization looks adequate with clear markup foundations.");
  else strLines.push("Document structure appears inconsistent; improving hierarchy will lift multiple signals.");

  const accLines = [];
  if (scores.accessibility === null) accLines.push("Accessibility data was not available for this scan.");
  else if (scores.accessibility >= 90) accLines.push("Accessibility is in a healthy state with only minor clean-up opportunities.");
  else {
    const emptyLinks = num((evidence.accessibility || {})["Empty Links Detected"]);
    if ((emptyLinks || 0) > 0) accLines.push("Empty interactive elements can confuse assistive technology and keyboard users.");
    accLines.push("Fixing interactive labels/targets is a quick win that improves usability for everyone.");
  }

  return {
    overall,
    signals: {
      overall: makeLines(overall, 3),
      performance: makeLines(perfLines, 2),
      mobile: makeLines(mobLines, 2),
      seo: makeLines(seoLines, 2),
      security: makeLines(secLines, 2),
      structure: makeLines(strLines, 2),
      accessibility: makeLines(accLines, 2),
    },
  };
}

function asBool(v) {
  if (v === true || v === false) return v;
  if (v == null) return null;
  const s = String(v).trim().toLowerCase();
  if (["true", "1", "yes", "present"].includes(s)) return true;
  if (["false", "0", "no", "missing", "absent"].includes(s)) return false;
  return null;
}
function num(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderHtml(ctx) {
  const website = esc(ctx.header.website || "");
  const reportId = esc(ctx.header.report_id || "");
  const createdAt = esc(ctx.header.created_at || "");

  const scores = ctx.scores || {};
  const sRow = (label, val) =>
    `<tr><td class="k">${esc(label)}</td><td class="v">${val == null ? "—" : esc(val)}</td></tr>`;

  const execNarr = (ctx.narrativeOverallLines || []).slice(0, 5);
  const execBullets = execNarr.length
    ? execNarr.map((l) => `<li>${esc(l)}</li>`).join("")
    : `<li>The delivery across signals shows a mix of strengths and weaknesses.</li>
       <li>Focus first on the lowest scoring categories to reduce risk.</li>`;

  const topIssuesHtml = (ctx.topIssues || [])
    .map((x) => `<li>${esc(x)}</li>`)
    .join("");

  const fixSeqHtml = (ctx.fixSeq || [])
    .map((x, i) => `<li><span class="n">${i + 1}.</span> ${esc(x)}</li>`)
    .join("");

  const sig = ctx.signalNarratives?.signals || {};
  const card = (title, score, lines) => {
    const scoreTxt = score == null ? "—" : String(score);
    const linesHtml = (lines || []).map((l) => `<div class="line">${esc(l)}</div>`).join("");
    return `
      <div class="card">
        <div class="cardHead">
          <div class="cardTitle">${esc(title)}</div>
          <div class="cardScore">${esc(scoreTxt)}</div>
        </div>
        <div class="cardBody">${linesHtml || `<div class="muted">No narrative available.</div>`}</div>
      </div>
    `;
  };

  const evidenceSections = [
    ["Performance", ctx.evidence?.performance || {}],
    ["Mobile Experience", ctx.evidence?.mobile || {}],
    ["SEO Foundations", ctx.evidence?.seo || {}],
    ["Security & Trust", ctx.evidence?.security || {}],
    ["Structure & Semantics", ctx.evidence?.structure || {}],
    ["Accessibility", ctx.evidence?.accessibility || {}],
  ];

  const evidenceHtml = evidenceSections
    .map(([name, obj]) => {
      const entries = Object.entries(obj || {});
      if (!entries.length) {
        return `
          <div class="evBlock">
            <div class="h3">Evidence — ${esc(name)}</div>
            <div class="muted">No structured evidence available for this section.</div>
          </div>
        `;
      }

      const rows = entries
        .slice(0, 60) // prevent massive dumps
        .map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`)
        .join("");

      return `
        <div class="evBlock">
          <div class="h3">Evidence — ${esc(name)}</div>
          <table class="tbl">
            <thead><tr><th>Metric</th><th>Value</th></tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    })
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>iQWEB Website Report — ${reportId}</title>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  /* Print-first */
  @page { size: A4; margin: 18mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    color: #111;
    background: #fff;
    font-size: 12px;
    line-height: 1.35;
  }
  .wrap { max-width: 780px; margin: 0 auto; }

  /* Header */
  .top {
    display: flex; justify-content: space-between; align-items: flex-start;
    padding: 18px 0 10px 0; border-bottom: 1px solid #ddd;
  }
  .brand { font-weight: 700; font-size: 14px; }
  .sub { color: #555; font-size: 11px; margin-top: 2px; }
  .meta { text-align: right; font-size: 11px; color: #333; }
  .meta b { font-weight: 700; }
  .hr { border-top: 1px solid #e2e2e2; margin: 14px 0; }

  /* Section headings */
  .h2 { font-weight: 700; font-size: 13px; margin: 14px 0 6px; }
  .h3 { font-weight: 700; font-size: 12px; margin: 10px 0 6px; }
  .rule { border-top: 1px solid #e6e6e6; margin: 6px 0 10px; }

  /* Bullets */
  ul { margin: 6px 0 0 16px; }
  li { margin: 3px 0; }

  /* Tables */
  table { width: 100%; border-collapse: collapse; }
  .tbl th {
    text-align: left;
    font-weight: 700;
    padding: 8px 10px;
    border-bottom: 1px solid #ddd;
    font-size: 11px;
    color: #222;
  }
  .tbl td {
    padding: 7px 10px;
    border-bottom: 1px solid #eee;
    vertical-align: top;
    font-size: 11px;
  }
  .tbl td.k { width: 62%; color: #111; }
  .tbl td.v { width: 38%; text-align: left; color: #111; }

  /* Cards */
  .cards { display: grid; grid-template-columns: 1fr; gap: 10px; margin-top: 8px; }
  .card {
    border: 1px solid #e3e3e3;
    border-radius: 8px;
    padding: 10px 12px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .cardHead { display:flex; justify-content: space-between; align-items: baseline; }
  .cardTitle { font-weight: 700; font-size: 12px; }
  .cardScore { font-weight: 700; font-size: 12px; }
  .cardBody { margin-top: 6px; color:#222; font-size: 11px; }
  .line { margin: 2px 0; }
  .muted { color:#666; font-size: 11px; }

  /* Numbered list for fix seq */
  .fix li { list-style: none; margin-left: 0; }
  .fix .n { display:inline-block; width: 18px; font-weight: 700; }

  /* Evidence blocks */
  .evBlock { margin-top: 10px; break-inside: avoid; page-break-inside: avoid; }
  .evBlock .tbl td.k { width: 55%; }
  .evBlock .tbl td.v { width: 45%; }

  /* Footer */
  .footer {
    display:flex; justify-content: space-between; align-items:center;
    margin-top: 14px; padding-top: 10px; border-top: 1px solid #ddd;
    color:#555; font-size: 10px;
  }

  /* Keep headings with their content */
  .keep { break-inside: avoid; page-break-inside: avoid; }

</style>
</head>
<body>
  <div class="wrap">

    <div class="top">
      <div>
        <div class="brand">iQWEB</div>
        <div class="sub">Powered by Λ i Q™</div>
        <div class="sub">Website: ${website}</div>
      </div>
      <div class="meta">
        <div><b>Report ID:</b> ${reportId}</div>
        <div><b>Report Date:</b> ${createdAt || "—"}</div>
      </div>
    </div>

    <div class="h2">Executive Narrative</div>
    <div class="rule"></div>
    <ul>${execBullets}</ul>

    <div class="h2">Key Insight Metrics</div>
    <div class="rule"></div>
    <table class="tbl">
      <thead><tr><th>Metric</th><th>Value</th></tr></thead>
      <tbody>
        ${sRow("Overall Delivery Score", scores.overall)}
        ${sRow("Performance Score", scores.performance)}
        ${sRow("Mobile Experience Score", scores.mobile)}
        ${sRow("SEO Foundations Score", scores.seo)}
        ${sRow("Security & Trust Score", scores.security)}
        ${sRow("Structure & Semantics Score", scores.structure)}
        ${sRow("Accessibility Score", scores.accessibility)}
      </tbody>
    </table>

    <div class="h2">Top Issues Detected</div>
    <div class="rule"></div>
    <ul>${topIssuesHtml}</ul>

    <div class="h2">Recommended Fix Sequence</div>
    <div class="rule"></div>
    <ul class="fix">${fixSeqHtml}</ul>

    <div class="h2">Delivery Signals</div>
    <div class="rule"></div>

    <div class="cards">
      ${card("Overall Delivery Score", scores.overall, sig.overall)}
      ${card("Performance", scores.performance, sig.performance)}
      ${card("Mobile Experience", scores.mobile, sig.mobile)}
      ${card("SEO Foundations", scores.seo, sig.seo)}
      ${card("Security & Trust", scores.security, sig.security)}
      ${card("Structure & Semantics", scores.structure, sig.structure)}
      ${card("Accessibility", scores.accessibility, sig.accessibility)}
    </div>

    <div class="h2">Evidence</div>
    <div class="rule"></div>
    ${evidenceHtml}

    <div class="h2">Final Notes</div>
    <div class="rule"></div>
    <ul>
      <li>This PDF reflects deterministic checks and extracted scan evidence only.</li>
      <li>Narrative lines are generated summaries tied to measured signals; treat them as diagnostic guidance, not absolute truth.</li>
      <li>Re-run the scan after changes to confirm improvements and catch regressions.</li>
    </ul>

    <div class="footer">
      <div>© 2025 iQWEB — All rights reserved.</div>
      <div>${reportId}</div>
    </div>

  </div>
</body>
</html>`;
}
