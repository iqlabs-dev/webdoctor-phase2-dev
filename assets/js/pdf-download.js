// /assets/js/pdf-download.js
// iQWEB — Dashboard PDF download handler (History only)
// Looks for: [data-iqweb-pdf="REPORT_ID"] buttons
// Calls: /.netlify/functions/download-pdf  (POST { reportId })
// Downloads as: REPORT_ID.pdf

(function () {
  function getReportId(el) {
    return (el?.getAttribute("data-iqweb-pdf") || "").trim();
  }

  async function downloadPdf(reportId, btn) {
    const originalText = btn ? btn.textContent : "";
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Preparing…";
      }

      const res = await fetch("/.netlify/functions/download-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `HTTP ${res.status}`);
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
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText || "Download PDF";
      }
    }
  }

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-iqweb-pdf]");
    if (!btn) return;

    const reportId = getReportId(btn);
    if (!reportId) return;

    e.preventDefault();
    downloadPdf(reportId, btn).catch((err) => {
      console.error("[pdf-download] failed:", err);
      alert("PDF download failed. Please try again.");
    });
  });
})();
