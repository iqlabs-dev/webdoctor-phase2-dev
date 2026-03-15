import fetch from "node-fetch";

export default async (req, context) => {
  try {
    const url = new URL(req.url);
    const report_id = url.searchParams.get("report_id");

    if (!report_id) {
      return new Response(
        JSON.stringify({ error: "Missing report_id" }),
        { status: 400 }
      );
    }

    const docraptorKey = process.env.DOCRAPTOR_API_KEY;

    const reportURL =
      `https://iqweb.ai/report.html?report_id=${report_id}&print=1`;

    const response = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(docraptorKey + ":").toString("base64")}`
      },
      body: JSON.stringify({
        test: false,
        document_type: "pdf",
        name: `iqweb-report-${report_id}.pdf`,
        document_url: reportURL,
        prince_options: {
          media: "print"
        }
      })
    });

    const pdfBuffer = await response.arrayBuffer();

    return new Response(pdfBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iqweb-report-${report_id}.pdf"`
      }
    });

  } catch (err) {
    console.error("PDF generation failed:", err);

    return new Response(
      JSON.stringify({ error: "PDF generation failed" }),
      { status: 500 }
    );
  }
};