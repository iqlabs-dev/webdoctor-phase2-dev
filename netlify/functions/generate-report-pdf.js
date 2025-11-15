// /netlify/functions/generate-report-pdf.js
import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Supabase (service role)
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

  // 1) Read body and get report_id
  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
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

  try {
    // 2) Look up HTML for this report_id from Supabase
    const { data: reportRow, error: fetchError } = await supabase
      .from('reports')
      .select('html')
      .eq('report_id', report_id)
      .single();

    if (fetchError || !reportRow || !reportRow.html) {
      console.error('REPORT HTML FETCH ERROR:', fetchError);
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'report html not found' })
      };
    }

    const html = reportRow.html;

    // 3) Launch Chromium (Netlify-friendly)
    const isLocal = process.env.NETLIFY_DEV === 'true';
    let browser;

    if (isLocal) {
      // Local dev: normal puppeteer
      browser = await puppeteer.launch({ headless: true });
    } else {
      // Netlify / Lambda: use chromium helper – NO hard-coded path
      const executablePath = await chromium.executablePath();

      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless
      });
    }

    // 4) Render HTML → PDF
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' }
    });

    await browser.close();

    // 5) Save PDF to Supabase Storage (bucket: reports)
    const filename = `${report_id}.pdf`;

    const { error: uploadError } = await supabase
      .storage
      .from('reports')
      .upload(filename, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('SUPABASE PDF UPLOAD ERROR:', uploadError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'storage upload failed' })
      };
    }

    const { data: publicUrlData } = supabase
      .storage
      .from('reports')
      .getPublicUrl(filename);

    const publicUrl = publicUrlData?.publicUrl || null;

    // 6) Done
    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        pdf_url: publicUrl,
        path: filename
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
  }
};
