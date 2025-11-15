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

  let body = {};
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
  }

  const { report_id, html } = body;

  if (!report_id || !html) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report_id and html required' })
    };
  }

  try {
    const isLocal = process.env.NETLIFY_DEV === 'true';

    let browser;

    if (isLocal) {
      // Local dev: use full Puppeteer
      browser = await puppeteer.launch({
        headless: true
      });
    } else {
      // Netlify / Lambda: use chromium helper
      const executablePath = await chromium.executablePath(); // ✅ no custom path

      browser = await puppeteer.launch({
        args: chromium.args,
        defaultViewport: chromium.defaultViewport,
        executablePath,
        headless: chromium.headless
      });
    }

    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: { top: '12mm', right: '12mm', bottom: '14mm', left: '12mm' }
    });

    await browser.close();

    // Store PDF in Supabase Storage bucket "reports"
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
