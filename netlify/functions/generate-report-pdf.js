import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { handler: reportHtmlHandler } = require("./get-report-html-pdf.js");

export async function handler(event) {
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
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        error: "Method not allowed",
      }),
    };
  }

  try {
    const report_id = String(
      event.queryStringParameters?.report_id ||
      event.queryStringParameters?.reportId ||
      ""
    ).trim();

    if (!report_id) {
      return {
        statusCode: 400,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          success: false,
          error: "Missing report_id",
        }),
      };
    }

    const docraptorKey =
      process.env.DOCRAPTOR_API_KEY ||
      process.env.DOC_RAPTOR_API_KEY ||
      "";

    if (!docraptorKey) {
      return {
        statusCode: 500,
        headers: {
          ...corsHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          success: false,
          error: "Missing DOCRAPTOR_API_KEY",
        }),
      };
    }

    // Build HTML in-process so PDF always uses this deploy's template (no stale HTTP fetch).
    const htmlResult = await reportHtmlHandler({
      httpMethod: "GET",
      queryStringParameters: { report_id },
      headers: event.headers || {},
    });

    if (!htmlResult || htmlResult.statusCode !== 200) {
      const txt =
        (htmlResult && typeof htmlResult.body === "string" && htmlResult.body) ||
        "get-report-html-pdf failed";
      throw new Error(
        `Failed to load report HTML (${htmlResult?.statusCode || 500}): ${txt.slice(0, 600)}`
      );
    }

    const html = htmlResult.body || "";

    if (!html.trim()) {
      throw new Error("Report HTML was empty");
    }

    if (!html.includes('data-iqweb-pdf="pro-v3"')) {
      console.warn("[generate-report-pdf] HTML missing pro-v3 marker — check deployment");
    }

    const siteUrl = resolveSiteUrl(event);

    const response = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + Buffer.from(docraptorKey + ":").toString("base64"),
      },
      body: JSON.stringify({
        test: false,
        document_type: "pdf",
        name: `iqweb-report-${report_id}.pdf`,
        document_content: html,
        javascript: false,
        prince_options: {
          media: "print",
          baseurl: siteUrl + "/",
        },
      }),
    });

    if (!response.ok) {
      const txt = await response.text().catch(() => "");
      throw new Error(txt || `DocRaptor request failed (${response.status})`);
    }

    const pdf = await response.arrayBuffer();

    return {
      statusCode: 200,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iqweb-report-${report_id}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: Buffer.from(pdf).toString("base64"),
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error("PDF generation failed:", err);

    return {
      statusCode: 500,
      headers: {
        ...corsHeaders(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        success: false,
        error: err?.message || "Failed to generate PDF",
      }),
    };
  }
}

function resolveSiteUrl(event) {
  const host = event?.headers?.host || event?.headers?.Host;
  const proto = String(event?.headers?.["x-forwarded-proto"] || "https")
    .split(",")[0]
    .trim();

  if (host) {
    return `${proto}://${host}`.replace(/\/+$/, "");
  }

  return String(
    process.env.DEPLOY_PRIME_URL ||
      process.env.URL ||
      process.env.DEPLOY_URL ||
      "https://iqweb.ai"
  ).replace(/\/+$/, "");
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}
