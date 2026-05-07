// netlify/functions/get-report-html-pdf.js
// PDF renderer that uses the live OSD report.html as the source of truth.
// This prevents the PDF from drifting into an old duplicate report layout.

const FETCH_TIMEOUT_MS = 20000;

exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers: corsHeaders(),
      body: "",
    };
  }

  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { ...corsHeaders(), "Content-Type": "text/plain" },
      body: "Method not allowed",
    };
  }

  try {
    const reportId = String(
      (event.queryStringParameters &&
        (event.queryStringParameters.report_id ||
          event.queryStringParameters.reportId)) ||
        ""
    ).trim();

    if (!reportId) {
      return {
        statusCode: 400,
        headers: { ...corsHeaders(), "Content-Type": "text/plain" },
        body: "Missing report_id",
      };
    }

    const siteUrl = (process.env.URL || "https://iqweb.ai").replace(/\/+$/, "");
    const reportHtmlUrl = siteUrl + "/report.html?report_id=" + encodeURIComponent(reportId) + "&pdf=1";

    let html = await fetchTextWithTimeout(reportHtmlUrl, FETCH_TIMEOUT_MS);

    if (!html || html.length < 500) {
      throw new Error("report.html returned an empty or invalid response");
    }

    html = injectPdfHead(html, siteUrl);

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
      body: html,
    };
  } catch (err) {
    console.error("[get-report-html-pdf] error:", err);
    return {
      statusCode: 500,
      headers: { ...corsHeaders(), "Content-Type": "text/plain" },
      body: err?.message || "Unknown error",
    };
  }
};

function injectPdfHead(html, siteUrl) {
  const baseTag = `<base href="${escapeAttr(siteUrl)}/">`;

  const pdfCss = `
<style id="iqweb-pdf-osd-match">
  @page {
    size: A4 portrait;
    margin: 7mm;
  }

  html {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
    background: #050814 !important;
  }

  body {
    background:
      radial-gradient(circle at top center, rgba(34,211,238,0.08), transparent 30%),
      linear-gradient(180deg, rgba(5,8,20,1) 0%, rgba(5,11,25,1) 38%, rgba(2,3,4,1) 100%) !important;
    color: var(--ink) !important;
    padding: 10px 12px 32px !important;
  }

  * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  #backToDashboard,
  #downloadPdfBtn,
  .top-actions,
  .loader-wrap,
  .no-print {
    display: none !important;
  }

  .page-shell {
    align-items: center !important;
  }

  .shell-inner,
  .footer {
    max-width: 1040px !important;
    width: 100% !important;
  }

  .top-card,
  .executive-dashboard,
  .section,
  .card,
  .exec-panel,
  .exec-priority,
  .exec-mini-issue,
  .ai-discovery-card,
  .ai-discovery-panel,
  .ai-discovery-scorebox,
  .phase,
  .evidence-block {
    break-inside: avoid !important;
    page-break-inside: avoid !important;
  }

  .section {
    margin-bottom: 12px !important;
  }

  .executive-dashboard {
    break-after: page !important;
    page-break-after: always !important;
  }

  #deliverySignalsSection {
    break-before: page !important;
    page-break-before: always !important;
  }

  #fixSequenceSection {
    break-before: page !important;
    page-break-before: always !important;
  }

  #signalEvidenceSection {
    break-before: page !important;
    page-break-before: always !important;
  }

  details#signalEvidenceSection {
    display: block !important;
  }

  details#signalEvidenceSection > summary {
    display: flex !important;
  }

  details.evidence-block {
    display: block !important;
  }

  a,
  a:visited {
    color: inherit !important;
    text-decoration: none !important;
  }

  @media print {
    html,
    body {
      background:
        radial-gradient(circle at top center, rgba(34,211,238,0.08), transparent 30%),
        linear-gradient(180deg, rgba(5,8,20,1) 0%, rgba(5,11,25,1) 38%, rgba(2,3,4,1) 100%) !important;
      color: var(--ink) !important;
    }

    .card,
    .section,
    .evidence-block,
    .insight,
    .issue,
    .acc-body,
    .kv {
      background: linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.03)) !important;
      border-color: var(--border-subtle) !important;
    }

    .section-title,
    h1,
    h2,
    h3,
    .issue-title,
    .evidence-title,
    .acc-title {
      color: var(--accent-strong) !important;
    }

    .summary,
    .issue-why,
    .phase-body li,
    .insight .text,
    .kv .k,
    .kv .v,
    .finding-value,
    .finding-label {
      color: var(--ink-soft) !important;
    }

    .bar {
      background: rgba(255,255,255,0.08) !important;
    }

    .bar > div {
      background: linear-gradient(90deg, var(--accent), rgba(34,197,94,0.9)) !important;
    }
  }
</style>`;

  const readyScript = `
<script id="iqweb-pdf-ready-failsafe">
  window.__IQWEB_PDF_MODE = true;

  (function () {
    function openPdfEvidence() {
      try {
        var root = document.getElementById("signalEvidenceSection");
        if (root && root.tagName && root.tagName.toLowerCase() === "details") root.open = true;

        var details = document.querySelectorAll("details.evidence-block");
        for (var i = 0; i < details.length; i++) details[i].open = true;
      } catch (_) {}
    }

    var oldReady = window.docraptorJavaScriptFinished;

    window.docraptorJavaScriptFinished = function () {
      try { openPdfEvidence(); } catch (_) {}

      if (typeof oldReady === "function") {
        try {
          if (oldReady() === true) return true;
        } catch (_) {}
      }

      var root = document.getElementById("reportRoot");
      var loader = document.getElementById("loaderSection");
      var signals = document.getElementById("signalsGrid");

      var rootVisible =
        root &&
        root.style.display !== "none" &&
        getComputedStyle(root).display !== "none";

      var loaderHidden =
        !loader ||
        loader.style.display === "none" ||
        getComputedStyle(loader).display === "none";

      var hasSignals =
        signals &&
        signals.children &&
        signals.children.length > 0;

      return !!(rootVisible && loaderHidden && hasSignals);
    };

    setTimeout(openPdfEvidence, 1500);
  })();
</script>`;

  if (!/<base\s/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, (m) => m + "\n" + baseTag);
  }

  html = html.replace("</head>", pdfCss + "\n" + readyScript + "\n</head>");
  return html;
}

async function fetchTextWithTimeout(url, ms) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);

  try {
    const resp = await fetch(url, {
      method: "GET",
      headers: { Accept: "text/html" },
      signal: controller.signal,
    });

    const txt = await resp.text().catch(() => "");
    if (!resp.ok) throw new Error(`Fetch failed (${resp.status}): ${txt.slice(0, 600)}`);
    return txt;
  } catch (e) {
    if (e?.name === "AbortError") throw new Error(`Timeout after ${ms}ms: ${url}`);
    throw e;
  } finally {
    clearTimeout(id);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}

function escapeAttr(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
