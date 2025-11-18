// /netlify/functions/docraptor-pdf.js

// Node 18+ on Netlify has global fetch, no import needed.

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: 'Method not allowed' }),
    };
  }

  try {
    const { html, filename } = JSON.parse(event.body || '{}');

    if (!html) {
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing `html` in request body' }),
      };
    }

    const apiKey = process.env.DOCRAPTOR_API_KEY;

    if (!apiKey) {
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'DOCRAPTOR_API_KEY is not set' }),
      };
    }

    const name = filename || `webdoctor-report-${Date.now()}.pdf`;

    const docRaptorRes = await fetch('https://docraptor.com/docs', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        user_credentials: apiKey,
        doc: {
          // set to true while testing if you want their test mode / watermark
          test: false,
          type: 'pdf',
          name,
          document_content: html,
          javascript: true,
        },
      }),
    });

    if (!docRaptorRes.ok) {
      const errorText = await docRaptorRes.text();
      console.error('DocRaptor error:', errorText);

      return {
        statusCode: 502,
        body: JSON.stringify({
          error: 'DocRaptor request failed',
          detail: errorText,
        }),
      };
    }

    const pdfArrayBuffer = await docRaptorRes.arrayBuffer();
    const pdfBase64 = Buffer.from(pdfArrayBuffer).toString('base64');

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${name}"`,
      },
      body: pdfBase64,
      isBase64Encoded: true,
    };
  } catch (err) {
    console.error('docraptor-pdf exception:', err);

    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Server error', detail: err.message }),
    };
  }
};
