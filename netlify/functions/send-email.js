// netlify/functions/send-email.js
import fetch from "node-fetch";

export const handler = async (event) => {
  // We expect to be called with a JSON body: { to, credits }
  try {
    const { to, credits } = JSON.parse(event.body || "{}");

    if (!to) {
      return {
        statusCode: 400,
        body: "Missing 'to' email",
      };
    }

    const apiKey = process.env.SENDGRID_API_KEY;
    if (!apiKey) {
      console.error("No SENDGRID_API_KEY set");
      return { statusCode: 500, body: "Email not configured" };
    }

    // you verified a sender in SendGrid, use that address here
    const fromEmail = "YOUR_VERIFIED_SENDER@YOURDOMAIN.com";

    const msg = {
      personalizations: [
        {
          to: [{ email: to }],
          subject: "Your WebDoctor credits are ready 🎉",
        },
      ],
      from: { email: fromEmail, name: "WebDoctor" },
      content: [
        {
          type: "text/plain",
          value: `Thanks! We've added ${credits} credit(s) to your WebDoctor account for ${to}.`,
        },
      ],
    };

    const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(msg),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error("SendGrid error:", text);
      return { statusCode: 500, body: "SendGrid failed" };
    }

    return {
      statusCode: 200,
      body: "Email sent",
    };
  } catch (err) {
    console.error("send-email error:", err);
    return {
      statusCode: 500,
      body: "Server error",
    };
  }
};
