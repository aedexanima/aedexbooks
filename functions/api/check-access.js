const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const email = (url.searchParams.get('email') || '').toLowerCase().trim();

  if (!email) {
    return new Response(JSON.stringify({ allowed: false }), { headers: CORS });
  }

  const raw = await context.env.ACCESS_LIST.get(email);
  if (raw === null) {
    return new Response(JSON.stringify({ allowed: false }), { headers: CORS });
  }

  // Support both old format ("active"/"owner") and new format (JSON)
  let sheetId = '';
  try {
    const data = JSON.parse(raw);
    sheetId = data.sheetId || '';
  } catch {
    // Old string format — no sheetId yet
  }

  return new Response(JSON.stringify({ allowed: true, sheetId }), { headers: CORS });
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
