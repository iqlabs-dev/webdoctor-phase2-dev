// /assets/js/exportPdf.js

async function exportPdf(html, report_id) {
  const res = await fetch("/.netlify/functions/generate-report-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, report_id })
  });

  const data = await res.json();
  return data.pdf_url;
}
