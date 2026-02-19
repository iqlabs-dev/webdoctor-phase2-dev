// netlify/functions/report-pdf-page.js
// Serves the full OSD report template to DocRaptor (so PDF matches the on-screen report),
// while injecting a Promise polyfill BEFORE report-data.js (DocRaptor JS runtime is old).

const fs = require("fs");
const path = require("path");

function findTemplatePath() {
  const candidates = [
    path.join(process.cwd(), "report_template.html"),
    path.join(__dirname, "../../report_template.html"),
    path.join(__dirname, "../report_template.html"),
    path.join(__dirname, "report_template.html"),
  ];

  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

function withPromisePolyfill(html) {
  // Inject polyfill BEFORE report-data.js is loaded.
  const polyfillTag =
    '\n  <script src="https://cdn.jsdelivr.net/npm/promise-polyfill@8/dist/polyfill.min.js"></script>\n';

  // Your template has: <script src="/assets/js/report-data.js"></script>
  const needle = '<script src="/assets/js/report-data.js"></script>';

  if (html.includes(polyfillTag)) return html; // already injected

  if (html.includes(needle)) {
    return html.replace(needle, polyfillTag + "  " + needle);
  }

  // Fallback: inject before </head> if script tag changed
  return html.replace("</head>", polyfillTag + "</head>");
}

exports.handler = async (event) => {
  try {
    // DocRaptor will call this with report_id + pdf=1
    const reportId = String(event.queryStringParameters?.report_id || "").trim();
    if (!reportId) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        body: "Missing report_id",
      };
    }

    const templatePath = findTemplatePath();
    if (!templatePath) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
        body:
          "report_template.html not found at runtime. Ensure it exists at repo root and is included in the deploy bundle.",
      };
    }

    let html = fs.readFileSync(templatePath, "utf8");

    // Ensure DocRaptor can run the page (Promise polyfill first)
    html = withPromisePolyfill(html);

    // (Optional) Ensure the querystring already contains pdf=1; your template detects it.
    // We don't need to rewrite links—DocRaptor is fetching this URL with pdf=1 already.

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      },
      body: html,
    };
  } catch (err) {
    console.error("[report-pdf-page] error:", err);
    return {
      statusCode: 500,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
      body: err?.message || "Unknown error",
    };
  }
};
