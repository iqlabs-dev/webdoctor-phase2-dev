// /assets/js/report-history-pdf.js
// Runs ONLY when report opened from Scan History (?from=history)
// Replaces the Refresh button with Download PDF (calls /.netlify/functions/download-pdf)

(function () {
  function getParam(name) {
    const p = new URLSearchParams(window.location.search);
    return p.get(name);
  }

  function getReportId() {
    const p = new URLSearchParams(window.location.search);
    return p.get("report_id") || p.get("id") || "";
  }

  function looksLikeReportId(v) {
    return typeof v === "string" && /^WEB-\d{7}-\d{5}$/.test(v.trim());
  }

  async function downloadPdf(reportId, btn) {
    const original = btn ? btn.textContent : "Download PDF";
    try {
      if (!looksLikeReportId(reportId)) {
        alert("Report ID not ready yet.");
        return;
      }

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
        console.error("[PDF] download failed:", res.status, txt);
        throw new Error("PDF download failed");
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
      console.error(e);
      alert("PDF download failed. Check Netlify function logs.");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = original;
      }
    }
  }

  function findRefreshButton() {
    // Try common IDs first (fast + reliable)
    const byId =
      document.getElementById("refreshBtn") ||
      document.getElementById("refreshReport") ||
      document.getElementById("btn-refresh") ||
      document.getElementById("refresh");

    if (byId) return byId;

    // Fallback: find a button with text "Refresh"
    const buttons = Array.from(document.querySelectorAll("button, a"));
    return buttons.find((el) => (el.textContent || "").trim().toLowerCase() === "refresh") || null;
  }

  function replaceWithDownloadPdf() {
    const from = (getParam("from") || "").toLowerCase();
    if (from !== "history") return; // ✅ NO CHANGE to normal OSD report view

    const reportId = getReportId();
    const btn = findRefreshButton();
    if (!btn) {
      console.warn("[history-pdf] Could not find Refresh button to replace.");
      return;
    }

    // Replace label + click handler
    btn.textContent = "Download PDF";
    btn.onclick = (e) => {
      e.preventDefault?.();
      downloadPdf(reportId, btn);
    };
  }

  document.addEventListener("DOMContentLoaded", replaceWithDownloadPdf);
})();
