// /netlify/functions/generate-report-pdf.js

import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Supabase (service role, server-side only)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'method not allowed' })
    };
  }

  // 1) Parse body
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
  }

  const reportId = body.report_id || body.reportId;

  if (!reportId) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report_id required' })
    };
  }

  // 2) Fetch report HTML from Supabase
  const { data: report, error: fetchError } = await supabase
    .from('reports')
    .select('id, report_id, html')
    .eq('report_id', reportId)
    .maybeSingle();

  if (fetchError) {
    console.error('SUPABASE REPORT FETCH ERROR:', fetchError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'supabase fetch failed' })
    };
  }

  if (!report || !report.html) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report not found or html missing' })
    };
  }

  const html = report.html;

  // 3) Generate PDF with chromium + puppeteer-core
  chromium.setHeadlessMode = true;
  chromium.setGraphicsMode = false;

  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless
    });

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '18mm',
        bottom: '18mm',
        left: '15mm',
        right: '15mm'
      }
    });

    // 4) Upload PDF to Supabase Storage bucket "reports"
    const fileName = `${reportId}.pdf`;

    const { error: uploadError } = await supabase
      .storage
      .from('reports')
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('SUPABASE PDF UPLOAD ERROR:', uploadError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'supabase upload failed' })
      };
    }

    // 5) Get public URL to return to the dashboard
    const { data: publicData } = supabase
      .storage
      .from('reports')
      .getPublicUrl(fileName);

    const pdfUrl = publicData?.publicUrl || null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        report_id: reportId,
        pdf_url: pdfUrl
      })
    };
  } catch (err) {
    console.error('PDF GENERATION ERROR:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'pdf generation failed',
        details: err.message
      })
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch (closeErr) {
        console.error('Error closing browser:', closeErr);
      }
    }
  }
};
