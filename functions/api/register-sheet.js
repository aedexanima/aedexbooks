const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  const body = await context.request.json().catch(() => ({}));
  const { email, sheetId } = body;

  if (!email || !sheetId) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing fields' }), { headers: CORS, status: 400 });
  }

  const normalEmail = email.toLowerCase().trim();

  // Only allow if the email already has access
  const existing = await context.env.ACCESS_LIST.get(normalEmail);
  if (existing === null) {
    return new Response(JSON.stringify({ ok: false, error: 'No access' }), { headers: CORS, status: 403 });
  }

  // Preserve existing status, just update sheetId
  let data = { status: 'active' };
  try { data = JSON.parse(existing); } catch { data = { status: existing }; }
  data.sheetId = sheetId;

  await context.env.ACCESS_LIST.put(normalEmail, JSON.stringify(data));

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
