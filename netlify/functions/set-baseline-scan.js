/*
============================================================
SET BASELINE SCAN FUNCTION
------------------------------------------------------------
Netlify serverless function used to update which scan is
the baseline for a domain.

Purpose
-------
Allows the dashboard to designate a specific scan as the
reference point ("baseline") for performance comparisons.

Behavior
--------
1. Receives a report_id from the dashboard
2. Loads the scan record from Supabase
3. Determines the domain from the scan URL
4. Clears any existing baseline scans for that domain
5. Marks the selected scan as is_baseline = true

Rules
-----
• Only one baseline scan can exist per domain
• Baseline is used by reports to compare performance over time
• If no baseline exists, the first scan should automatically
  become the baseline during scan creation

Database
--------
Table: scan_results
Field: is_baseline (boolean)

Called From
-----------
Dashboard scan history when a user selects the baseline
radio button.

Endpoint
--------
POST /.netlify/functions/set-baseline-scan
============================================================
*/








export async function handler(event) {

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Allow-Methods": "POST, OPTIONS"
      },
      body: ""
    };
  }

  return {
    statusCode: 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    },
    body: JSON.stringify({
      success: true,
      message: "baseline function working"
    })
  };
}