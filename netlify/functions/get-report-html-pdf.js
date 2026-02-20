// netlify/functions/get-report-html-pdf.js
import fetch from "node-fetch";

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function asText(v) {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  // handle {reason, title, label, ...}
  if (typeof v === "object") {
    return (
      v.reason ||
      v.title ||
      v.label ||
      v.code ||
      v.message ||
      JSON.stringify(v)
    );
  }
  return String(v);
}

function bulletList(lines) {
  const arr = Array.isArray(lines) ? lines : [];
  if (!arr.length) return "";
  return `<ul class="bullets">
    ${arr
      .map((l) => `<li>${escapeHtml(asText(l))}</li>`)
      .join("")}
  </ul>`;
}

function safeNum(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x : null;
}

function fmtScore(n) {
  const x = safeNum(n);
  return x == null ? "—" : String(Math.round(x));
}

function pickStrongWeak(scores) {
  const entries = [
    ["Performance", scores?.performance],
    ["Mobile Experience", scores?.mobile],
    ["SEO Foundations", scores?.seo],
    ["Security & Trust", scores?.security],
    ["Structure & Semantics", scores?.structure],
    ["Accessibility", scores?.accessibility],
  ].map(([k, v]) => [k, safeNum(v)]);

  const valid = entries.filter(([, v]) => v != null);
  if (!valid.length) return { strong: "", weak: "" };

  valid.sort((a, b) => b[1] - a[1]);
  const strong = `${valid[0][0]} (${Math.round(valid[0][1])}/100)`;
  const weak = `${valid[valid.length - 1][0]} (${Math.round(
    valid[valid.length - 1][1]
  )}/100)`;

  return { strong, weak };
}

function buildKeyInsights(payload) {
  const scores = payload?.scores || {};
  const { strong, weak } = pickStrongWeak(scores);

  // Prefer narrative primary constraint if present
  const primaryConstraint =
    payload?.narrative?._meta?.primary_constraint?.label ||
    payload?.narrative?._meta?.primary_constraint?.key ||
    "";

  const next =
    (payload?.fix_sequence && payload.fix_sequence[0]) ||
    payload?.narrative?.executive_narrative?.fix_order?.items?.[0]?.lines?.[0] ||
    "Start with the weakest measurable domain, then re-scan to confirm change.";

  return {
    strength: strong || "—",
    risk: weak ? `Main risk: ${weak}` : "—",
    focus: primaryConstraint ? `Primary constraint: ${primaryConstraint}` : "—",
    next: asText(next) || "—",
  };
}

function normalizeTopIssues(payload) {
  // payload.top_issues can be string[] or objects; also derive from delivery_signals issues
  const out = [];

  const ti = payload?.top_issues;
  if (Array.isArray(ti)) {
    for (const item of ti) {
      const txt = asText(item).trim();
      if (txt) out.push(txt);
    }
  }

  const ds = payload?.delivery_signals;
  if (Array.isArray(ds)) {
    for (const sig of ds) {
      const issues = sig?.issues;
      if (Array.isArray(issues)) {
        for (const iss of issues) {
          const txt = asText(iss?.reason || iss?.label || iss).trim();
          if (txt) out.push(`${sig?.label || sig?.id}: ${txt}`);
        }
      }
    }
  }

  // de-dupe
  return [...new Set(out)];
}

function normalizeSignals(payload) {
  const ds = payload?.delivery_signals;
  if (!Array.isArray(ds)) return [];
  // keep order overall first, then the rest
  const overall = ds.find((x) => x?.id === "overall") || null;
  const rest = ds.filter((x) => x?.id !== "overall");
  return overall ? [overall, ...rest] : rest;
}

function tableRowsFromObservations(observations) {
  const obs = Array.isArray(observations) ? observations : [];
  if (!obs.length) return `<tr><td colspan="3" class="muted">No evidence rows.</td></tr>`;

  return obs
    .map((o) => {
      const label = escapeHtml(asText(o?.label));
      const value = escapeHtml(asText(o?.value));
      const source = escapeHtml(asText(o?.source));
      return `<tr><td>${label}</td><td class="mono">${value}</td><td class="muted">${source}</td></tr>`;
    })
    .join("");
}

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(obj),
  };
}

function getBaseUrl(event) {
  if (process.env.URL) return process.env.URL;
  const proto = event.headers["x-forwarded-proto"] || "https";
  const host = event.headers.host;
  return `${proto}://${host}`;
}

export const handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return json(405, { success: false, error: "Method not allowed" });
    }

    const reportId = event.queryStringParameters?.report_id || "";
    if (!reportId) {
      return json(400, { success: false, error: "Missing report_id" });
    }

    const baseUrl = getBaseUrl(event);

    // Pull the same data your app uses
    const dataRes = await fetch(
      `${baseUrl}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(
        reportId
      )}`,
      { method: "GET" }
    );

    if (!dataRes.ok) {
      const txt = await dataRes.text().catch(() => "");
      console.error("[get-report-html-pdf] get-report-data failed:", dataRes.status, txt);
      return json(502, { success: false, error: "Failed to load report data" });
    }

    const payload = await dataRes.json();

    const header = payload?.header || {};
    const scores = payload?.scores || {};
    const narrative = payload?.narrative || {};
    const overallLines = narrative?.overall?.lines || [];
    const manifestation = narrative?.manifestation || {};
    const manifestationTitle = manifestation?.title || "How this shows up for users";
    const manifestationLines = manifestation?.lines || [];

    const insights = buildKeyInsights(payload);
    const topIssues = normalizeTopIssues(payload);
    const fixSequence = Array.isArray(payload?.fix_sequence) ? payload.fix_sequence : [];
    const signals = normalizeSignals(payload);

    const website = header?.website || "";
    const reportDate = header?.created_at || "";

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>iQWEB Website Report</title>
  <style>
    :root {
      --ink:#0b1220;
      --muted:#5b6474;
      --rule:#e6e8ee;
      --panel:#f7f8fb;
      --panel2:#ffffff;
      --accent:#127e7a;
    }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: var(--ink);
      margin: 0;
      padding: 28px 34px;
      background: #fff;
      line-height: 1.35;
      font-size: 12px;
    }
    h1 { font-size: 20px; margin: 0 0 6px; }
    h2 { font-size: 13px; margin: 18px 0 8px; letter-spacing: .04em; text-transform: uppercase; }
    h3 { font-size: 12px; margin: 14px 0 6px; }
    .muted { color: var(--muted); }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    .top {
      display: flex; justify-content: space-between; align-items: flex-start;
      border-bottom: 1px solid var(--rule);
      padding-bottom: 12px;
      margin-bottom: 14px;
    }
    .brand { display:flex; flex-direction:column; gap:2px; }
    .brand .logo { font-weight: 800; letter-spacing: .02em; }
    .meta { text-align:right; }
    .meta div { margin: 2px 0; }
    .pill {
      display:inline-block; padding:2px 8px; border-radius:999px;
      background: var(--panel); border:1px solid var(--rule);
      font-weight:600;
    }

    .grid {
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
      margin-top: 8px;
    }
    .card {
      border: 1px solid var(--rule);
      background: var(--panel2);
      border-radius: 10px;
      padding: 10px 12px;
    }
    .cardHeader {
      display:flex; justify-content:space-between; align-items:center;
      margin-bottom: 6px;
      font-weight:700;
    }
    .scoreBox {
      min-width: 36px;
      text-align:center;
      border: 1px solid var(--rule);
      border-radius: 10px;
      padding: 2px 8px;
      background: var(--panel);
      font-weight: 800;
    }
    ul.bullets { margin: 6px 0 0 16px; padding: 0; }
    ul.bullets li { margin: 4px 0; }
    .sectionRule { border-top: 1px solid var(--rule); margin: 12px 0; }

    table { width:100%; border-collapse: collapse; }
    th, td { border:1px solid var(--rule); padding: 6px 8px; vertical-align: top; }
    th { background: var(--panel); text-align:left; font-weight: 700; }
    .tight td { padding: 5px 8px; }

    .footer {
      margin-top: 18px;
      padding-top: 10px;
      border-top: 1px solid var(--rule);
      display:flex; justify-content:space-between; align-items:center;
      color: var(--muted);
      font-size: 11px;
    }
  </style>
</head>
<body>

  <div class="top">
    <div class="brand">
      <div class="logo">iQWEB Website Report</div>
      <div class="muted">Website: ${escapeHtml(website)}</div>
    </div>
    <div class="meta">
      <div><strong>Report ID:</strong> <span class="mono">${escapeHtml(reportId)}</span></div>
      <div><strong>Report Date:</strong> <span class="mono">${escapeHtml(reportDate)}</span></div>
    </div>
  </div>

  <h2>Deterministic Summary</h2>
  ${
    Array.isArray(overallLines) && overallLines.length
      ? bulletList(overallLines)
      : `<div class="muted">No executive narrative available for this scan.</div>`
  }

  ${
    Array.isArray(manifestationLines) && manifestationLines.length
      ? `
      <h3>${escapeHtml(manifestationTitle)}</h3>
      ${bulletList(manifestationLines)}
    `
      : ""
  }

  <h2>Key Insight Metrics</h2>
  <table class="tight">
    <tr><th style="width:160px">Insight</th><th>Detail</th></tr>
    <tr><td><strong>Strength</strong></td><td>${escapeHtml(insights.strength)}</td></tr>
    <tr><td><strong>Risk</strong></td><td>${escapeHtml(insights.risk)}</td></tr>
    <tr><td><strong>Focus</strong></td><td>${escapeHtml(insights.focus)}</td></tr>
    <tr><td><strong>Next</strong></td><td>${escapeHtml(insights.next)}</td></tr>
  </table>

  <h2>Delivery Signals</h2>
  <div class="grid">
    ${signals
      .map((sig) => {
        const label = sig?.label || sig?.id || "Signal";
        const score = fmtScore(sig?.score ?? sig?.displayValue ?? sig?.value);
        const lines = Array.isArray(sig?.lines) ? sig.lines : [];
        const hasLines = lines.length > 0;

        return `
          <div class="card">
            <div class="cardHeader">
              <div>${escapeHtml(label)}</div>
              <div class="scoreBox">${escapeHtml(score)}</div>
            </div>
            ${
              hasLines
                ? bulletList(lines)
                : `<div class="muted">No notable issues flagged for this signal.</div>`
            }
          </div>
        `;
      })
      .join("")}
  </div>

  <h2>Scores</h2>
  <table class="tight">
    <tr>
      <th style="width:220px">Domain</th>
      <th style="width:140px">Score</th>
      <th>Notes</th>
    </tr>
    <tr><td><strong>Overall Delivery</strong></td><td><span class="pill">${escapeHtml(fmtScore(scores.overall))}/100</span></td><td class="muted">Deterministic weighted signals.</td></tr>
    <tr><td>Performance</td><td>${escapeHtml(fmtScore(scores.performance))}/100</td><td class="muted">Speed + main-thread constraints.</td></tr>
    <tr><td>Mobile Experience</td><td>${escapeHtml(fmtScore(scores.mobile))}/100</td><td class="muted">Viewport + mobile readiness.</td></tr>
    <tr><td>SEO Foundations</td><td>${escapeHtml(fmtScore(scores.seo))}/100</td><td class="muted">Title, meta, canonical, robots baseline.</td></tr>
    <tr><td>Security & Trust</td><td>${escapeHtml(fmtScore(scores.security))}/100</td><td class="muted">Headers/policy baseline.</td></tr>
    <tr><td>Structure & Semantics</td><td>${escapeHtml(fmtScore(scores.structure))}/100</td><td class="muted">H1 + document structure inputs.</td></tr>
    <tr><td>Accessibility</td><td>${escapeHtml(fmtScore(scores.accessibility))}/100</td><td class="muted">Alt, labels, empty controls.</td></tr>
  </table>

  <h2>Top Issues Detected</h2>
  ${
    topIssues.length
      ? `<ul class="bullets">${topIssues.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`
      : `<div class="muted">None detected.</div>`
  }

  <h2>Recommended Fix Sequence</h2>
  ${
    fixSequence.length
      ? `<ol>${fixSequence
          .map((x) => `<li>${escapeHtml(asText(x))}</li>`)
          .join("")}</ol>`
      : `<div class="muted">No fix sequence available.</div>`
  }

  <h2>Signal Evidence</h2>
  <div class="muted" style="margin-bottom:8px;">
    Evidence shows the measurable inputs captured for each signal (and any deductions/issues).
  </div>

  ${signals
    .filter((sig) => sig?.id !== "overall")
    .map((sig) => {
      const label = sig?.label || sig?.id || "Signal";
      const obsRows = tableRowsFromObservations(sig?.observations);
      const deductions = Array.isArray(sig?.deductions) ? sig.deductions : [];
      const issues = Array.isArray(sig?.issues) ? sig.issues : [];

      return `
        <div class="sectionRule"></div>
        <h3>${escapeHtml(label)} <span class="pill">${escapeHtml(
        fmtScore(sig?.score)
      )}/100</span></h3>

        <table class="tight">
          <tr><th style="width:220px">Metric</th><th>Value</th><th style="width:120px">Source</th></tr>
          ${obsRows}
        </table>

        ${
          deductions.length
            ? `
            <h3>Deductions</h3>
            <table class="tight">
              <tr><th>Reason</th><th style="width:90px">Points</th><th style="width:220px">Code</th></tr>
              ${deductions
                .map((d) => {
                  const reason = escapeHtml(asText(d?.reason));
                  const points = escapeHtml(asText(d?.points));
                  const code = escapeHtml(asText(d?.code));
                  return `<tr><td>${reason}</td><td class="mono">${points}</td><td class="mono">${code}</td></tr>`;
                })
                .join("")}
            </table>
          `
            : ""
        }

        ${
          issues.length
            ? `
            <h3>Issues</h3>
            <ul class="bullets">
              ${issues
                .map((i) => {
                  const reason = escapeHtml(asText(i?.reason || i));
                  const sev = escapeHtml(asText(i?.severity || ""));
                  return `<li>${reason}${sev ? ` <span class="muted">(${sev})</span>` : ""}</li>`;
                })
                .join("")}
            </ul>
          `
            : ""
        }
      `;
    })
    .join("")}

  <div class="footer">
    <div>© 2025 iQWEB — All rights reserved.</div>
    <div class="mono">${escapeHtml(reportId)}</div>
  </div>

</body>
</html>`;

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return json(500, { success: false, error: "Unexpected server error" });
  }
};