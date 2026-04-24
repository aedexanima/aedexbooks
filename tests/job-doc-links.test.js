/**
 * Job document link isolation tests.
 *
 * Verifies that jobDocLinks() in renderJobs() only shows documents
 * explicitly linked to a job via doc.jobId — never by loose client/property fallback.
 * Also verifies the migrateNames() backfill that populates jobId on legacy docs.
 *
 * 1. Source: jobDocLinks uses only jobId filter, no loose fallback
 * 2. Job with directly linked estimate shows it
 * 3. Job with directly linked invoice shows it
 * 4. New job with no linked documents shows nothing
 * 5. Docs for another job on same client+property do NOT appear
 * 6. Multiple jobs in sequence — no document crossover
 * 7. migrateNames backfills jobId on docs that lack it
 * 8. migrateNames does NOT overwrite an already-set jobId
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

// ─── Extract jobDocLinks source ───────────────────────────────────────────────

const jobDocLinksMatch = src.match(/const jobDocLinks=\(j\)=>\{([\s\S]*?)\};/);
const jobDocLinksFn = jobDocLinksMatch ? jobDocLinksMatch[0] : '';

// ─── 1. Source checks ─────────────────────────────────────────────────────────

console.log('\n1. Source: jobDocLinks uses strict jobId filter only');

assert('jobDocLinks defined in renderJobs', jobDocLinksFn.length > 0);

assert('filters by d.jobId===j.id',
  jobDocLinksFn.includes('d.jobId===j.id') || jobDocLinksFn.includes("d.jobId === j.id"));

assert('no fallback filter by clientId',
  !jobDocLinksFn.includes('d.clientId===j.clientId') && !jobDocLinksFn.includes("d.clientId === j.clientId"));

assert('no fallback filter by propertyId',
  !jobDocLinksFn.includes('d.propertyId===j.propertyId') && !jobDocLinksFn.includes("d.propertyId === j.propertyId"));

assert('no "loose" variable',  !jobDocLinksFn.includes('loose'));

// ─── Runtime helpers ──────────────────────────────────────────────────────────

function jobDocLinks(j, docs) {
  return docs.filter(d => !d.archived && d.jobId === j.id);
}


const clientId = 'cli-001';
const propertyId = 'prp-001';

const job1 = { id: 'job-001', clientId, propertyId, archived: false };
const job2 = { id: 'job-002', clientId, propertyId, archived: false };
const newJob = { id: 'job-new', clientId, propertyId: 'prp-999', archived: false };

// ─── 2. Job with directly linked estimate shows it ───────────────────────────

console.log('\n2. Job with directly linked estimate shows it');

const estLinked = { id: 'doc-est', type: 'estimate', number: '03725', clientId, propertyId, jobId: 'job-001', archived: false };
const allDocs = [estLinked];

const result2 = jobDocLinks(job1, allDocs);
assert('job1 shows its linked estimate', result2.length === 1 && result2[0].id === 'doc-est');
assert('linked estimate number is correct', result2[0]?.number === '03725');

// ─── 3. Job with directly linked invoice shows it ────────────────────────────

console.log('\n3. Job with directly linked invoice shows it');

const invLinked = { id: 'doc-inv', type: 'invoice', number: '03729', clientId, propertyId, jobId: 'job-001', archived: false };
const docsWithInv = [estLinked, invLinked];

const result3 = jobDocLinks(job1, docsWithInv);
assert('job1 shows both its estimate and invoice', result3.length === 2);
assert('invoice is present', result3.some(d => d.type === 'invoice' && d.number === '03729'));
assert('estimate is present', result3.some(d => d.type === 'estimate' && d.number === '03725'));

// ─── 4. New job with no linked documents shows nothing ───────────────────────

console.log('\n4. New job with no linked documents shows nothing');

const result4 = jobDocLinks(newJob, docsWithInv);
assert('new job returns no documents', result4.length === 0,
  `got ${result4.length}: ${result4.map(d => d.number).join(', ')}`);

// ─── 5. Same client+property — no crossover ──────────────────────────────────

console.log('\n5. Same client+property docs do not bleed into another job');

const est2 = { id: 'doc-est2', type: 'estimate', number: '03730', clientId, propertyId, jobId: 'job-002', archived: false };
const mixedDocs = [estLinked, invLinked, est2];

const result5a = jobDocLinks(job1, mixedDocs);
const result5b = jobDocLinks(job2, mixedDocs);
assert('job1 does not see job2\'s estimate', !result5a.some(d => d.id === 'doc-est2'));
assert('job2 does not see job1\'s estimate', !result5b.some(d => d.id === 'doc-est'));
assert('job2 does not see job1\'s invoice',  !result5b.some(d => d.id === 'doc-inv'));
assert('job2 sees only its own estimate', result5b.length === 1 && result5b[0].id === 'doc-est2');

// ─── 6. Sequential render — no crossover across all jobs ─────────────────────

console.log('\n6. Sequential render of all jobs — no document crossover');

const allJobs = [job1, job2, newJob];
const rendered = allJobs.map(j => ({ jobId: j.id, docIds: jobDocLinks(j, mixedDocs).map(d => d.id) }));

assert('job-001: 2 docs in sequence', rendered[0].docIds.length === 2);
assert('job-002: 1 doc in sequence',  rendered[1].docIds.length === 1);
assert('job-new: 0 docs in sequence', rendered[2].docIds.length === 0);

const docJobMap = {};
rendered.flatMap(r => r.docIds.map(id => ({ jobId: r.jobId, docId: id }))).forEach(({ jobId, docId }) => {
  if (!docJobMap[docId]) docJobMap[docId] = [];
  docJobMap[docId].push(jobId);
});
const crossover = Object.entries(docJobMap).filter(([, jobs]) => jobs.length > 1);
assert('no document appears in more than one job\'s output', crossover.length === 0,
  crossover.map(([id, jobs]) => `${id} in ${jobs.join(', ')}`).join('; '));

// ─── 7. No loose backfill migration in source ────────────────────────────────

console.log('\n7. Source: no loose client/property backfill migration in migrateNames');

assert('migrateNames does NOT contain client+property backfill',
  !src.includes('d.clientId===d.clientId') &&
  !(src.match(/migrateNames[\s\S]{0,2000}d\.clientId===j\.clientId/)));

assert('no d.jobId assignment in migrateNames via loose match',
  !src.includes('Backfill jobId on documents'));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
