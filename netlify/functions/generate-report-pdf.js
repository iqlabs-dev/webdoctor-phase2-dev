export async function handler(event) {

  const report_id = event.queryStringParameters?.report_id;

  if (!report_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Missing report_id" })
    };
  }

  const docraptorKey = process.env.DOCRAPTOR_API_KEY;

  const siteUrl = (process.env.URL || "https://iqweb.ai").replace(/\/+$/, "");

  const htmlURL =
    `${siteUrl}/report_pdf.html?report_id=${encodeURIComponent(report_id)}`;

  const response = await fetch("https://docraptor.com/docs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization":
        "Basic " + Buffer.from(docraptorKey + ":").toString("base64")
    },
    body: JSON.stringify({
      test: false,
      document_type: "pdf",
      name: `iqweb-report-${report_id}.pdf`,
      document_url: htmlURL,
      javascript: true,
      prince_options: {
        media: "screen"
      }
    })
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(txt);
  }

  const pdf = await response.arrayBuffer();

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition":
        `attachment; filename="iqweb-report-${report_id}.pdf"`
    },
    body: Buffer.from(pdf).toString("base64"),
    isBase64Encoded: true
  };
}