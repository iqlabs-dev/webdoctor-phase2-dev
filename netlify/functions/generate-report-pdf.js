// /netlify/functions/generate-report-pdf.js
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, serviceKey);

export const handler = async (event) => {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    let body;
    try {
      body = JSON.parse(event.body || '{}');
    } catch {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid JSON body' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const { report_id, user_id } = body;

    if (!report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'report_id is required' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // Fetch report row
    const { data: report, error: dbError } = await supabase
      .from('reports')
      .select('html, report_id, user_id')
      .eq('report_id', report_id)
      .maybeSingle();

    if (dbError) {
      console.error('DB error:', dbError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Database error: ' + dbError.message }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    if (!report) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Report not found' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // Optional guard: only enforce if both values exist
    if (report.user_id && user_id && report.user_id !== user_id) {
      return {
        statusCode: 403,
        body: JSON.stringify({ error: 'Not authorised for this report' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    if (!report.html) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Report has no HTML content' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    // ----- Generate PDF from HTML via headless Chrome -----
    const browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(report.html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true
    });

    await browser.close();

    // ----- Upload to Supabase Storage -----
    const pdfPath = `reports/${report.report_id}.pdf`; // e.g. reports/WDR-25319-6308.pdf

    const { error: uploadError } = await supabase.storage
      .from('report-pdfs') // <-- change if your bucket name is different
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Upload error: ' + uploadError.message }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    const { data: publicUrlData } = supabase.storage
      .from('report-pdfs')
      .getPublicUrl(pdfPath);

    const pdfUrl = publicUrlData?.publicUrl;

    if (!pdfUrl) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Could not generate public URL for PDF' }),
        headers: { 'Content-Type': 'application/json' }
      };
    }

    return {
      statusCode: 200,
      body: JSON.stringify({ pdf_url: pdfUrl }),
      headers: { 'Content-Type': 'application/json' }
    };
  } catch (err) {
    console.error('PDF FUNCTION FATAL ERROR:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal error: ' + (err.message || 'unknown') }),
      headers: { 'Content-Type': 'application/json' }
    };
  }
};
