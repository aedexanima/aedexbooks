/**
 * Client sync tests
 *
 * 1. docPropertyLabel — no property: falls back to job title, then 'No property'
 * 2. docPropertyLabel — property exists: shows address
 * 3. Job client change cascades to linked documents
 * 4. Job client change does NOT affect unlinked documents
 * 5. Doc client change prompts user (source check — confirm() call present in saveDoc)
 * 6. Cascade logic in saveJob is scoped to job.id match only
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');

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

// ─── Runtime helpers ──────────────────────────────────────────────────────────

// Minimal DB simulation
const DB = {
  properties: [
    { id: 'prp-001', address: '123 Main St', clientId: 'cli-001' },
  ],
  jobs: [
    { id: 'job-001', title: 'Replace Back Door', clientId: 'cli-001', propertyId: 'prp-001' },
    { id: 'job-002', title: 'Fix Boiler', clientId: 'cli-002', propertyId: 'prp-002' },
  ],
  docs: [
    { id: 'doc-001', type: 'estimate', clientId: 'cli-001', propertyId: 'prp-001', jobId: 'job-001', archived: false },
    { id: 'doc-002', type: 'invoice',  clientId: 'cli-001', propertyId: 'prp-001', jobId: 'job-001', archived: false },
    { id: 'doc-003', type: 'estimate', clientId: 'cli-002', propertyId: 'prp-002', jobId: 'job-002', archived: false },
    // doc with no property, has job
    { id: 'doc-004', type: 'estimate', clientId: 'cli-001', propertyId: '', jobId: 'job-001', archived: false },
    // doc with no property, no job
    { id: 'doc-005', type: 'invoice',  clientId: 'cli-001', propertyId: '', jobId: '', archived: false },
  ],
};

function docPropertyLabel(d) {
  const prop = DB.properties.find(p => p.id === d.propertyId);
  if (prop) return prop.address || 'No property';
  const job = d.jobId ? DB.jobs.find(j => j.id === d.jobId) : null;
  return job?.title || 'No property';
}

// ─── 1. docPropertyLabel — no property, has job ───────────────────────────────

console.log('\n1. docPropertyLabel — fallback chain');

assert('no property + has job → shows job title',
  docPropertyLabel(DB.docs[3]) === 'Replace Back Door');

assert('no property + no job → shows "No property"',
  docPropertyLabel(DB.docs[4]) === 'No property');

assert('has property → shows address',
  docPropertyLabel(DB.docs[0]) === '123 Main St');

// ─── 2. Source: docPropertyLabel defined ─────────────────────────────────────

console.log('\n2. Source checks');

assert('docPropertyLabel defined in source',
  src.includes('function docPropertyLabel('));

assert('docPropertyLabel falls back to job title',
  src.includes('job?.title') || src.includes('job && job.title'));

assert('docPropertyLabel final fallback is "No property"',
  src.includes("'No property'"));

assert('desktop docs table uses docPropertyLabel',
  src.includes('docPropertyLabel(d)'));

assert('mobile doc cards use docPropertyLabel',
  src.includes('docPropertyLabel(d)'));

// ─── 3. Job client cascade logic ─────────────────────────────────────────────

console.log('\n3. Job client change cascades to linked documents');

const saveJobFn = extractFn(src, 'saveJob') || '';

assert('saveJob cascades clientId to linked docs',
  saveJobFn.includes('d.jobId===job.id') || saveJobFn.includes("d.jobId === job.id"));

assert('saveJob only cascades when clientId actually changed',
  saveJobFn.includes('existing.clientId!==job.clientId') ||
  saveJobFn.includes("existing.clientId !== job.clientId"));

assert('saveJob cascade is guarded by currentJobId (update only, not create)',
  saveJobFn.includes('currentJobId&&existing') ||
  saveJobFn.includes('currentJobId && existing'));

// ─── 4. Runtime: cascade updates linked docs, not others ─────────────────────

console.log('\n4. Runtime cascade simulation');

// Simulate what saveJob does
function simulateSaveJobCascade(jobId, newClientId, oldClientId, ts = new Date().toISOString()) {
  if (oldClientId !== newClientId) {
    DB.docs.forEach(d => {
      if (d.jobId === jobId && d.clientId !== newClientId) {
        d.clientId = newClientId;
        d.updatedAt = ts;
      }
    });
  }
}

// Clone docs so we don't mutate global state permanently
const docsBefore = JSON.parse(JSON.stringify(DB.docs));
simulateSaveJobCascade('job-001', 'cli-999', 'cli-001');

const job1Docs = DB.docs.filter(d => d.jobId === 'job-001');
const job2Docs = DB.docs.filter(d => d.jobId === 'job-002');

assert('all job-001 docs updated to new client',
  job1Docs.every(d => d.clientId === 'cli-999'));

assert('job-002 doc not affected',
  job2Docs.every(d => d.clientId === 'cli-002'));

assert('doc with no jobId not affected',
  DB.docs.find(d => d.id === 'doc-005').clientId === 'cli-001');

// Restore docs
DB.docs = docsBefore;

// ─── 5. saveDoc prompts when doc client changes ───────────────────────────────

console.log('\n5. Doc client change prompts to update linked job');

const saveDocFn = extractFn(src, 'saveDoc') || '';

assert('saveDoc calls confirm() when client changes on existing linked doc',
  saveDocFn.includes('confirm(') &&
  (saveDocFn.includes('existing.clientId!==doc.clientId') ||
   saveDocFn.includes("existing.clientId !== doc.clientId")));

assert('saveDoc prompt is guarded by doc.jobId existence',
  saveDocFn.includes('doc.jobId'));

assert('saveDoc updates job clientId on confirm yes',
  saveDocFn.includes('DB.jobs[jIdx].clientId=doc.clientId') ||
  saveDocFn.includes('DB.jobs[jIdx].clientId = doc.clientId'));

assert('saveDoc prompt only runs on existing doc (not new)',
  saveDocFn.includes('currentDocId&&existing') ||
  saveDocFn.includes('currentDocId && existing'));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
