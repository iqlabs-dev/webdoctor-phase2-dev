// example using Resend-style or generic fetch — in phase 2 we just call provider
export const handler = async (event) => {
  const { email, html } = JSON.parse(event.body || '{}');

  if (!email || !html) {
    return { statusCode: 400, body: 'email and html required' };
  }

  // TODO: replace with your provider (Resend, SendGrid, Postmark)
  // pseudo:
  // await fetch('https://api.yourprovider.com/send', { ... })

  return {
    statusCode: 200,
    body: JSON.stringify({ ok: true })
  };
};
