// netlify/functions/send-pin.js
// Sends a 6-digit OTP email (not a magic link)

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ success: false, message: "Method not allowed" })
    };
  }

  let { email } = JSON.parse(event.body || "{}");
  email = (email || "").trim().toLowerCase();

  if (!email) {
    return {
      statusCode: 400,
      body: JSON.stringify({ success: false, message: "Email required" })
    };
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  const resp = await fetch(`${url}/auth/v1/otp`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email,
      create_user: true,
      type: "email",      // <-- forces OTP code, NOT magic link
      channel: "email"    // <-- REQUIRED to avoid magic link fallback
    })
  });

  if (!resp.ok) {
    const text = await resp.text();
    console.error("OTP error:", text);
    return {
      statusCode: 500,
      body: JSON.stringify({ success: false, message: "Could not send code" })
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true })
  };
}
