// /netlify/functions/generate-report-pdf.js

import { createClient } from '@supabase/supabase-js';
import pdf from 'html-pdf-node'; // <-- html-pdf-node version
import dotenv from 'dotenv';

dotenv.config();

// ------------------------------
// Setup Supabase
// ------------------------------
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ------------------------------
// MAIN HANDLER
// ------------------------------
export async function handler(event) {
  try {
    if (event.httpMethod !== 'POST') {
      return {
        statusCode: 405,
        body: JSON.stringify({ error: 'Method not allowed' })
      };
    }

    const { report_id } = JSON.parse(event.body);

    if (!report_id) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'report_id required' })
      };
    }

    // ------------------------------
    // Fetch report from Supabase
    // ------------------------------
    const { data, error } = await supabase
      .from('reports')
      .select('html')
      .eq('report_id', report_id)
      .single();

    if (error || !data) {
      return {
        statusCode: 404,
        body: JSON.stringify({ error: 'Report not found' })
      };
    }

    const htmlContent = data.html;

    // ------------------------------
    // Generate PDF using html-pdf-node
    // ------------------------------
    const file = { content: htmlContent };

    const pdfBuffer = await pdf.generatePdf(file, {
      format: 'A4',
      printBackground: true,
      margin: { top: '20mm', bottom: '20mm', left: '12mm', right: '12mm' }
    });

    // ------------------------------
    // Upload PDF to Supabase storage
    // ------------------------------
    const pdfPath = `reports/${report_id}.pdf`;

    const { error: uploadError } = await supabase.storage
      .from('reports')
      .upload(pdfPath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true
      });

    if (uploadError) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Upload failed', details: uploadError })
      };
    }

    const pdfPublicUrl =
      `${process.env.SUPABASE_URL}/storage/v1/object/public/reports/${pdfPath}`;

    return {
      statusCode: 200,
      body: JSON.stringify({ url: pdfPublicUrl })
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: 'PDF failed',
        details: err.message || String(err)
      })
    };
  }
}
