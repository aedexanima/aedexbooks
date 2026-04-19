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

  const value = await context.env.ACCESS_LIST.get(email);
  return new Response(JSON.stringify({ allowed: value !== null }), { headers: CORS });
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
