// /assets/js/exportPdf.js

async function exportPdf(html, report_id) {
  const res = await fetch("/.netlify/functions/generate-report-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ html, report_id }),
  });

  const text = await res.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    console.error("PDF raw response (non-JSON):", text);
    throw new Error("PDF request failed: non-JSON response");
  }

  if (!res.ok) {
    console.error("PDF request failed:", data);
    throw new Error(data.error || "PDF request failed");
  }

  console.log("PDF URL:", data.pdf_url);
  return data.pdf_url;
}
