// /netlify/functions/generate-report.js
import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// ----------------------------------------
// SUPABASE — Server Role
// ----------------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ----------------------------------------
// REPORT ID FORMAT (WDR-YYDDD-####)
// ----------------------------------------
function makeReportId(prefix = "WDR") {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);

  const start = new Date(now.getFullYear(), 0, 0);
  const diff = now - start;
  const ddd = String(Math.floor(diff / 86400000)).padStart(3, "0");

  const seq = String(Math.floor(Math.random() * 9999)).padStart(4, "0");

  return `${prefix}-${yy}${ddd}-${seq}`;
}

// ----------------------------------------
// LOAD V4.1 TEMPLATE (You uploaded this file)
// ----------------------------------------
const fs = require("fs");
const path = require("path");

const TEMPLATE_PATH = path.join(__dirname, "Report Template V4.1.html");
let TEMPLATE = "";

try {
  TEMPLATE = fs.readFileSync(TEMPLATE_PATH, "utf8");
} catch (err) {
  console.error("Template load error:", err);
}

// ----------------------------------------
// MAIN HANDLER
// ----------------------------------------
export const handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch (e) {
    return { statusCode: 400, body: "Invalid JSON" };
  }

  const { url, user_id, email } = body;
  if (!url) {
    return { statusCode: 400, body: "url required" };
  }

  // --------------------------
  // GEN STATIC DATA (TEMP)
  // --------------------------
  const reportId = makeReportId();
  const today = new Date().toISOString().split("T")[0];

  const data = {
    url,
    date: today,
    id: reportId,
    summary: "Overall healthy — main issues in performance and SEO.",
    score: "78",
    perf_score: "78",
    seo_score: "78",
    metric_page_load_value: "1.8s",
    metric_page_load_goal: "<2.5s",
    metric_mobile_status: "Pass",
    metric_mobile_text: "Responsive layout",
    metric_cwv_status: "Needs attention",
    metric_cwv_text: "CLS slightly high",
    issue1_severity: "Critical",
    issue1_title: "Uncompressed hero image",
    issue1_text: "Image too large",
    issue2_severity: "Critical",
    issue2_title: "Missing meta description",
    issue2_text: "Add a proper meta description",
    issue3_severity: "Moderate",
    issue3_title: "Heading structure",
    issue3_text: "Multiple H1s found",
    recommendation1: "Compress hero images",
    recommendation2: "Add SEO metadata",
    recommendation3: "Fix heading order",
    recommendation4: "Re-scan after changes",
    notes: "Automated WebDoctor analysis."
  };

  // --------------------------
  // BUILD HTML (V4.1)
  // --------------------------
  let html = TEMPLATE;
  for (const [key, val] of Object.entries(data)) {
    html = html.replace(new RegExp(`{{${key}}}`, "g"), val);
  }

  // --------------------------
  // DOCraptor PDF Generation
  // --------------------------
  let pdf_url = null;

  try {
    const docRes = await fetch("https://docraptor.com/docs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_credentials: process.env.DOCRAPTOR_API_KEY,
        doc: {
          test: false,
          name: `${reportId}.pdf`,
          document_type: "pdf",
          document_content: html,
          javascript: true
        }
      })
    });

    const pdfBuffer = Buffer.from(await docRes.arrayBuffer());

    // --------------------------
    // Upload to Supabase Storage
    // --------------------------
    const bucket = "public"; // your active bucket
    const uploadPath = `reports-pdf/${reportId}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from(bucket)
      .upload(uploadPath, pdfBuffer, {
        contentType: "application/pdf",
        upsert: true
      });

    if (!uploadErr) {
      pdf_url = `${process.env.SUPABASE_URL}/storage/v1/object/public/${bucket}/${uploadPath}`;
    } else {
      console.error("PDF Upload Error:", uploadErr);
    }
  } catch (err) {
    console.error("DocRaptor Error:", err);
  }

  // --------------------------
  // SAVE TO SUPABASE
  // --------------------------
await supabase.from("reports").insert([{
  user_id,
  email,
  url,
  score: 78,
  report_id: reportId,
  html: html,     // restore OSD preview
  pdf_url
}]);


  // --------------------------
  // RETURN TO DASHBOARD
  // --------------------------
  return {
    statusCode: 200,
    body: JSON.stringify({
      ok: true,
      report_id: reportId,
      html,
      pdf_url
    })
  };
};
