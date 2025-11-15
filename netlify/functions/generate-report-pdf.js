// /netlify/functions/generate-report-pdf.js

import { createClient } from '@supabase/supabase-js';
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';

// Supabase client using service role key (server-side only)
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

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'invalid json' })
    };
  }

  const { report_id, html: htmlFromBody } = body;

  // ✅ Only require report_id; HTML can be loaded from Supabase
  if (!report_id) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: 'report_id required' })
    };
  }

  let html = htmlFromBody || null;

  // If HTML not provided, pull it from the reports table
  if (!html) {
    const { data, error } = await supabase
      .from('reports')
      .select('html')
      .eq('report_id', report_id)
      .maybeSingle();

    if (error) {
      console.error('SUPABASE LOAD HTML ERROR:', error);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'failed to load report html' })
      };
    }

    if (!data || !data.html) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'report html not found' })
      };
    }

    html = data.html;
  }

  let browser;

  try {
    const executablePath = await chromium.executablePath();

    browser = await puppeteer.launch({
      args: chromium.args,
      defaultViewport: chromium.defaultViewport,
      executablePath,
      headless: chromium.headless
    });

    const page = await browser.newPage();

    await page.setContent(html, {
      waitUntil: ['load', 'networkidle0']
    });

    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '18mm',
        right: '16mm',
        bottom: '18mm',
        left: '16mm'
      }
    });

    // Upload to Supabase Storage bucket "reports"
    const filePath = `${report_id}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(filePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      console.error('SUPABASE PDF UPLOAD ERROR:', uploadError);
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'pdf upload failed' })
      };
    }

    const { data: publicUrlData } = supabase.storage
      .from('reports')
      .getPublicUrl(filePath);

    const pdf_url = publicUrlData?.publicUrl || null;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        report_id,
        pdf_url
      })
    };
  } catch (err) {
    console.error('PDF GENERATION ERROR:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'pdf generation failed',
        details: err.message || String(err)
      })
    };
  } finally {
    if (browser) {
      try {
        await browser.close();
      } catch {
        // ignore close errors
      }
    }
  }
};
