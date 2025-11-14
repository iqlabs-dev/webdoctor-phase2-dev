// /netlify/functions/generate-report-pdf.js
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Supabase client (SERVICE ROLE KEY)
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

  // 1) Parse JSON body
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    console.error('generate-report-pdf JSON parse error:', err);
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
  }

  const { report_id } = body;

  if (!report_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report_id required' })
    };
  }

  // 2) Fetch HTML for this report from Supabase
  const { data: reportRow, error: fetchError } = await supabase
    .from('reports')
    .select('html')
    .eq('report_id', report_id)
    .maybeSingle();

  if (fetchError) {
    console.error('Error fetching report HTML:', fetchError);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'failed to fetch report html' })
    };
  }

  if (!reportRow || !reportRow.html) {
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'report not found or no html' })
    };
  }

  let browser;

  try {
    // 3) Launch headless Chromium
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true
    });

    const page = await browser.newPage();

    // 4) Load HTML from DB
    await page.setContent(reportRow.html, { waitUntil: 'networkidle0' });

    // 5) Render to PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '10mm',
        right: '10mm',
        bottom: '10mm',
        left: '10mm'
      }
    });

    // 6) Upload PDF to Supabase Storage → bucket "reports"
    const filename = `reports/${report_id}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(filename, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('Error uploading PDF:', uploadError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'pdf upload failed' })
      };
    }

    // 7) Get public URL
    const {
      data: { publicUrl }
    } = supabase.storage.from('reports').getPublicUrl(filename);

    // 8) Optional: save pdf_url on the report row
    const { error: updateError } = await supabase
      .from('reports')
      .update({ pdf_url: publicUrl })
      .eq('report_id', report_id);

    if (updateError) {
      console.error('Error saving pdf_url:', updateError);
    }

    // 9) Return URL
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        report_id,
        pdf_url: publicUrl
      })
    };
  } catch (err) {
    console.error('Error generating PDF:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'pdf generation failed' })
    };
  } finally {
    if (browser) {
      await browser.close();
    }
  }
};
