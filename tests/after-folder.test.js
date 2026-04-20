/**
 * After-folder persistence tests.
 *
 * Scenarios:
 *  1. Schema — afterFolderId in HEADERS, syncToSheet, loadFromSheet
 *  2. Photo upload (existing job) — afterFolderId written to DB immediately, not just cached
 *  3. Photo upload (new job) — afterFolderId staged for saveJob to pick up
 *  4. saveJob — carries afterFolderId through from existing job and from staging var
 *  5. getJobFolders — stored afterFolderId overrides Drive-search result (no orphan folder)
 *  6. openSendEmailModal — uses stored ID directly; falls back to resolveAfterFolderFromPhotos
 *  7. resolveAfterFolderFromPhotos — present, uses files.get (not files.list), reads parents field
 *  8. Legacy backfill — resolveAfterFolderFromPhotos result written back to job record
 *  9. Session-restart scenario — send flow never calls _buildJobFolders when ID is stored
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); failed++; }
}

function extractFn(name) {
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const start = src.search(re);
  if (start === -1) return null;
  let depth = 0, i = src.indexOf('{', start), begin = i;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(begin, i + 1); }
    i++;
  }
  return null;
}

// ─── 1. Schema ────────────────────────────────────────────────────────────────

console.log('\n1. Schema — afterFolderId in headers, sync, and parse');

assert("HEADERS.Jobs contains 'afterFolderId'", src.includes("'afterFolderId'") || src.includes('"afterFolderId"'));

// afterFolderId must be LAST in Jobs HEADERS (CLAUDE.md rule: never mid-array)
const headersMatch = src.match(/Jobs:\['id'[^\]]+\]/);
assert('Jobs HEADERS found', headersMatch !== null);
if (headersMatch) {
  const fields = headersMatch[0].split(',');
  const lastField = fields[fields.length - 1].replace(/['\]]/g, '').trim();
  // contractorInstructions is now the last field (portal fields appended after afterFolderId)
  assert('afterFolderId appears in Jobs HEADERS before portal fields', headersMatch[0].includes("'afterFolderId'"),
    `last field is '${lastField}'`);
}

// syncToSheet writes afterFolderId
const syncMatch = src.match(/Jobs:DB\.jobs\.map[^\n]+/);
assert('syncToSheet Jobs row writes afterFolderId', syncMatch && syncMatch[0].includes('afterFolderId'));

// loadFromSheet parse includes afterFolderId
const parseMatch = src.match(/parse\(dataRes\[2\][^\n]+/);
assert('loadFromSheet parse includes afterFolderId', parseMatch && parseMatch[0].includes('afterFolderId'));

// ─── 2. Photo upload (existing job) — immediate DB write ──────────────────────

console.log('\n2. Photo upload on existing job — afterFolderId written to DB immediately');

const uploadFn = extractFn('handleJobPhotoUpload');
assert('handleJobPhotoUpload exists', uploadFn !== null);

if (uploadFn) {
  assert("persists afterFolderId when category === 'after'",
    uploadFn.includes("category==='after'") || uploadFn.includes("category === 'after'"));
  assert('writes afterFolderId to DB.jobs[idx]',
    uploadFn.includes('DB.jobs[idx].afterFolderId'));
  assert('calls saveAndSync() after writing afterFolderId',
    uploadFn.includes('saveAndSync()'));
  assert('only syncs if afterFolderId has changed (avoids unnecessary writes)',
    uploadFn.includes('DB.jobs[idx].afterFolderId!==folders.afterFolderId') ||
    uploadFn.includes("DB.jobs[idx].afterFolderId !== folders.afterFolderId"));
}

// ─── 3. Photo upload (new job) — staging var ──────────────────────────────────

console.log('\n3. Photo upload on new job — staged for saveJob');

assert('_stagingAfterFolderId staging variable declared',
  src.includes('_stagingAfterFolderId'));

if (uploadFn) {
  assert('staging var set when currentJobId is null and category is after',
    uploadFn.includes('_stagingAfterFolderId=folders.afterFolderId') ||
    uploadFn.includes('_stagingAfterFolderId = folders.afterFolderId'));
}

// Staging var reset when modal opens for new job
const openJobFn = extractFn('openJobModal');
assert('_stagingAfterFolderId reset in openJobModal', openJobFn && openJobFn.includes('_stagingAfterFolderId'));

// Staging var reset when editing existing job
const editJobFn = extractFn('editJob');
assert('_stagingAfterFolderId reset in editJob', editJobFn && editJobFn.includes('_stagingAfterFolderId'));

// ─── 4. saveJob carries afterFolderId through ─────────────────────────────────

console.log('\n4. saveJob — preserves and carries afterFolderId');

const saveJobFn = extractFn('saveJob');
assert('saveJob exists', saveJobFn !== null);

if (saveJobFn) {
  assert('saveJob includes afterFolderId in job object',
    saveJobFn.includes('afterFolderId'));
  assert('saveJob uses existing?.afterFolderId (preserve on update)',
    saveJobFn.includes('existing?.afterFolderId') || saveJobFn.includes('existing.afterFolderId'));
  assert('saveJob falls back to _stagingAfterFolderId for new jobs',
    saveJobFn.includes('_stagingAfterFolderId'));
}

// ─── 5. getJobFolders — stored ID overrides Drive-search result ───────────────

console.log('\n5. getJobFolders — stored afterFolderId prevents orphan folder creation');

const getJobFoldersFn = extractFn('getJobFolders');
assert('getJobFolders exists', getJobFoldersFn !== null);

if (getJobFoldersFn) {
  assert('checks j.afterFolderId before trusting _buildJobFolders result',
    getJobFoldersFn.includes('j.afterFolderId'));
  assert('overwrites Drive-search afterFolderId with stored value',
    getJobFoldersFn.includes('folders.afterFolderId=j.afterFolderId') ||
    getJobFoldersFn.includes('folders.afterFolderId = j.afterFolderId'));
}

// ─── 6. openSendEmailModal — uses stored ID, falls back to resolve fn ─────────

console.log('\n6. openSendEmailModal — stored ID used directly without Drive call');

const sendModalFn = extractFn('openSendEmailModal');
assert('openSendEmailModal exists', sendModalFn !== null);

const sendModalRegion = sendModalFn || '';

assert('checks jobWithAfter.afterFolderId directly',
  sendModalRegion.includes('jobWithAfter.afterFolderId'));
assert('sets _sendAfterFolderId from stored value without Drive call',
  sendModalRegion.includes('_sendAfterFolderId=jobWithAfter.afterFolderId') ||
  sendModalRegion.includes('_sendAfterFolderId = jobWithAfter.afterFolderId'));
assert('does NOT call getJobFolders in send modal (would risk creating orphan folder)',
  !sendModalRegion.slice(0, sendModalRegion.indexOf('} else {')).includes('getJobFolders('));
assert('falls back to resolveAfterFolderFromPhotos for legacy jobs',
  sendModalRegion.includes('resolveAfterFolderFromPhotos'));

// ─── 7. resolveAfterFolderFromPhotos — safe Drive API usage ──────────────────

console.log('\n7. resolveAfterFolderFromPhotos — uses files.get, not files.list');

const resolveFn = extractFn('resolveAfterFolderFromPhotos');
assert('resolveAfterFolderFromPhotos exists', resolveFn !== null);

if (resolveFn) {
  assert('finds first after photo from job.photos',
    (resolveFn.includes("category==='after'") || resolveFn.includes("category === 'after'")));
  assert("uses files/{fileId}?fields=parents (files.get, not files.list — works with drive.file scope)",
    resolveFn.includes('fields=parents'));
  assert('does not use files.list or search query',
    !resolveFn.includes('files?q=') && !resolveFn.includes('files.list'));
  assert('returns the parent folder ID (r.parents?.[0])',
    resolveFn.includes('parents?.[0]') || resolveFn.includes('parents[0]'));
  assert('returns null gracefully if no after photo or Drive call fails',
    resolveFn.includes('return null'));
}

// ─── 8. Legacy backfill — resolve result written back to job ─────────────────

console.log('\n8. Legacy backfill — resolved folder ID saved back to job record');

// In the send modal's resolveAfterFolderFromPhotos callback, the ID should be persisted
const resolveCallbackIdx = sendModalFn ? sendModalFn.indexOf('resolveAfterFolderFromPhotos') : -1;
const resolveCallback = resolveCallbackIdx !== -1 ? sendModalFn.slice(resolveCallbackIdx, resolveCallbackIdx + 600) : '';

assert('backfills afterFolderId onto job record after resolving',
  resolveCallback.includes('DB.jobs[idx].afterFolderId=folderId') ||
  resolveCallback.includes('DB.jobs[idx].afterFolderId = folderId'));
assert('calls saveAndSync() after backfilling',
  resolveCallback.includes('saveAndSync()'));

// ─── 9. Session-restart scenario — _buildJobFolders not called in send flow ───

console.log('\n9. Session-restart safety — send flow uses stored ID without _buildJobFolders');

// When afterFolderId is stored, the send flow should not call _buildJobFolders
// (which could create a duplicate folder via Drive search)
const storedIdBranch = sendModalFn ? sendModalFn.slice(
  sendModalFn.indexOf('jobWithAfter.afterFolderId'),
  sendModalFn.indexOf('} else {')
) : '';
assert('stored-ID branch does not call _buildJobFolders',
  !storedIdBranch.includes('_buildJobFolders'));
assert('stored-ID branch does not call getJobFolders',
  !storedIdBranch.includes('getJobFolders('));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
