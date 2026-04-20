// GET /api/portal/get?token=XYZ[&include=submission]
// Returns job snapshot for a valid, pending portal token.
// With include=submission, also returns the submitted estimate data (for aedexbooks to review).

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const token = (url.searchParams.get('token') || '').trim();
  const includeSubmission = url.searchParams.get('include') === 'submission';

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

  const response = { ok: true, ...entry };

  if (includeSubmission && entry.status === 'submitted') {
    const subRaw = await context.env.PORTAL_TOKENS.get(`submission:${token}`);
    if (subRaw) {
      try { response.submission = JSON.parse(subRaw); } catch { response.submission = null; }
    }
  }

  return new Response(JSON.stringify(response), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
