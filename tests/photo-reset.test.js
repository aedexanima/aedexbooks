/**
 * Photo reset tests — verifies that a new job always starts with empty photo strips.
 *
 * Scenarios:
 *  1. openJobModal clears _jobPhotos before renderJobPhotoStrip
 *  2. closeModal resets _jobPhotos and clears the three strip elements
 *  3. editJob loads only the specific job's photos (no cross-job bleed)
 *  4. saveJob uses [..._jobPhotos] so a cleared array produces photos:[]
 *  5. acceptContractorPhotos uses currentJobId at resolve time (async safety)
 *  6. handleJobPhotoUpload pushes into _jobPhotos (not DB directly)
 *  7. No code path opens the job modal without resetting _jobPhotos
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

// ─── 1. openJobModal ──────────────────────────────────────────────────────────

console.log('\n1. openJobModal resets photo state before rendering');

const openJobFn = extractFn('openJobModal') || '';
assert('openJobModal exists', openJobFn.length > 0);

// _jobPhotos=[] must appear BEFORE renderJobPhotoStrip() in the function body
const photosClearIdx   = openJobFn.indexOf('_jobPhotos=[]') !== -1
  ? openJobFn.indexOf('_jobPhotos=[]')
  : openJobFn.indexOf('_jobPhotos = []');
const renderStripIdx   = openJobFn.indexOf('renderJobPhotoStrip()');

assert('openJobModal sets _jobPhotos=[] before renderJobPhotoStrip()',
  photosClearIdx !== -1 && renderStripIdx !== -1 && photosClearIdx < renderStripIdx);

assert('openJobModal sets currentJobId=null',
  openJobFn.includes('currentJobId=null') || openJobFn.includes('currentJobId = null'));

assert('openJobModal calls renderJobPhotoStrip()',
  openJobFn.includes('renderJobPhotoStrip()'));

// ─── 2. closeModal resets job photo state ─────────────────────────────────────

console.log('\n2. closeModal resets _jobPhotos and clears strips when job-modal closes');

const closeModalFn = extractFn('closeModal') || '';
assert('closeModal function exists', closeModalFn.length > 0);

assert("closeModal checks for 'job-modal' specifically",
  closeModalFn.includes("'job-modal'") || closeModalFn.includes('"job-modal"'));

assert('closeModal resets _jobPhotos=[] on job-modal close',
  closeModalFn.includes('_jobPhotos=[]') || closeModalFn.includes('_jobPhotos = []'));

assert('closeModal clears jm-before-strip innerHTML',
  closeModalFn.includes('jm-before-strip'));

assert('closeModal clears jm-after-strip innerHTML',
  closeModalFn.includes('jm-after-strip'));

assert('closeModal clears jm-photo-strip innerHTML',
  closeModalFn.includes('jm-photo-strip'));

assert('closeModal sets strip innerHTML to empty string',
  closeModalFn.includes("innerHTML=''") || closeModalFn.includes('innerHTML = ""') || closeModalFn.includes("innerHTML=''") || closeModalFn.includes("el.innerHTML=''"));

// ─── 3. editJob loads only this job's photos ──────────────────────────────────

console.log('\n3. editJob replaces _jobPhotos with only the specific job\'s photos');

const editJobFn = extractFn('editJob') || '';
assert('editJob exists', editJobFn.length > 0);

assert('editJob replaces _jobPhotos (not appends) from j.photos',
  editJobFn.includes('_jobPhotos=[...(j.photos') ||
  editJobFn.includes('_jobPhotos = [...(j.photos'));

assert('editJob uses spread to copy (no reference sharing)',
  editJobFn.includes('[...') && editJobFn.includes('j.photos'));

assert('editJob calls renderJobPhotoStrip() after setting _jobPhotos',
  editJobFn.indexOf('renderJobPhotoStrip()') > editJobFn.indexOf('_jobPhotos'));

// ─── 4. saveJob uses _jobPhotos snapshot ─────────────────────────────────────

console.log('\n4. saveJob snapshots _jobPhotos at save time (spread copy)');

const saveJobFn = extractFn('saveJob') || '';
assert('saveJob uses [..._jobPhotos] (spread snapshot, not reference)', saveJobFn.includes('[..._jobPhotos]'));

assert('photos field in job object comes from _jobPhotos, not DB',
  saveJobFn.includes('photos:[..._jobPhotos]') || saveJobFn.includes('photos: [..._jobPhotos]'));

// ─── 5. acceptContractorPhotos async safety ───────────────────────────────────

console.log('\n5. acceptContractorPhotos sets _jobPhotos from currentJobId at resolve time');

const acceptFn = extractFn('acceptContractorPhotos') || '';
assert('acceptContractorPhotos exists', acceptFn.length > 0);

// It uses currentJobId (live variable) not a captured closure — this is intentional:
// if the modal switched to a new job (currentJobId=null), the find returns undefined
// and _jobPhotos gets set to [] (safe outcome)
assert('acceptContractorPhotos sets _jobPhotos from DB.jobs lookup at resolve time',
  acceptFn.includes('_jobPhotos=DB.jobs.find') || acceptFn.includes('_jobPhotos = DB.jobs.find'));

assert('acceptContractorPhotos falls back to [] if job not found',
  acceptFn.includes('?.photos||[]') || acceptFn.includes('?.photos || []'));

// ─── 6. handleJobPhotoUpload pushes into _jobPhotos (not DB) ─────────────────

console.log('\n6. handleJobPhotoUpload pushes uploaded photo into _jobPhotos staging array');

const uploadFn = extractFn('handleJobPhotoUpload') || '';
assert('handleJobPhotoUpload exists', uploadFn.length > 0);

assert('pushes into _jobPhotos (not DB.jobs directly)',
  uploadFn.includes('_jobPhotos.push('));

assert('does NOT directly mutate DB.jobs photos in the upload path',
  !uploadFn.includes('DB.jobs[idx].photos.push'));

assert('calls renderJobPhotoStrip() after push to update UI',
  uploadFn.includes('renderJobPhotoStrip()'));

// ─── 7. No code path opens job modal without resetting _jobPhotos ─────────────

console.log('\n7. All job-modal entry points reset _jobPhotos');

// Every path that sets job-modal to 'open' must go through openJobModal or editJob
// Verify there's no raw classList.add('open') for job-modal outside those two functions

// Extract all code outside openJobModal and editJob
const openJobStart = src.indexOf('function openJobModal(');
const openJobEnd = openJobStart + (openJobFn?.length || 0) + 50;
const editJobStart = src.indexOf('function editJob(');
const editJobEnd = editJobStart + (editJobFn?.length || 0) + 50;

// Check that the only places that add 'open' class to job-modal are within those functions
const openClassMatches = [...src.matchAll(/job-modal.*classList\.add\('open'\)|classList\.add\('open'\).*job-modal/g)];
assert('job-modal classList.add open appears only in openJobModal and editJob',
  openClassMatches.every(m => {
    const idx = m.index;
    return (idx >= openJobStart && idx <= openJobEnd) || (idx >= editJobStart && idx <= editJobEnd);
  }), `found ${openClassMatches.length} occurrences`);

// ─── 8. renderJobPhotoStrip reads from _jobPhotos (not DB) ───────────────────

console.log('\n8. renderJobPhotoStrip renders from _jobPhotos only');

const renderStripFn = extractFn('renderJobPhotoStrip') || '';
assert('renderJobPhotoStrip exists', renderStripFn.length > 0);

assert('renderJobPhotoStrip reads _jobPhotos (not DB.jobs)',
  renderStripFn.includes('_jobPhotos'));

assert('renderJobPhotoStrip does NOT read from DB.jobs directly',
  !renderStripFn.includes('DB.jobs'));

assert('renderJobPhotoStrip sets innerHTML="" when photos is empty',
  renderStripFn.includes("innerHTML=photos.length") ||
  renderStripFn.includes("innerHTML = photos.length") ||
  renderStripFn.includes("strip.innerHTML="));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
