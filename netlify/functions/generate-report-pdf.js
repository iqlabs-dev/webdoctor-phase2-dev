// /netlify/functions/generate-report-pdf.js
import chromium from "@sparticuz/chromium";
import puppeteer from "puppeteer-core";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }

  let body = {};
  try {
    body = JSON.parse(event.body);
  } catch (e) {
    return { statusCode: 400, body: "invalid json" };
  }

  const { report_id } = body;
  if (!report_id) {
    return { statusCode: 400, body: JSON.stringify({ error: "report_id required" }) };
  }

  // 1) Fetch the report HTML from database
  const { data, error } = await supabase
    .from("reports")
    .select("html")
    .eq("report_id", report_id)
    .single();

  if (error || !data?.html) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "could not load html" })
    };
  }

  const html = data.html;

  try {
    // 2) Launch Chromium (Netlify compatible)
    const executablePath = await chromium.executablePath;

    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle0" });

    // 3) Generate the PDF
    const pdfBuffer = await page.pdf({
      format: "A4",
      printBackground: true,
    });

    await browser.close();

    // 4) Upload PDF to Supabase Storage
    const fileName = `${report_id}.pdf`;

    const upload = await supabase.storage
      .from("reports")
      .upload(fileName, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true,
      });

    if (upload.error) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: "upload failed", details: upload.error.message })
      };
    }

    const publicUrl = supabase.storage
      .from("reports")
      .getPublicUrl(fileName).data.publicUrl;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        pdf_url: publicUrl
      })
    };

  } catch (err) {
    console.error("PDF ERROR:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.toString() })
    };
  }
};
