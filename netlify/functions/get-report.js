    // --- 2) Load the HTML template file (v5.0) ---
    const templatePath = path.join(__dirname, "report_template_v5_0.html");
    console.log("[get-report] Using template path:", templatePath);

    let templateHtml;

    // ⬇️ DEBUG: list files that actually exist beside this function on Netlify
    try {
      const filesHere = fs.readdirSync(__dirname);
      console.log("[get-report] __dirname:", __dirname);
      console.log("[get-report] Files in __dirname:", filesHere);
    } catch (listErr) {
      console.error("[get-report] Could not list __dirname:", listErr);
    }

    try {
      templateHtml = fs.readFileSync(templatePath, "utf8");
    } catch (tplErr) {
      console.error("[get-report] Could not read template:", tplErr);
      return {
        statusCode: 500,
        headers: { "Content-Type": "text/plain" },
        body: "Report template missing on server.",
      };
    }
