// /assets/js/report-history-pdf.js
// iQWEB Report — History-only PDF button wiring (v1.0)
// - Runs ONLY when report opened from Scan History (?from=history)
// - Replaces Refresh button with Download PDF
// - Calls /.netlify/functions/generate-report-pdf directly (binary PDF)

(function () {
  function qs(sel) { return document.querySelector(sel); }

  function getParam(name) {
    try { return new URLSearchParams(window.location.search).get(name) || ""; }
    catch { return ""; }
  }

  function getReportId() {
    const p = new URLSearchParams(window.location.search);
    return (p.get("report_id") || p.get("id") || "").trim();
  }

  function looksLikeReportId(v) {
    return typeof v === "string" && /^WEB-\d{7}-\d{5}$/.test(v.trim());
  }

  async function downloadPdf(reportId, btn) {
    if (!looksLikeReportId(reportId)) {
      alert("Report ID not ready yet.");
      return;
    }

    const original = btn ? (btn.textContent || "Download PDF") : "Download PDF";

    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Preparing…";
      }

      // Call the PDF generator directly (avoid download-pdf orchestrator)
      const res = await fetch("/.netlify/functions/generate-report-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[PDF] generate-report-pdf failed:", res.status, txt);
        throw new Error("PDF generation failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportId}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      console.error("[PDF] error:", e);
      alert("PDF download failed. Check Netlify function logs.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  // ✅ ONLY run for history view
  const from = getParam("from");
  if (from !== "history") return;

  const reportId = getReportId();

  // Try to find an existing Download PDF button first (your screenshot shows one top-right)
  // Common IDs/classes (handles older/newer layouts)
  const existingPdfBtn =
    qs("#download-pdf-btn") ||
    qs("[data-iqweb-download-pdf]") ||
    qs(".btn-download-pdf");

  if (existingPdfBtn) {
    existingPdfBtn.textContent = "Download PDF";
    existingPdfBtn.onclick = (e) => {
      if (e?.preventDefault) e.preventDefault();
      downloadPdf(reportId, existingPdfBtn);
    };
    return;
  }

  // Otherwise replace Refresh button with Download PDF
  const refreshBtn =
    qs("#refresh-btn") ||
    qs("#refreshReportBtn") ||
    qs("[data-iqweb-refresh]") ||
    qs(".btn-refresh");

  if (refreshBtn) {
    refreshBtn.textContent = "Download PDF";
    refreshBtn.onclick = (e) => {
      if (e?.preventDefault) e.preventDefault();
      downloadPdf(reportId, refreshBtn);
    };
  }
})();
