import fs from "fs";
import path from "path";
import DocRaptor from "docraptor";

export async function handler(event) {
  try {
    const { report_id } = JSON.parse(event.body || "{}");
    if (!report_id) {
      return { statusCode: 400, body: "Missing report_id" };
    }

    // 1. Fetch report data (Supabase or DB)
    const report = await fetchReportFromDB(report_id); // your existing logic

    // 2. Load PDF template
    const templatePath = path.join(process.cwd(), "report-pdf.html");
    let html = fs.readFileSync(templatePath, "utf8");

    // 3. Inject values (simple string replace)
    html = html
      .replace("{{website}}", report.website)
      .replace("{{report_id}}", report.report_id)
      .replace("{{created_at}}", report.created_at)
      .replace("{{overall}}", report.scores.overall)
      .replace("{{performance}}", report.scores.performance)
      .replace("{{seo}}", report.scores.seo)
      .replace("{{security}}", report.scores.security)
      .replace("{{executive_narrative}}", report.narrative || "—");

    // 4. Send HTML string to DocRaptor
    const docraptor = new DocRaptor.ApiClient();
    docraptor.username = process.env.DOCRAPTOR_API_KEY;

    const pdf = await new DocRaptor.DocApi().createDoc({
      test: false,
      document_type: "pdf",
      document_content: html
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="iQWEB-${report_id}.pdf"`
      },
      body: pdf,
      isBase64Encoded: true
    };

  } catch (err) {
    console.error("PDF generation failed:", err);
    return { statusCode: 500, body: "PDF generation failed" };
  }
}
