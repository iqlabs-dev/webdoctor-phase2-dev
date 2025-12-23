// /assets/js/pdf-download.js
// iQWEB PDF Download — v1.1 (browser-safe)
// - Exposes window.iqwebDownloadPdf(reportId, [buttonEl])
// - Used by Dashboard history button + Report page button (optional)
// - Calls /.netlify/functions/download-pdf which returns application/pdf

(function () {
  function looksLikeReportId(v) {
    return typeof v === "string" && /^WEB-\d{7}-\d{5}$/.test(v.trim());
  }

  async function downloadPdf(reportId, btn) {
    const id = (reportId || "").trim();
    if (!looksLikeReportId(id)) {
      alert("Report ID not ready yet. Please refresh in a moment.");
      return;
    }

    const originalText = btn ? btn.textContent : null;
    try {
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Preparing…";
      }

      const res = await fetch("/.netlify/functions/download-pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportId: id }),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        console.error("[PDF] download-pdf failed:", res.status, txt);
        throw new Error("PDF download failed");
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `${id}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();

      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[PDF] error:", e);
      alert("PDF download failed. Check Netlify function logs.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = originalText;
      }
    }
  }

  // Expose for other scripts (dashboard.js)
  window.iqwebDownloadPdf = downloadPdf;

  // Optional: if you ever add a button on report.html like:
  // <button id="downloadPdfBtn" data-report-id="WEB-....">Download PDF</button>
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;

    const el =
      t.closest("[data-iqweb-pdf]") ||
      t.closest("#downloadPdfBtn") ||
      t.closest("#downloadPdf") ||
      t.closest("#download-pdf");

    if (!el) return;

    const rid =
      el.getAttribute("data-iqweb-pdf") ||
      el.getAttribute("data-report-id") ||
      el.getAttribute("data-reportid");

    if (!rid) return;

    e.preventDefault();
    downloadPdf(rid, el);
  });
})();
