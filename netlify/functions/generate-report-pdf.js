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

    const siteUrl = process.env.URL || "https://iqweb.ai";
    const htmlURL =
      `${siteUrl}/.netlify/functions/get-report-html-pdf?report_id=${encodeURIComponent(report_id)}`;

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
        document_url: htmlURL,
        prince_options: {
          media: "screen",
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

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
  };
}