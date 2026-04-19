const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const { sheetId } = body;
  const authHeader = context.request.headers.get('Authorization') || '';
  const accessToken = authHeader.replace('Bearer ', '').trim();

  if (!accessToken || !sheetId) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), { headers: CORS, status: 400 });
  }

  // Verify token with Google — get the email it belongs to
  const tokenRes = await fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${accessToken}`);
  if (!tokenRes.ok) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid token' }), { headers: CORS, status: 401 });
  }
  const tokenData = await tokenRes.json();
  const email = (tokenData.email || '').toLowerCase().trim();

  if (!email) {
    return new Response(JSON.stringify({ ok: false, error: 'Could not verify email' }), { headers: CORS, status: 401 });
  }

  // Only allow if the email already has access
  const existing = await context.env.ACCESS_LIST.get(email);
  if (existing === null) {
    return new Response(JSON.stringify({ ok: false, error: 'No access' }), { headers: CORS, status: 403 });
  }

  // Preserve existing status, just update sheetId
  let data = { status: 'active' };
  try { data = JSON.parse(existing); } catch { data = { status: existing }; }
  data.sheetId = sheetId;

  await context.env.ACCESS_LIST.put(email, JSON.stringify(data));

  return new Response(JSON.stringify({ ok: true }), { headers: CORS });
}

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
