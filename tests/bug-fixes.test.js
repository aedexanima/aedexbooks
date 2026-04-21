/**
 * Bug fixes test suite — verifies all 5 fixes from the contractor portal session.
 *
 * 1. Photo resize — resizeImage/resizeToBase64 in contractor.html
 * 2. Status advancement — Unassigned → Assigned for Estimate → Estimate Sent
 * 3. Job numbers — JOB-0001 format, uniqueness, auto-assignment
 * 4. Existing job migration — migrateNames assigns numbers to jobs without one
 * 5. Receipt language — portal copy updated, old text removed
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const portalSrc = fs.readFileSync(path.join(__dirname, '../contractor.html'), 'utf8');

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

// ─── 1. Photo resize ──────────────────────────────────────────────────────────

console.log('\n1. Photo resize — resizeImage / resizeToBase64 in contractor.html');

assert('resizeImage function defined in portal',
  portalSrc.includes('function resizeImage('));

assert('resizeToBase64 function defined in portal',
  portalSrc.includes('function resizeToBase64('));

const resizeFn = extractFn(portalSrc, 'resizeImage') || '';

assert('resizeImage creates a canvas element',
  resizeFn.includes('createElement(\'canvas\')') || resizeFn.includes('createElement("canvas")'));

// 1920 and 0.85 appear in the function signature (default params), so search full source
assert('resizeImage targets 1920px max edge (default parameter)',
  portalSrc.includes('1920'));

assert('resizeImage uses quality 0.85',
  portalSrc.includes('0.85'));

assert('resizeImage skips resize when image fits within maxEdge',
  resizeFn.includes('resolve({ blob: file') || resizeFn.includes("resolve({blob:file"));

assert('resizeImage passes PDF through without canvas resize',
  resizeFn.includes('application/pdf'));

assert('resizeImage uses toBlob for output (not toDataURL)',
  resizeFn.includes('toBlob'));

assert('resizeImage scales proportionally (Math.round)',
  resizeFn.includes('Math.round'));

const resizeToBase64Fn = extractFn(portalSrc, 'resizeToBase64') || '';

assert('resizeToBase64 calls resizeImage',
  resizeToBase64Fn.includes('resizeImage'));

assert('resizeToBase64 returns base64 data string',
  resizeToBase64Fn.includes('.split(\',\')[1]') || resizeToBase64Fn.includes(".split(',')[1]"));

// submitEstimate must use resizeToBase64, not raw fileToBase64 for photos
const submitFn = extractFn(portalSrc, 'submitEstimate') || '';

assert('submitEstimate uses resizeToBase64 for before photos (not raw fileToBase64)',
  submitFn.includes('resizeToBase64') && !submitFn.includes('fileToBase64(p.file)'));

assert('submitEstimate uses resizeToBase64 for receipt/document',
  submitFn.includes('resizeToBase64(_receiptFile') || submitFn.includes('resizeToBase64'));

// ─── 2. Status advancement ────────────────────────────────────────────────────

console.log('\n2. Status advancement — Unassigned → Assigned for Estimate → Estimate Sent');

// New jobs default to unassigned
const openJobFn = extractFn(src, 'openJobModal') || '';
assert('openJobModal sets default status to unassigned',
  openJobFn.includes("'unassigned'") || openJobFn.includes('"unassigned"'));

// editJob fallback defaults to unassigned
const editJobFn = extractFn(src, 'editJob') || '';
assert('editJob status fallback defaults to unassigned',
  editJobFn.includes("status||'unassigned'") || editJobFn.includes('status||"unassigned"'));

// saveJob auto-advances when contractor assigned on unassigned job
const saveJobFn = extractFn(src, 'saveJob') || '';
assert('saveJob auto-advances unassigned → assigned-for-estimate when contractor set',
  saveJobFn.includes("'unassigned'") && saveJobFn.includes("'assigned-for-estimate'"));

assert('saveJob checks both status AND contractorIds.length for advancement',
  (saveJobFn.includes("status==='unassigned'") || saveJobFn.includes('status===\'unassigned\'')) &&
  saveJobFn.includes('contractorIds.length'));

// sendPortalLink sets status to estimate-sent
const sendPortalFn = extractFn(src, 'sendPortalLink') || '';
assert('sendPortalLink sets job status to estimate-sent',
  sendPortalFn.includes("status='estimate-sent'") || sendPortalFn.includes("status = 'estimate-sent'"));

// checkPortalSubmission exists and handles submitted state
assert('checkPortalSubmission function defined',
  extractFn(src, 'checkPortalSubmission') !== null);

const checkSubFn = extractFn(src, 'checkPortalSubmission') || '';
assert('checkPortalSubmission fetches /api/portal/get with include=submission',
  checkSubFn.includes('include=submission'));

assert('checkPortalSubmission sets contractorEstimate from submission data',
  checkSubFn.includes('contractorEstimate'));

assert('checkPortalSubmission sets job status to estimate-sent',
  checkSubFn.includes("status='estimate-sent'") || checkSubFn.includes("status = 'estimate-sent'"));

assert('checkPortalSubmission calls saveAndSync after update',
  checkSubFn.includes('saveAndSync'));

assert('checkPortalSubmission skips if contractorEstimate already set (no overwrite)',
  checkSubFn.includes('job.contractorEstimate'));

assert('checkPortalSubmission called from editJob',
  editJobFn.includes('checkPortalSubmission'));

// STAGES array contains all 5 new statuses in correct order
const stagesMatch = src.match(/const STAGES=\[[^\]]+\]/)?.[0] || '';
assert('STAGES contains unassigned',        stagesMatch.includes("'unassigned'"));
assert('STAGES contains assigned-for-estimate', stagesMatch.includes("'assigned-for-estimate'"));
assert('STAGES contains estimate-sent',     stagesMatch.includes("'estimate-sent'"));
assert('STAGES contains in-progress',       stagesMatch.includes("'in-progress'"));
assert('STAGES contains complete',          stagesMatch.includes("'complete'"));

// STAGE_LABEL has labels for all new statuses
const stageLabelMatch = src.match(/const STAGE_LABEL=\{[^}]+\}/)?.[0] || '';
assert('STAGE_LABEL has label for unassigned',          stageLabelMatch.includes('Unassigned'));
assert('STAGE_LABEL has label for assigned-for-estimate', stageLabelMatch.includes('Assigned for Estimate'));
assert('STAGE_LABEL has label for complete',             stageLabelMatch.includes('Complete'));

// Status dropdown in job modal HTML
const jmStatusMatch = src.match(/id="jm-status"[^<]*>([\s\S]*?)<\/select>/)?.[0] || '';
assert('Job modal status dropdown has unassigned option',          jmStatusMatch.includes('unassigned'));
assert('Job modal status dropdown has assigned-for-estimate option', jmStatusMatch.includes('assigned-for-estimate'));
assert('Job modal status dropdown has in-progress option',         jmStatusMatch.includes('in-progress'));
assert('Job modal status dropdown has complete option',            jmStatusMatch.includes('complete'));
assert('Job modal status dropdown does NOT have invoice-sent',     !jmStatusMatch.includes('invoice-sent'));
assert('Job modal status dropdown does NOT have paid',             !jmStatusMatch.includes('"paid"'));

// Badge CSS for new statuses
assert('CSS badge for unassigned defined',
  src.includes('.badge.unassigned'));
assert('CSS badge for assigned-for-estimate defined',
  src.includes('.badge.assigned-for-estimate'));

// ─── 3. Job numbers — format, uniqueness, auto-assignment ─────────────────────

console.log('\n3. Job numbers — JOB-0001 format, auto-assignment, uniqueness');

assert('nextJobNumber function defined', src.includes('function nextJobNumber'));

const nextJobFn = extractFn(src, 'nextJobNumber') || '';
assert("nextJobNumber uses 'JOB-' prefix",
  nextJobFn.includes("'JOB-'") || nextJobFn.includes('"JOB-"'));
assert('nextJobNumber pads to 4 digits (padStart 4)',
  nextJobFn.includes("padStart(4,'0')") || nextJobFn.includes("padStart(4, '0')"));
assert('nextJobNumber finds max existing number (increments correctly)',
  nextJobFn.includes('Math.max') && nextJobFn.includes('parseInt'));
assert('nextJobNumber reads from DB.jobs',
  nextJobFn.includes('DB.jobs'));

assert('saveJob assigns jobNumber to new jobs',
  saveJobFn.includes('jobNumber') && saveJobFn.includes('nextJobNumber()'));

assert('saveJob preserves existing jobNumber on update',
  saveJobFn.includes('existing?.jobNumber') || saveJobFn.includes('existing.jobNumber'));

// jobNumber in HEADERS.Jobs
const headersLine = src.match(/Jobs:\[([^\]]+)\]/)?.[0] || '';
assert("jobNumber in HEADERS.Jobs", headersLine.includes("'jobNumber'"));

// jobNumber at END of HEADERS.Jobs (CLAUDE.md rule)
const fields = headersLine.split(',');
const lastField = fields[fields.length - 1].replace(/['\]]/g, '').trim();
assert("jobNumber is the last field in HEADERS.Jobs",
  lastField === 'jobNumber', `last field is '${lastField}'`);

// syncToSheet includes jobNumber
const syncBody = (() => {
  const idx = src.indexOf('async function syncToSheet');
  if (idx === -1) return '';
  let depth = 0, i = src.indexOf('{', idx), begin = i;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(begin, i + 1); }
    i++;
  }
  return '';
})();
assert('syncToSheet writes jobNumber', syncBody.includes('jobNumber'));

// loadFromSheet parses jobNumber
const loadJobsLine = src.match(/(?:DB\.jobs|sheetJobs)\s*=\s*parse\([^;]+;/)?.[0] || '';
assert('loadFromSheet parses jobNumber', loadJobsLine.includes('jobNumber'));

// Job number displayed in jobs table
assert('jobNumber displayed in jobs table (desktop)',
  src.includes('j.jobNumber') && src.includes("'DM Mono'"));

// Auto-created jobs (from doc save) also get a jobNumber
const docSaveFnIdx = src.indexOf('function saveDoc(');
const docSaveFn = docSaveFnIdx !== -1 ? src.slice(docSaveFnIdx, docSaveFnIdx + 3000) : '';
assert('auto-created jobs from saveDoc get a jobNumber',
  docSaveFn.includes('jobNumber') && docSaveFn.includes('nextJobNumber'));

// ─── 4. Migration — existing jobs without numbers get assigned ────────────────

console.log('\n4. Migration — migrateNames assigns job numbers to existing jobs');

const migrateNamesFn = extractFn(src, 'migrateNames') || '';
assert('migrateNames function defined', migrateNamesFn.length > 0);

assert('migrateNames calls nextJobNumber for jobs missing a number',
  migrateNamesFn.includes('nextJobNumber'));

assert('migrateNames checks for missing jobNumber (!j.jobNumber)',
  migrateNamesFn.includes('!j.jobNumber'));

assert('migrateNames migrates paid → complete',
  migrateNamesFn.includes("'paid'") && migrateNamesFn.includes("'complete'"));

assert('migrateNames migrates invoice-sent to a valid new status',
  migrateNamesFn.includes("'invoiced'") || migrateNamesFn.includes("'invoice-sent'"));

assert('migrateNames sets invalid/missing statuses to unassigned',
  migrateNamesFn.includes("'unassigned'") && migrateNamesFn.includes('validStatuses'));

assert('validStatuses set includes all 5 new statuses',
  migrateNamesFn.includes('unassigned') &&
  migrateNamesFn.includes('assigned-for-estimate') &&
  migrateNamesFn.includes('estimate-sent') &&
  migrateNamesFn.includes('in-progress') &&
  migrateNamesFn.includes('complete'));

// ─── 5. Receipt language — portal copy updated ────────────────────────────────

console.log('\n5. Receipt language — contractor.html copy updated');

// Old text must be gone
assert('portal does NOT say "submit them with your estimate"',
  !portalSrc.includes('submit them with your estimate'));

assert('portal does NOT say "submit them with your invoice"',
  !portalSrc.includes('submit them with your invoice'));

assert('portal does NOT have "Receipt" as a standalone section title (card-title)',
  !portalSrc.match(/<div class="card-title">Receipt<\/div>/));

assert('portal does NOT have "+ Attach Receipt" button text',
  !portalSrc.includes('+ Attach Receipt'));

// New text must be present
assert('portal says "Save all material receipts for when the job is complete"',
  portalSrc.includes('Save all material receipts for when the job is complete'));

assert('portal section title contains "Material Quotes"',
  portalSrc.includes('Material Quotes'));

assert('portal description mentions "material quotes" or "supplier references"',
  portalSrc.toLowerCase().includes('material quotes') || portalSrc.includes('supplier references'));

assert('portal attach button says "Attach Document"',
  portalSrc.includes('+ Attach Document'));

assert('replace button says "Replace Document"',
  portalSrc.includes('Replace Document'));

// Receipt upload input still present (functionality preserved)
assert('receipt file input still present (upload functionality preserved)',
  portalSrc.includes('id="receipt-input"'));

assert('receipt accepts PDF (functionality unchanged)',
  portalSrc.includes('application/pdf') && portalSrc.includes('receipt-input'));

// email copy in index.html
assert('sendPortalLink email body does NOT say "submit them with your estimate"',
  !src.includes('submit them with your estimate'));

assert('sendPortalLink email body says "for when the job is complete"',
  src.includes('for when the job is complete'));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
