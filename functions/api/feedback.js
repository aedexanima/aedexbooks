// POST /api/feedback
// Receives user feedback from the in-app Help & Feedback form.
// Body: { category, subject, message, email,
//         currentPage, appVersion, timestamp }
// Sends email to aedexanima@gmail.com via Resend.
// No auth required — accessible to all users including unauthenticated.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

const DEST_EMAIL = 'aedexanima@gmail.com';

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), { headers: CORS, status: 400 });
  }

  const { category, subject, message, email, currentPage, appVersion, timestamp } = body;

  if (!category || !subject || !message) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing required fields: category, subject, message' }), { headers: CORS, status: 400 });
  }

  const resendKey = context.env.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Email not configured' }), { headers: CORS, status: 500 });
  }

  // Format: [Bug Report] Subject line
  const emailSubject = `[${category}] ${subject}`;

  const emailBody = [
    `Category: ${category}`,
    `Subject:  ${subject}`,
    ``,
    message,
    ``,
    `─────────────────────────────`,
    `From:     ${email || '(no email provided)'}`,
    `Page:     ${currentPage || '—'}`,
    `Version:  ${appVersion || '—'}`,
    `Time:     ${timestamp ? new Date(timestamp).toLocaleString('en-US', { timeZone: 'America/Chicago' }) : '—'}`,
  ].join('\n');

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'AEDEXBOOKS <notifications@aedexanima.com>',
      to: [DEST_EMAIL],
      reply_to: email || undefined,
      subject: emailSubject,
      text: emailBody,
    }),
  });

  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    console.error('Resend error:', err);
    return new Response(JSON.stringify({ ok: false, error: err.message || 'Email send failed' }), { headers: CORS, status: 502 });
  }

  return new Response(JSON.stringify({ ok: true }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
