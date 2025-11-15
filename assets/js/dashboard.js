try {
  const result = await runScan(cleaned);
  // result must include: report_id, report_html, score_overal, etc.
  window.lastScanResult = result;

  const score = result.score_overall ?? result.score ?? '—';
  const scanId = result.scan_id ?? result.id ?? result.report_id ?? '—';

  statusEl.textContent = `Scan complete. Score ${score}. Scan ID: ${scanId}.`;
  renderReportPreview(result);

  // enable PDF button now we have a report id
  downloadPdfBtn.disabled = false;
} catch (err) {
  console.error(err);
  statusEl.textContent = 'Scan failed: ' + (err.message || 'Unknown error');
  reportSection.style.display = 'none';
} finally {
  runBtn.disabled = false;
}
