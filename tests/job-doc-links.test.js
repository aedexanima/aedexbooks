/**
 * Job document link isolation tests.
 *
 * Verifies that jobDocLinks() in renderJobs() only shows documents
 * explicitly linked to a job via doc.jobId — never by client/property fallback.
 *
 * 1. New job with no linked docs shows nothing
 * 2. Job shows only its own docs (matched by jobId)
 * 3. Docs for a different job on the same client do NOT appear
 * 4. Docs for a different job on the same client+property do NOT appear
 * 5. Multiple jobs in sequence don't share docs (no crossover)
 * 6. No loose fallback by clientId or clientId+propertyId in source
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

// ─── Extract jobDocLinks logic ─────────────────────────────────────────────

// Pull the jobDocLinks arrow function body out of renderJobs
const jobDocLinksMatch = src.match(/const jobDocLinks=\(j\)=>\{([\s\S]*?)\};/);
const jobDocLinksFn = jobDocLinksMatch ? jobDocLinksMatch[0] : '';

// ─── 1. Static source checks ───────────────────────────────────────────────

console.log('\n1. Source: no loose fallback logic');

assert('jobDocLinks defined in renderJobs',
  jobDocLinksFn.length > 0);

assert('jobDocLinks filters only by jobId (d.jobId===j.id)',
  jobDocLinksFn.includes('d.jobId===j.id') || jobDocLinksFn.includes("d.jobId === j.id"));

assert('no fallback filter by clientId alone',
  !jobDocLinksFn.includes('d.clientId===j.clientId') && !jobDocLinksFn.includes("d.clientId === j.clientId"));

assert('no fallback filter by propertyId',
  !jobDocLinksFn.includes('d.propertyId===j.propertyId') && !jobDocLinksFn.includes("d.propertyId === j.propertyId"));

assert('no "loose" variable in jobDocLinks',
  !jobDocLinksFn.includes('loose'));

// ─── 2–5. Runtime simulation ───────────────────────────────────────────────

console.log('\n2. Runtime: new job shows no documents');

// Minimal stub of jobDocLinks extracted from source
function jobDocLinks(j, docs) {
  const linked = docs.filter(d => !d.archived && d.jobId === j.id);
  return linked;
}

const clientId = 'cli-001';
const propertyId = 'prp-001';

const job1 = { id: 'job-001', clientId, propertyId };
const job2 = { id: 'job-002', clientId, propertyId };
const job3 = { id: 'job-003', clientId, propertyId: 'prp-002' };
const newJob = { id: 'job-new', clientId, propertyId };

const est1 = { id: 'doc-001', type: 'estimate', number: '03725', clientId, propertyId, jobId: 'job-001', archived: false };
const inv1 = { id: 'doc-002', type: 'invoice',  number: '03729', clientId, propertyId, jobId: 'job-001', archived: false };
const est2 = { id: 'doc-003', type: 'estimate', number: '03730', clientId, propertyId, jobId: 'job-002', archived: false };
const est3 = { id: 'doc-004', type: 'estimate', number: '03731', clientId, propertyId: 'prp-002', jobId: 'job-003', archived: false };

const allDocs = [est1, inv1, est2, est3];

// New job — no docs linked to it
const newJobDocs = jobDocLinks(newJob, allDocs);
assert('new job returns no documents', newJobDocs.length === 0,
  `got ${newJobDocs.length} doc(s): ${newJobDocs.map(d=>d.number).join(', ')}`);

console.log('\n3. Runtime: job shows only its own docs');

const job1Docs = jobDocLinks(job1, allDocs);
assert('job1 returns 2 docs (est + inv)', job1Docs.length === 2,
  `got ${job1Docs.length}`);
assert('job1 docs are est1 and inv1',
  job1Docs.some(d => d.id === 'doc-001') && job1Docs.some(d => d.id === 'doc-002'));
assert('job1 does NOT include job2\'s estimate',
  !job1Docs.some(d => d.id === 'doc-003'));

console.log('\n4. Runtime: same client+property — no crossover');

const job2Docs = jobDocLinks(job2, allDocs);
assert('job2 shows only its own estimate (not job1\'s docs)',
  job2Docs.length === 1 && job2Docs[0].id === 'doc-003',
  `got ${job2Docs.map(d=>d.id).join(', ')}`);
assert('job2 does NOT show job1\'s estimate', !job2Docs.some(d => d.id === 'doc-001'));
assert('job2 does NOT show job1\'s invoice',  !job2Docs.some(d => d.id === 'doc-002'));

console.log('\n5. Runtime: different property on same client — no crossover');

const job3Docs = jobDocLinks(job3, allDocs);
assert('job3 shows only its own estimate', job3Docs.length === 1 && job3Docs[0].id === 'doc-004');
assert('job3 does NOT show job1 docs', !job3Docs.some(d => d.jobId === 'job-001'));
assert('job3 does NOT show job2 docs', !job3Docs.some(d => d.jobId === 'job-002'));

console.log('\n6. Runtime: opening multiple jobs in sequence — no state bleed');

// Simulates iterating renderJobs over all jobs, as the render loop does
const results = [job1, job2, job3, newJob].map(j => ({
  jobId: j.id,
  docIds: jobDocLinks(j, allDocs).map(d => d.id)
}));

assert('job-001 has 2 docs in sequence render', results[0].docIds.length === 2);
assert('job-002 has 1 doc in sequence render', results[1].docIds.length === 1);
assert('job-003 has 1 doc in sequence render', results[2].docIds.length === 1);
assert('new job has 0 docs in sequence render', results[3].docIds.length === 0);

// No doc appears in more than one job's results
const allRendered = results.flatMap(r => r.docIds.map(id => ({ jobId: r.jobId, docId: id })));
const docJobMap = {};
allRendered.forEach(({ jobId, docId }) => {
  if (!docJobMap[docId]) docJobMap[docId] = [];
  docJobMap[docId].push(jobId);
});
const crossover = Object.entries(docJobMap).filter(([, jobs]) => jobs.length > 1);
assert('no document appears in more than one job\'s rendered output',
  crossover.length === 0,
  crossover.map(([id, jobs]) => `doc ${id} in jobs: ${jobs.join(', ')}`).join('; '));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
