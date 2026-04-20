// POST /api/portal/create
// Called by aedexbooks (authenticated) when Levi clicks "Send Portal Link".
// Stores a job snapshot in KV keyed by the portal token.
// Body: { token, jobId, contractorId, contractorName, contractorEmail,
//         jobTitle, jobAddress, jobInstructions, jobNotes,
//         beforeFolderId, receiptsFolderId }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

export async function onRequestPost(context) {
  let body;
  try { body = await context.request.json(); } catch {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid JSON' }), { headers: CORS, status: 400 });
  }

  const { token, jobId, contractorId, contractorName, contractorEmail,
          jobTitle, jobAddress, jobInstructions,
          beforeFolderId, receiptsFolderId } = body;

  if (!token || !jobId || !contractorId) {
    return new Response(JSON.stringify({ ok: false, error: 'Missing required fields' }), { headers: CORS, status: 400 });
  }

  const entry = {
    jobId,
    contractorId,
    contractorName: contractorName || '',
    contractorEmail: contractorEmail || '',
    jobTitle: jobTitle || '',
    jobAddress: jobAddress || '',
    jobInstructions: jobInstructions || '',
    beforeFolderId: beforeFolderId || '',
    receiptsFolderId: receiptsFolderId || '',
    status: 'pending',
    createdAt: new Date().toISOString(),
  };

  // 30-day TTL in seconds
  await context.env.PORTAL_TOKENS.put(`portal:${token}`, JSON.stringify(entry), { expirationTtl: 60 * 60 * 24 * 30 });

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
