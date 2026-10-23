// POST /api/send-doc-email
// Sends an invoice/estimate/reminder email with a PDF attachment via Resend,
// from the already-verified aedexanima.com domain (better deliverability than
// sending from a user's personal Gmail account).
//
// Sender address is a single named constant so this can later point at a
// dedicated multi-tenant sending domain without touching the rest of the logic.
// Body: { userEmail, bizName, fromEmail, to, cc, bcc, subject, message,
//         pdf (base64, no data: prefix), filename }

const FROM_ADDRESS = 'notifications@aedexanima.com';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), { headers: CORS, status: 400 });
  }

  const { userEmail, bizName, fromEmail, to, cc, bcc, subject, message, pdf, filename } = body;

  if (!userEmail) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing userEmail' }), { headers: CORS, status: 400 });
  }
  if (!to || !subject || !message || !pdf || !filename) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing required fields' }), { headers: CORS, status: 400 });
  }

  const access = await context.env.ACCESS_LIST.get(userEmail.toLowerCase().trim());
  if (access === null) {
    return new Response(JSON.stringify({ ok: false, error: 'Not authorized' }), { headers: CORS, status: 403 });
  }

  const resendKey = context.env.RESEND_API_KEY;
  if (!resendKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Email not configured' }), { headers: CORS, status: 500 });
  }

  const resp = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${bizName || 'AEDEXBOOKS'} <${FROM_ADDRESS}>`,
      to: [to],
      cc: cc ? [cc] : undefined,
      bcc: bcc ? [bcc] : undefined,
      reply_to: fromEmail || undefined,
      subject,
      text: message,
      attachments: [{ filename, content: pdf }],
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
