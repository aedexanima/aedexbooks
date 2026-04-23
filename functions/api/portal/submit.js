// POST /api/portal/submit
// Called by the contractor portal when the contractor submits their estimate.
// Body: { token, laborItems, laborSubtotal, materialsTotal, materialsNotes,
//         grandTotal, beforePhotos (base64 array), receiptData (base64 obj) }
// Stores the submission in KV, marks the token as submitted, sends notification email.

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), { headers: CORS, status: 400 });
  }

  const { token, laborItems, laborSubtotal, materialsTotal, materialsNotes,
          grandTotal, beforePhotos, receiptData } = body;

  if (!token) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing token' }), { headers: CORS, status: 400 });
  }

  const raw = await context.env.PORTAL_TOKENS.get(`portal:${token}`);
  if (raw === null) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid or expired link' }), { headers: CORS, status: 404 });
  }

  let entry;
  try { entry = JSON.parse(raw); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Corrupt entry' }), { headers: CORS, status: 500 });
  }

  if (entry.status === 'submitted') {
    return new Response(JSON.stringify({ ok: false, error: 'Already submitted' }), { headers: CORS, status: 409 });
  }

  const submittedAt = new Date().toISOString();

  // Store the full submission (includes base64 photos) — 30-day TTL
  const submission = {
    laborItems: laborItems || [],
    laborSubtotal: laborSubtotal || 0,
    materialsTotal: materialsTotal || 0,
    materialsNotes: materialsNotes || '',
    grandTotal: grandTotal || 0,
    beforePhotos: beforePhotos || [],   // [{name, type, data (base64)}]
    receiptData: receiptData || null,   // {name, type, data (base64)} | null
    submittedAt,
  };

  await context.env.PORTAL_TOKENS.put(
    `submission:${token}`,
    JSON.stringify(submission),
    { expirationTtl: 60 * 60 * 24 * 30 }
  );

  // Mark portal token as submitted
  entry.status = 'submitted';
  entry.submittedAt = submittedAt;
  await context.env.PORTAL_TOKENS.put(`portal:${token}`, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 30 });

  // Send notification email via Resend
  const resendKey = context.env.RESEND_API_KEY;
  const ownerEmail = entry.ownerEmail;

  if (resendKey && ownerEmail) {
    const bizName = entry.bizName || 'AEDEXBOOKS';
    const appUrl = new URL(context.request.url).origin;

    const emailBody = [
      `${entry.contractorName || 'A contractor'} has submitted an estimate.`,
      ``,
      `Job:       ${entry.jobTitle || '—'}`,
      `Address:   ${entry.jobAddress || '—'}`,
      ``,
      `Labor:     $${(laborSubtotal || 0).toFixed(2)}`,
      `Materials: $${(materialsTotal || 0).toFixed(2)}`,
      `Total:     $${(grandTotal || 0).toFixed(2)}`,
      ``,
      `Submitted: ${new Date(submittedAt).toLocaleString('en-US', { timeZone: 'America/Chicago' })}`,
      ``,
      `Open your portal to review:`,
      appUrl,
    ].join('\n');

    // context.waitUntil keeps the Worker context alive after the Response is returned
    // so the Resend fetch actually completes instead of being cancelled mid-flight
    context.waitUntil(
      fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${resendKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: `${bizName} <notifications@aedexanima.com>`,
          to: [ownerEmail],
          subject: `Estimate submitted — ${entry.jobTitle || 'Job'} (${entry.contractorName || 'Contractor'})`,
          text: emailBody,
        }),
      }).catch(e => console.error('Resend notification failed:', e))
    );
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
