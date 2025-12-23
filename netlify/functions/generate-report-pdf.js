// /.netlify/functions/generate-report-pdf.js
import "dotenv/config";
import crypto from "crypto";

const DOCRAPTOR_API_KEY = process.env.DOCRAPTOR_API_KEY;
const DOCRAPTOR_TEST = process.env.DOCRAPTOR_TEST === "true";
const PDF_TOKEN_SECRET = process.env.PDF_TOKEN_SECRET;

function b64url(input) {
  return Buffer.from(input)
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function signPdfToken(payloadObj) {
  const header = { alg: "HS256", typ: "JWT" };
  const headerB64 = b64url(JSON.stringify(header));
  const payloadB64 = b64url(JSON.stringify(payloadObj));
  const data = `${headerB64}.${payloadB64}`;
  const sig = crypto.createHmac("sha256", PDF_TOKEN_SECRET).update(data).digest("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  return `${data}.${sig}`;
}

export async function handler(event) {
  try {
    const body = JSON.parse(event.body || "{}");
    const reportId = String(body.report_id || "").trim();
    if (!reportId) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing reportId" }) };
    }

    // Ensure narrative exists BEFORE generating the PDF (PDF must match OSD).
    // PDF mode never triggers narrative client-side.
    const base =
      (process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL || "").replace(/\/$/, "");
    const siteBase = base || ""; // may be empty in local dev

    async function hasNarrativeNow() {
      try {
        const u = `${siteBase}/.netlify/functions/get-report-data?report_id=${encodeURIComponent(reportId)}`;
        const r = await fetch(u, { headers: { "Accept": "application/json" } });
        if (!r.ok) return false;
        const j = await r.json();
        const n = j?.narrative;
        const lines = Array.isArray(n?.overall?.lines) ? n.overall.lines : [];
        return lines.length > 0;
      } catch {
        return false;
      }
    }

    async function triggerNarrative() {
      const u = `${siteBase}/.netlify/functions/generate-narrative`;
      const r = await fetch(u, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify({ report_id: reportId }),
      });
      if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(t || `generate-narrative failed (${r.status})`);
      }
      return true;
    }

    // If narrative missing, start it and poll briefly
    if (!(await hasNarrativeNow())) {
      await triggerNarrative();
      const start = Date.now();
      while (Date.now() - start < 90000) {
        if (await hasNarrativeNow()) break;
        await new Promise(r => setTimeout(r, 2500));
      }
    }

    const exp = Math.floor(Date.now() / 1000) + (10 * 60); // 10 min
    const pdfToken = signPdfToken({ rid: reportId, exp });

    const documentUrl =
      `${siteBase}/report.html?report_id=${encodeURIComponent(reportId)}` +
      `&pdf=1&pdf_token=${encodeURIComponent(pdfToken)}`;

    const payload = {
      doc: {
        test: DOCRAPTOR_TEST,
        document_url: documentUrl,
        name: `${reportId}.pdf`,
        document_type: "pdf",
        javascript: true,
        // IMPORTANT: wait for docraptorJavaScriptFinished() which report-data.js calls in PDF mode
        javascript_wait_function: "docraptorJavaScriptFinished",
        prince_options: {
          baseurl: siteBase,
        },
      },
    };

    const res = await fetch("https://api.docraptor.com/docs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + Buffer.from(DOCRAPTOR_API_KEY + ":").toString("base64"),
      },
      body: JSON.stringify(payload.doc),
    });

    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { statusCode: 500, body: JSON.stringify({ error: t || `DocRaptor error ${res.status}` }) };
    }

    const pdfBuffer = Buffer.from(await res.arrayBuffer());

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportId}.pdf"`,
        "Cache-Control": "no-store",
      },
      body: pdfBuffer.toString("base64"),
      isBase64Encoded: true,
    };

  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e?.message || String(e) }) };
  }
}
