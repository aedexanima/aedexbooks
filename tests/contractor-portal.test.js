/**
 * Contractor Portal & Estimate Management tests.
 *
 * Covers:
 *  1. Portal token — UUID format, stored on job record
 *  2. New job fields present in HEADERS.Jobs (portalToken, contractorEstimate, clientEstimate, contractorInstructions)
 *  3. syncToSheet serializes new job fields correctly
 *  4. loadFromSheet parses new job fields correctly
 *  5. contractor.html exists and contains validatePhotoFiles logic
 *  6. contractor.html rejects invalid token (error state defined)
 *  7. contractor.html shows submitted state for already-submitted token
 *  8. contractor.html photo validation: before photos reject PDF, receipt accepts PDF
 *  9. contractor.html submission locks the portal (submit button disabled during submit)
 * 10. contractorEstimate is separate from clientEstimate (convertToClientEstimate logic)
 * 11. convertToClientEstimate pre-populates line items from contractor labor
 * 12. clientEstimate.lockedAt is null on creation, set when locked
 * 13. Cloudflare Function: create.js expects token + jobId + contractorId
 * 14. Cloudflare Function: get.js returns 404 for missing token
 * 15. Cloudflare Function: submit.js returns 409 if already submitted
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const portalSrc = fs.readFileSync(path.join(__dirname, '../contractor.html'), 'utf8');
const createFn = fs.readFileSync(path.join(__dirname, '../functions/api/portal/create.js'), 'utf8');
const getFn    = fs.readFileSync(path.join(__dirname, '../functions/api/portal/get.js'), 'utf8');
const submitFn = fs.readFileSync(path.join(__dirname, '../functions/api/portal/submit.js'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function extractFn(source, name) {
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const start = source.search(re);
  if (start === -1) return null;
  let depth = 0, i = source.indexOf('{', start), begin = i;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(begin, i + 1); }
    i++;
  }
  return null;
}

// ─── 1. Portal token — UUID format ────────────────────────────────────────────

console.log('\n1. Portal token generation');

assert('crypto.randomUUID() used for token', src.includes('crypto.randomUUID()'));
assert('sendPortalLink function defined', extractFn(src, 'sendPortalLink') !== null);

const sendPortalFn = extractFn(src, 'sendPortalLink');
assert('token stored on job.portalToken', sendPortalFn && sendPortalFn.includes('portalToken'));
assert('portal/create API called with token', sendPortalFn && sendPortalFn.includes('/api/portal/create'));
assert('email sent to contractor after token creation', sendPortalFn && sendPortalFn.includes('gmail.googleapis.com'));

// ─── 2. New job fields in HEADERS ─────────────────────────────────────────────

console.log('\n2. New job fields in HEADERS.Jobs');

const headersLine = src.match(/Jobs:\[([^\]]+)\]/)?.[0] || '';
assert('portalToken in HEADERS.Jobs', headersLine.includes("'portalToken'"));
assert('contractorEstimate in HEADERS.Jobs', headersLine.includes("'contractorEstimate'"));
assert('clientEstimate in HEADERS.Jobs', headersLine.includes("'clientEstimate'"));
assert('contractorInstructions in HEADERS.Jobs', headersLine.includes("'contractorInstructions'"));

// ─── 3. syncToSheet serializes new fields ─────────────────────────────────────

console.log('\n3. syncToSheet — new job fields serialized');

// Locate the syncToSheet function body and check the Jobs row within it
function extractFnByKeyword(source, fnName) {
  const idx = source.indexOf(`async function ${fnName}`);
  if (idx === -1) return null;
  let depth = 0, i = source.indexOf('{', idx), begin = i;
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(begin, i + 1); }
    i++;
  }
  return null;
}
const syncBody = extractFnByKeyword(src, 'syncToSheet') || '';
assert('portalToken serialized in syncToSheet', syncBody.includes('portalToken'));
assert('contractorEstimate serialized (JSON.stringify)', syncBody.includes('contractorEstimate'));
assert('clientEstimate serialized (JSON.stringify)', syncBody.includes('clientEstimate'));
assert('contractorInstructions serialized', syncBody.includes('contractorInstructions'));

// ─── 4. loadFromSheet parses new fields ───────────────────────────────────────

console.log('\n4. loadFromSheet — new job fields parsed');

const loadJobsLine = src.match(/DB\.jobs\s*=\s*parse\([^;]+;/)?.[0] || '';
assert('portalToken parsed in loadFromSheet', loadJobsLine.includes('portalToken'));
assert('contractorEstimate parsed with safeJSON', loadJobsLine.includes('contractorEstimate') && loadJobsLine.includes('safeJSON'));
assert('clientEstimate parsed with safeJSON', loadJobsLine.includes('clientEstimate') && loadJobsLine.includes('safeJSON'));
assert('contractorInstructions parsed', loadJobsLine.includes('contractorInstructions'));

// ─── 5. contractor.html validation ────────────────────────────────────────────

console.log('\n5. contractor.html — structure and validation');

assert('contractor.html exists and is non-empty', portalSrc.length > 1000);
assert('PHOTO_EXTS defined in portal', portalSrc.includes('PHOTO_EXTS'));
assert('PHOTO_MIMES defined in portal', portalSrc.includes('PHOTO_MIMES'));
assert('validatePhotoFiles defined in portal', portalSrc.includes('function validatePhotoFiles'));
assert('portal is mobile-first (viewport meta)', portalSrc.includes('width=device-width'));
assert('state-form present', portalSrc.includes('id="state-form"'));
assert('state-preview present', portalSrc.includes('id="state-preview"'));
assert('state-done present', portalSrc.includes('id="state-done"'));
assert('state-error present', portalSrc.includes('id="state-error"'));

// ─── 6. Invalid token shows error state ───────────────────────────────────────

console.log('\n6. contractor.html — error handling');

assert('loadJob fetches /api/portal/get', portalSrc.includes('/api/portal/get'));
assert('showError called on !data.ok', portalSrc.includes('showError'));
assert('error state displayed when data.ok is false', portalSrc.includes("data.ok") && portalSrc.includes('showError'));

// ─── 7. Already-submitted portal shows done state ─────────────────────────────

console.log('\n7. contractor.html — submitted state handling');

assert("status === 'submitted' shows done state", portalSrc.includes("status === 'submitted'") && portalSrc.includes("show('done')"));

// ─── 8. Photo validation on portal ────────────────────────────────────────────

console.log('\n8. contractor.html — photo validation rules');

// Before photos should NOT allow PDF
const beforeHandlerStart = portalSrc.indexOf('function handleBeforePhotos');
const beforeHandlerEnd = portalSrc.indexOf('\n}', beforeHandlerStart) + 2;
const beforeHandler = beforeHandlerStart !== -1 ? portalSrc.slice(beforeHandlerStart, beforeHandlerEnd) : '';

assert('handleBeforePhotos defined', beforeHandler.length > 0);
assert('before photos call validatePhotoFiles(files, false)', beforeHandler.includes('validatePhotoFiles(files, false)'));

// Receipt handler should allow PDF
const receiptHandlerStart = portalSrc.indexOf('function handleReceipt');
const receiptHandlerEnd = portalSrc.indexOf('\n}', receiptHandlerStart) + 2;
const receiptHandler = receiptHandlerStart !== -1 ? portalSrc.slice(receiptHandlerStart, receiptHandlerEnd) : '';

assert('handleReceipt defined', receiptHandler.length > 0);
assert('receipt calls validatePhotoFiles([file], true) — allows PDF', receiptHandler.includes('validatePhotoFiles([file], true)'));

// ─── 9. Submit button disabled during submission ───────────────────────────────

console.log('\n9. contractor.html — submit locks during submission');

const submitFnBody = extractFn(portalSrc, 'submitEstimate') || '';
assert('submitEstimate defined', submitFnBody.length > 0);
assert('_submitting guard prevents double-submit', submitFnBody.includes('_submitting'));
assert('submit button disabled during submit', submitFnBody.includes('btn.disabled = true') || submitFnBody.includes('btn.disabled=true'));
assert('submit button re-enabled on error', submitFnBody.includes('btn.disabled = false') || submitFnBody.includes('btn.disabled=false'));
assert('photos converted to base64 before send', submitFnBody.includes('fileToBase64'));
assert('token included in submission body', submitFnBody.includes('token: _token') || submitFnBody.includes("token:_token"));

// ─── 10. contractorEstimate separate from clientEstimate ──────────────────────

console.log('\n10. contractorEstimate and clientEstimate are separate');

const convertFn = extractFn(src, 'convertToClientEstimate') || '';
assert('convertToClientEstimate function defined', convertFn.length > 0);
assert('does not modify contractorEstimate', !convertFn.includes('contractorEstimate=') && !convertFn.includes('contractorEstimate ='));
assert('writes to clientEstimate', convertFn.includes('clientEstimate'));
assert('saveAndSync called after conversion', convertFn.includes('saveAndSync'));

// ─── 11. convertToClientEstimate pre-populates from contractor labor ───────────

console.log('\n11. convertToClientEstimate — pre-populates line items');

assert('reads laborItems from contractor estimate', convertFn.includes('laborItems'));
assert('maps labor items to client line item format', convertFn.includes('lineItems'));
assert('preserves desc field', convertFn.includes('desc'));
assert('includes materials as a line item', convertFn.includes('materialsTotal'));

// ─── 12. clientEstimate.lockedAt starts null ──────────────────────────────────

console.log('\n12. clientEstimate.lockedAt lifecycle');

assert('lockedAt initialized to null in convertToClientEstimate', convertFn.includes('lockedAt:null'));
assert('saveClientEstimate function defined', src.includes('function saveClientEstimate'));

// ─── 13. create.js validation ─────────────────────────────────────────────────

console.log('\n13. Cloudflare Function: create.js');

assert('create.js exports onRequestPost', createFn.includes('onRequestPost'));
assert('validates token field required', createFn.includes('!token'));
assert('validates jobId field required', createFn.includes('!jobId'));
assert('validates contractorId field required', createFn.includes('!contractorId'));
assert('stores entry with status: pending', createFn.includes("status: 'pending'"));
assert('sets 30-day TTL on KV entry', createFn.includes('expirationTtl'));
assert('CORS headers present', createFn.includes('Access-Control-Allow-Origin'));

// ─── 14. get.js returns 404 for missing token ─────────────────────────────────

console.log('\n14. Cloudflare Function: get.js');

assert('get.js exports onRequestGet', getFn.includes('onRequestGet'));
assert('returns 404 when token not in KV', getFn.includes('status: 404'));
assert('returns ok: true with entry data on success', getFn.includes("ok: true"));
assert('include=submission returns submission data', getFn.includes("include=submission") || getFn.includes("'submission'"));
assert('reads from PORTAL_TOKENS KV binding', getFn.includes('PORTAL_TOKENS'));

// ─── 15. submit.js returns 409 if already submitted ──────────────────────────

console.log('\n15. Cloudflare Function: submit.js');

assert('submit.js exports onRequestPost', submitFn.includes('onRequestPost'));
assert('returns 409 if already submitted', submitFn.includes('status: 409'));
assert('stores submission with beforePhotos array', submitFn.includes('beforePhotos'));
assert('stores submission with receiptData', submitFn.includes('receiptData'));
assert('updates portal token status to submitted', submitFn.includes("entry.status = 'submitted'") || submitFn.includes("status:'submitted'"));
assert('sends Resend notification email', submitFn.includes('api.resend.com'));
assert('notification is non-blocking (fire and forget)', submitFn.includes('.catch'));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
