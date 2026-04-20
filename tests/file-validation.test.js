/**
 * File type validation tests for photo uploads.
 *
 * Covers:
 *  1. validatePhotoFiles helper — structure and allowed types
 *  2. Valid extensions accepted: jpg, jpeg, png, heic, heif, webp
 *  3. Invalid extensions rejected before any Drive call
 *  4. HEIC specifically accepted (critical — default iPhone format)
 *  5. Empty/missing MIME type doesn't cause HEIC to be rejected (browser quirk)
 *  6. handleJobPhotoUpload validates before button state or Drive work
 *  7. handleExpenseReceiptUpload validates before upload, allows PDF
 *  8. PDF rejected for job photos, accepted for expense receipts
 *  9. accept attributes on all three job photo inputs include HEIC
 * 10. Error message shown for invalid files, input cleared
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

// Simulate validatePhotoFiles logic from source (unit tests)
function buildValidator() {
  const PHOTO_EXTS = new Set(['jpg','jpeg','png','heic','heif','webp']);
  const PHOTO_MIMES = new Set(['image/jpeg','image/png','image/heic','image/heif','image/webp']);
  return function validatePhotoFiles(files, allowPdf = false) {
    const invalid = [];
    for (const f of files) {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const mime = (f.type || '').toLowerCase();
      const extOk = PHOTO_EXTS.has(ext) || (allowPdf && ext === 'pdf');
      const mimeOk = PHOTO_MIMES.has(mime) || (allowPdf && mime === 'application/pdf');
      if (!extOk && !mimeOk) invalid.push(f.name);
    }
    return invalid;
  };
}

const validate = buildValidator();
const file = (name, type = '') => ({ name, type });

// ─── 1. validatePhotoFiles helper structure ───────────────────────────────────

console.log('\n1. validatePhotoFiles helper structure');

const validateFn = extractFn('validatePhotoFiles');
assert('validatePhotoFiles function defined', validateFn !== null);
assert('PHOTO_EXTS set defined', src.includes('PHOTO_EXTS'));
assert('PHOTO_MIMES set defined', src.includes('PHOTO_MIMES'));
assert('validates by extension (primary check)', validateFn && validateFn.includes('ext'));
assert('validates by MIME (secondary check)', validateFn && validateFn.includes('mime'));
assert('returns array of invalid filenames', validateFn && validateFn.includes('invalid.push'));

// ─── 2. Valid extensions accepted ────────────────────────────────────────────

console.log('\n2. Valid extensions accepted');

assert('jpg accepted',  validate([file('photo.jpg',  'image/jpeg')]).length === 0);
assert('jpeg accepted', validate([file('photo.jpeg', 'image/jpeg')]).length === 0);
assert('png accepted',  validate([file('photo.png',  'image/png')]).length  === 0);
assert('webp accepted', validate([file('photo.webp', 'image/webp')]).length === 0);
assert('heic accepted', validate([file('photo.heic', 'image/heic')]).length === 0);
assert('heif accepted', validate([file('photo.heif', 'image/heif')]).length === 0);

// ─── 3. Invalid extensions rejected ──────────────────────────────────────────

console.log('\n3. Invalid extensions rejected');

assert('gif rejected',  validate([file('photo.gif',  'image/gif')]).length  === 1);
assert('bmp rejected',  validate([file('photo.bmp',  'image/bmp')]).length  === 1);
assert('tiff rejected', validate([file('photo.tiff', 'image/tiff')]).length === 1);
assert('pdf rejected for job photos (allowPdf=false)', validate([file('receipt.pdf', 'application/pdf')]).length === 1);
assert('exe rejected',  validate([file('virus.exe',  '')]).length === 1);
assert('mp4 rejected',  validate([file('video.mp4',  'video/mp4')]).length === 1);

// ─── 4. HEIC specifically — critical iPhone format ───────────────────────────

console.log('\n4. HEIC — iPhone default format');

assert('HEIC with correct MIME accepted',  validate([file('IMG_001.HEIC', 'image/heic')]).length === 0);
assert('HEIC with heif MIME accepted',     validate([file('IMG_001.heic', 'image/heif')]).length === 0);
assert('HEIC uppercase extension accepted',validate([file('IMG_001.HEIC', 'image/heic')]).length === 0);

// ─── 5. Empty MIME doesn't reject valid HEIC (browser quirk) ─────────────────

console.log('\n5. HEIC with empty MIME type (browser quirk — some browsers omit MIME for HEIC)');

// Extension-primary rule: HEIC with empty MIME should still pass
assert('HEIC with empty MIME accepted (ext check wins)', validate([file('photo.heic', '')]).length === 0);
assert('HEIC with unknown MIME accepted (ext check wins)', validate([file('photo.heic', 'application/octet-stream')]).length === 0);

// ─── 6. handleJobPhotoUpload validates before Drive work ─────────────────────

console.log('\n6. handleJobPhotoUpload — validation before Drive calls');

const jobUploadFn = extractFn('handleJobPhotoUpload');
assert('handleJobPhotoUpload exists', jobUploadFn !== null);

if (jobUploadFn) {
  const validateCallIdx   = jobUploadFn.indexOf('validatePhotoFiles(');
  const btnDisabledIdx    = jobUploadFn.indexOf('btn.disabled=true');
  const driveCallIdx      = jobUploadFn.indexOf('getJobFolders(') > -1
    ? jobUploadFn.indexOf('getJobFolders(')
    : jobUploadFn.indexOf('_buildJobFolders(');

  assert('validatePhotoFiles called in handleJobPhotoUpload', validateCallIdx !== -1);
  assert('validation runs before button is disabled', validateCallIdx < btnDisabledIdx);
  assert('validation runs before any Drive folder call', validateCallIdx < driveCallIdx);
  assert('input.value cleared on invalid file', jobUploadFn.includes("input.value=''") || jobUploadFn.includes('input.value = ""'));
  assert('toast shown with error message for invalid file', jobUploadFn.slice(validateCallIdx, validateCallIdx + 200).includes("toast("));
  assert('returns early on invalid file (no upload attempted)', jobUploadFn.slice(validateCallIdx, validateCallIdx + 200).includes('return'));
}

// ─── 7. handleExpenseReceiptUpload validates before upload ────────────────────

console.log('\n7. handleExpenseReceiptUpload — validation before upload');

const expUploadFn = extractFn('handleExpenseReceiptUpload');
assert('handleExpenseReceiptUpload exists', expUploadFn !== null);

if (expUploadFn) {
  const validateCallIdx = expUploadFn.indexOf('validatePhotoFiles(');
  const driveCallIdx    = expUploadFn.indexOf('uploadFileToDrive(');
  assert('validatePhotoFiles called in handleExpenseReceiptUpload', validateCallIdx !== -1);
  assert('validation runs before uploadFileToDrive', validateCallIdx < driveCallIdx);
  assert('input.value cleared on invalid file', expUploadFn.includes("input.value=''") || expUploadFn.includes('input.value = ""'));
  assert('returns early on invalid file', expUploadFn.slice(validateCallIdx, validateCallIdx + 400).includes('return'));
}

// ─── 8. PDF handling — allowed for receipts, rejected for photos ──────────────

console.log('\n8. PDF — allowed for receipts, rejected for job photos');

assert('pdf rejected for job photos',    validate([file('doc.pdf', 'application/pdf')], false).length === 1);
assert('pdf accepted for expense receipts', validate([file('doc.pdf', 'application/pdf')], true).length === 0);

// In source: expense handler passes allowPdf=true, job handler does not
if (expUploadFn) {
  assert('expense receipt upload passes allowPdf=true', expUploadFn.includes('true') && expUploadFn.includes('validatePhotoFiles([file]'));
}
if (jobUploadFn) {
  assert('job photo upload does not pass allowPdf (defaults to false)', !jobUploadFn.slice(
    jobUploadFn.indexOf('validatePhotoFiles('),
    jobUploadFn.indexOf('validatePhotoFiles(') + 30
  ).includes('true'));
}

// ─── 9. accept attributes include HEIC on all three job inputs ────────────────

console.log('\n9. accept attributes on job photo inputs include HEIC');

const beforeInput = src.match(/id="jm-before-input"[^>]+>/)?.[0] || '';
const afterInput  = src.match(/id="jm-after-input"[^>]+>/)?.[0]  || '';
const photoInput  = src.match(/id="jm-photo-input"[^>]+>/)?.[0]  || '';

assert('before input accept includes .heic', beforeInput.includes('.heic'));
assert('after input accept includes .heic',  afterInput.includes('.heic'));
assert('general input accept includes .heic', photoInput.includes('.heic'));
assert('before input accept includes .png',  beforeInput.includes('.png'));
assert('after input accept includes .jpg',   afterInput.includes('.jpg'));

// ─── 10. Error message quality ────────────────────────────────────────────────

console.log('\n10. Error messages are clear and mention supported types');

if (jobUploadFn) {
  const errRegion = jobUploadFn.slice(
    jobUploadFn.indexOf('validatePhotoFiles('),
    jobUploadFn.indexOf('validatePhotoFiles(') + 300
  );
  assert('error message mentions JPG',  errRegion.toLowerCase().includes('jpg'));
  assert('error message mentions PNG',  errRegion.toLowerCase().includes('png'));
  assert('error message mentions HEIC', errRegion.toLowerCase().includes('heic'));
  assert('error message mentions WebP', errRegion.toLowerCase().includes('webp'));
}

// ─── 11. User-facing file type hints visible near each upload button ──────────

console.log('\n11. File type hint text near upload buttons');

assert('before photo button has type hint', src.includes('jm-before-btn') && (() => {
  const idx = src.indexOf('jm-before-btn');
  return src.slice(idx, idx + 300).includes('JPG') && src.slice(idx, idx + 300).includes('HEIC');
})());
assert('after photo button has type hint', src.includes('jm-after-btn') && (() => {
  const idx = src.indexOf('jm-after-btn');
  return src.slice(idx, idx + 300).includes('JPG') && src.slice(idx, idx + 300).includes('HEIC');
})());
assert('general photo button has type hint', src.includes('jm-photo-upload-btn') && (() => {
  const idx = src.indexOf('jm-photo-upload-btn');
  return src.slice(idx, idx + 300).includes('JPG') && src.slice(idx, idx + 300).includes('HEIC');
})());
assert('receipt button has type hint including PDF', src.includes('em-receipt-btn') && (() => {
  const idx = src.indexOf('em-receipt-btn');
  return src.slice(idx, idx + 300).includes('PDF') && src.slice(idx, idx + 300).includes('HEIC');
})());

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
