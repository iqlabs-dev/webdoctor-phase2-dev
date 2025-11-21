// /assets/js/exportPdf.js

async function exportPdf(html, report_id) {
  try {
    const res = await fetch("/.netlify/functions/generate-report-pdf", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ html, report_id }),
    });

    // Always read as text first
    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.error("PDF raw response (non-JSON):", text);
      throw new Error("PDF request failed: non-JSON response from server");
    }

    if (!res.ok) {
      console.error("PDF request failed (JSON error):", data);
      throw new Error(data.error || "PDF request failed");
    }

    // Success
    return data.pdf_url;
  } catch (err) {
    console.error("PDF request failed:", err);
    throw err;
  }
}
