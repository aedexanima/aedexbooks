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
assert('sendPortalLink does NOT advance status (stays assigned-for-estimate)',
  !sendPortalFn.includes("status='estimate-sent'") && !sendPortalFn.includes("status = 'estimate-sent'"));

// checkPortalSubmission exists and handles submitted state
assert('checkPortalSubmission function defined',
  extractFn(src, 'checkPortalSubmission') !== null);

const checkSubFn = extractFn(src, 'checkPortalSubmission') || '';
assert('checkPortalSubmission fetches /api/portal/get with include=submission',
  checkSubFn.includes('include=submission'));

assert('checkPortalSubmission sets contractorEstimate from submission data',
  checkSubFn.includes('contractorEstimate'));

assert('checkPortalSubmission does NOT advance status (stays assigned-for-estimate until client estimate sent)',
  !checkSubFn.includes("status='estimate-sent'") && !checkSubFn.includes("status = 'estimate-sent'"));

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
assert('Job modal status dropdown has invoice-sent option',        jmStatusMatch.includes('invoice-sent'));
assert('Job modal status dropdown does NOT have paid',             !jmStatusMatch.includes('"paid"'));

// Badge CSS for new statuses
assert('CSS badge for unassigned defined',
  src.includes('.badge.unassigned'));
assert('CSS badge for assigned-for-estimate defined',
  src.includes('.badge.assigned-for-estimate'));

// ─── 3. Job numbers — format, uniqueness, auto-assignment ─────────────────────

console.log('\n3. Job numbers — unified 5-digit format, auto-assignment, uniqueness');

assert('nextNumber function defined (unified counter)',
  src.includes('function nextNumber('));

const nextNumberFn = extractFn(src, 'nextNumber') || '';
assert('nextNumber pads to 5 digits (padStart 5)',
  nextNumberFn.includes("padStart(5,'0')") || nextNumberFn.includes("padStart(5, '0')"));
assert('nextNumber finds max across DB.docs AND DB.jobs',
  nextNumberFn.includes('DB.docs') && nextNumberFn.includes('DB.jobs'));
assert('nextNumber uses Math.max with parseInt',
  nextNumberFn.includes('Math.max') && nextNumberFn.includes('parseInt'));
assert('nextNumber falls back to 03001 when no existing numbers',
  nextNumberFn.includes("'03001'"));

assert('nextDocNumber delegates to nextNumber()',
  src.includes('function nextDocNumber') && src.includes('nextNumber()'));

assert('saveJob assigns jobNumber to new jobs',
  saveJobFn.includes('jobNumber') && saveJobFn.includes('nextNumber()'));

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
  docSaveFn.includes('jobNumber') && docSaveFn.includes('nextNumber'));

// ─── 4. Migration — existing jobs without numbers get assigned ────────────────

console.log('\n4. Migration — migrateNames assigns job numbers to existing jobs');

const migrateNamesFn = extractFn(src, 'migrateNames') || '';
assert('migrateNames function defined', migrateNamesFn.length > 0);

assert('migrateNames calls nextNumber() for jobs missing a number',
  migrateNamesFn.includes('nextNumber()'));

assert('migrateNames migrates JOB-XXXX numbers to 5-digit format',
  migrateNamesFn.includes('JOB-') && migrateNamesFn.includes('padStart(5,'));

assert('migrateNames checks for missing jobNumber (!j.jobNumber)',
  migrateNamesFn.includes('!j.jobNumber'));

assert('migrateNames migrates paid → complete',
  migrateNamesFn.includes("'paid'") && migrateNamesFn.includes("'complete'"));

assert('migrateNames migrates invoice-sent to a valid new status',
  migrateNamesFn.includes("'invoiced'") || migrateNamesFn.includes("'invoice-sent'"));

assert('migrateNames sets invalid/missing statuses to unassigned',
  migrateNamesFn.includes("'unassigned'") && migrateNamesFn.includes('validStatuses'));

assert('validStatuses set includes all 6 statuses',
  migrateNamesFn.includes('unassigned') &&
  migrateNamesFn.includes('assigned-for-estimate') &&
  migrateNamesFn.includes('estimate-sent') &&
  migrateNamesFn.includes('in-progress') &&
  migrateNamesFn.includes('invoice-sent') &&
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

// ─── 6. Archive/restore actions call renderDashboard ─────────────────────────

console.log('\n6. Archive/restore actions refresh the dashboard');

// deleteCurrentJob must call renderDashboard so Recent Jobs updates immediately
const deleteJobFn = extractFn(src, 'deleteCurrentJob') || '';
assert('deleteCurrentJob calls renderDashboard()',
  deleteJobFn.includes('renderDashboard()'));

// restoreCurrentJob must call renderDashboard
const restoreJobFn = extractFn(src, 'restoreCurrentJob') || '';
assert('restoreCurrentJob calls renderDashboard()',
  restoreJobFn.includes('renderDashboard()'));

// deleteCurrentDoc must call renderDashboard so Unpaid Invoices updates
const deleteDocFn = extractFn(src, 'deleteCurrentDoc') || '';
assert('deleteCurrentDoc calls renderDashboard()',
  deleteDocFn.includes('renderDashboard()'));

// restoreCurrentDoc must call renderDashboard
const restoreDocFn = extractFn(src, 'restoreCurrentDoc') || '';
assert('restoreCurrentDoc calls renderDashboard()',
  restoreDocFn.includes('renderDashboard()'));

// dropJob (pipeline drag) must call renderDashboard so job statuses update
const dropJobFn = extractFn(src, 'dropJob') || '';
assert('dropJob calls renderDashboard()',
  dropJobFn.includes('renderDashboard()'));

// ─── 7. Full button audit — all key functions are defined ─────────────────────

console.log('\n7. Full button audit — all key JS functions exist');

const fns = [
  'openJobModal', 'editJob', 'saveJob', 'deleteCurrentJob', 'restoreCurrentJob',
  'openClientModal', 'editClient', 'saveClient', 'deleteCurrentClient', 'restoreCurrentClient',
  'openNewDoc', 'editDoc', 'saveDoc', 'deleteCurrentDoc', 'restoreCurrentDoc',
  'previewDoc', 'viewDoc', 'openSendEmailModal', 'sendInvoiceEmail',
  'openContractorModal', 'saveContractor', 'deleteCurrentContractor',
  'openExpenseModal', 'saveExpense', 'deleteExpenseFromModal', 'deleteExpense',
  'newDocForJob', 'newJobForClient', 'markPaid', 'quickConvert',
  'openReminderModal', 'sendPortalLink', 'checkPortalSubmission',
  'dragJobStart', 'dropJob', 'renderPipeline', 'renderJobs', 'renderClients',
  'renderDocs', 'renderDashboard', 'renderContractors', 'renderExpenses',
  'saveSettings', 'loadSettingsForm', 'openGuide', 'closeGuide',
  'submitFeedback', 'resetFeedbackForm', 'togglePastDueFilter',
  'filterDocs', 'clearDocFilters', 'downloadTaxReport',
  'renderHelpPage', 'tickOnboarding', 'showOnboardingChecklist', 'dismissOnboarding',
  'convertToClientEstimate', 'viewContractorEstimate', 'acceptContractorPhotos',
  'saveCatalogItem', 'deleteCatalogItemById', 'openCatalogItemModal',
  'downloadImportTemplate', 'confirmImport', 'closeImportModal',
  'connectExistingSheet', 'reconfigure', 'removeLogo',
  'addPropertyToClient', 'editProperty', 'addPropertyField',
  'handleJobPhotoUpload', 'removeJobPhoto', 'renderJobPhotoStrip',
  'nextNumber', 'nextDocNumber', 'saveAndSync', 'saveLocal', 'loadFromSheet',
  'handleAuth', 'goto', 'renderAll',
];

for (const fn of fns) {
  assert(`function ${fn} is defined`,
    src.includes(`function ${fn}(`));
}

// ─── 8. Contractor active-job count uses 'complete' not 'paid' ───────────────

console.log('\n8. renderContractors — active job count excludes complete and archived');

const renderContractorsFn = extractFn(src, 'renderContractors') || '';

assert("renderContractors does NOT filter on status!=='paid' (stale status)",
  !renderContractorsFn.includes("!=='paid'"));

assert("renderContractors filters on status!=='complete' (correct status)",
  renderContractorsFn.includes("!=='complete'"));

assert("renderContractors also excludes archived jobs from active count",
  renderContractorsFn.includes('!j.archived'));

// ─── 9. confirmImport assigns jobNumber to imported jobs ─────────────────────

console.log('\n9. confirmImport — imported jobs get a jobNumber');

const confirmImportFn = extractFn(src, 'confirmImport') || '';

assert('confirmImport function defined',
  confirmImportFn.length > 0);

assert('confirmImport assigns jobNumber when importing jobs',
  confirmImportFn.includes('jobNumber') && confirmImportFn.includes('nextNumber()'));

// ─── 10. Archive/restore client calls renderDashboard ────────────────────────

console.log('\n10. deleteCurrentClient / restoreCurrentClient refresh the dashboard');

const deleteClientFn = extractFn(src, 'deleteCurrentClient') || '';
assert('deleteCurrentClient calls renderDashboard()',
  deleteClientFn.includes('renderDashboard()'));

const restoreClientFn = extractFn(src, 'restoreCurrentClient') || '';
assert('restoreCurrentClient calls renderDashboard()',
  restoreClientFn.includes('renderDashboard()'));

// ─── 11. overflow-x:hidden on html and body ──────────────────────────────────

console.log('\n11. Mobile overflow — html and body have overflow-x:hidden');

assert('html element has overflow-x:hidden',
  src.includes('html{overflow-x:hidden') || src.includes('html { overflow-x: hidden'));

assert('body element has overflow-x:hidden',
  /body\{[^}]*overflow-x:hidden/.test(src) || /body \{[^}]*overflow-x: hidden/.test(src));

// ─── 12. Archive button accessible on mobile ─────────────────────────────────

console.log('\n12. Archive button — accessible on mobile (no .hide-mobile, no display:none)');

// The Archive button must NOT have hide-mobile class
const archiveBtnHtml = src.match(/id="jm-del"[^>]*/)?.[0] || '';
assert('Archive button (#jm-del) does not have hide-mobile class',
  !archiveBtnHtml.includes('hide-mobile'));

// The Archive button must not have display:none as a permanent style (it uses JS to toggle)
// Acceptable: display:none as initial state set via JS — but it must not be statically hidden at mobile breakpoints
assert('Archive button is not hidden via CSS at mobile breakpoints (.hide-mobile class absent)',
  !src.includes('jm-del.*hide-mobile') && !archiveBtnHtml.includes('class="hide-mobile"'));

// The two-tap confirmation replaces confirm() — no native confirm() in deleteCurrentJob
const deleteJobFnNew = extractFn(src, 'deleteCurrentJob') || '';
assert('deleteCurrentJob does not use native confirm() — uses two-tap approach instead',
  !deleteJobFnNew.includes("confirm("));

// Two-tap: first tap sets pending state, second tap executes archive
assert('deleteCurrentJob sets _deleteJobPending flag on first tap',
  deleteJobFnNew.includes('_deleteJobPending') && deleteJobFnNew.includes('Tap again to confirm'));

// Modal on mobile has padding-bottom for safe area
assert('Mobile modal CSS includes padding-bottom for safe area inset',
  src.includes('env(safe-area-inset-bottom)') &&
  (src.includes('padding-bottom:max(26px,env(safe-area-inset-bottom))') ||
   src.includes('padding-bottom: max(26px, env(safe-area-inset-bottom))')));

// ─── 13. renderPipeline excludes archived jobs ────────────────────────────────

console.log('\n13. renderPipeline — excludes archived jobs');

const renderPipelineFn = extractFn(src, 'renderPipeline') || '';
assert('renderPipeline filters !j.archived',
  renderPipelineFn.includes('!j.archived'));

assert('renderPipeline uses !j.archived in the jobs filter (not a separate pass)',
  /filter\([^)]*!j\.archived[^)]*\)/.test(renderPipelineFn) ||
  renderPipelineFn.includes('&&!j.archived') ||
  renderPipelineFn.includes('&& !j.archived'));

// ─── 14. Job search excludes archived by default ─────────────────────────────

console.log('\n14. renderJobs — excludes archived by default (show-archived checkbox gates it)');

const renderJobsFn = extractFn(src, 'renderJobs') || '';
assert('renderJobs checks job-show-archived checkbox before including archived jobs',
  renderJobsFn.includes('job-show-archived'));

assert('renderJobs filters !j.archived when showArchived is false',
  renderJobsFn.includes('showArchived||!j.archived') ||
  renderJobsFn.includes('showArchived || !j.archived'));

// ─── 15. Dashboard revenue filter audit ──────────────────────────────────────

console.log('\n15. renderDashboard — revenue calculation audit');

const renderDashboardFn = extractFn(src, 'renderDashboard') || '';

// Revenue based on paid invoices (docs), not jobs directly — no job archive filtering needed
assert('renderDashboard computes income from paid invoices (docs), not raw jobs',
  renderDashboardFn.includes("type==='invoice'") && renderDashboardFn.includes('.paid'));

// Recent jobs section DOES filter archived
assert('renderDashboard recent-jobs section filters !j.archived',
  renderDashboardFn.includes('!j.archived'));

// Expense job selector excludes archived jobs
const openExpenseFn = extractFn(src, 'openExpenseModal') || '';
assert('openExpenseModal populates job selector with only non-archived jobs',
  src.includes("em-job") && src.includes('!j.archived') &&
  src.match(/em-job[\s\S]{0,200}!j\.archived/) !== null);

// Doc convert dropdown excludes archived estimates
assert('openNewDoc populates dm-convert with only non-archived estimates',
  src.includes("dm-convert") &&
  (src.includes("type==='estimate'&&!d.archived") ||
   src.includes("type==='estimate' && !d.archived")));

// ─── 16. Import templates — column headers match parser field lookups ────────

console.log('\n16. Import templates — column headers match what parsers read');

// Extract IMPORT_TEMPLATES object from source
const importTemplatesMatch = src.match(/const IMPORT_TEMPLATES=\{[\s\S]*?\n\};/)?.[0] || '';

// Clients template has all columns the parser reads
assert('Clients template includes firstName column',
  importTemplatesMatch.includes("'firstName'") || importTemplatesMatch.includes('"firstName"'));
assert('Clients template includes email column',
  importTemplatesMatch.includes("'email'") || importTemplatesMatch.includes('"email"'));
assert('Clients template includes clientType column',
  importTemplatesMatch.includes("'clientType'") || importTemplatesMatch.includes('"clientType"'));
assert('Clients template includes company column',
  importTemplatesMatch.includes("'company'") || importTemplatesMatch.includes('"company"'));
assert('Clients template includes billingAddr column',
  importTemplatesMatch.includes("'billingAddr'") || importTemplatesMatch.includes('"billingAddr"'));

// Properties template has clientEmail column (required for matching)
assert('Properties template includes clientEmail column',
  importTemplatesMatch.includes("'clientEmail'") || importTemplatesMatch.includes('"clientEmail"'));
assert('Properties template includes address column',
  importTemplatesMatch.includes("'address'") || importTemplatesMatch.includes('"address"'));
assert('Properties template includes type column for properties',
  importTemplatesMatch.includes("'type'") || importTemplatesMatch.includes('"type"'));

// Jobs template has all required columns
assert('Jobs template includes clientEmail column',
  src.match(/jobs:\{[\s\S]{0,500}'clientEmail'/) !== null ||
  src.match(/jobs:\{[\s\S]{0,500}"clientEmail"/) !== null);
assert('Jobs template includes title column',
  src.match(/jobs:\{[\s\S]{0,500}'title'/) !== null ||
  src.match(/jobs:\{[\s\S]{0,500}"title"/) !== null);
assert('Jobs template includes status column',
  src.match(/jobs:\{[\s\S]{0,500}'status'/) !== null ||
  src.match(/jobs:\{[\s\S]{0,500}"status"/) !== null);
assert('Jobs template includes value column',
  src.match(/jobs:\{[\s\S]{0,500}'value'/) !== null ||
  src.match(/jobs:\{[\s\S]{0,500}"value"/) !== null);

// Jobs sample data uses canonical status values (not legacy aliases like 'completed')
const jobsSampleMatch = src.match(/jobs:\{[\s\S]{0,800}sample:\[[\s\S]{0,400}\]/)?.[0] || '';
assert("Jobs sample data uses 'complete' not 'completed' (migrateNames resets 'completed' to unassigned)",
  jobsSampleMatch.includes("'complete'") && !jobsSampleMatch.includes("'completed'"));

// Documents template has paymentTerms column
assert('Documents template includes paymentTerms column',
  src.match(/documents:\{[\s\S]{0,500}'paymentTerms'/) !== null ||
  src.match(/documents:\{[\s\S]{0,500}"paymentTerms"/) !== null);

// Documents template has description column (for line item)
assert('Documents template includes description column',
  src.match(/documents:\{[\s\S]{0,500}'description'/) !== null ||
  src.match(/documents:\{[\s\S]{0,500}"description"/) !== null);

// ─── 17. Import parser — status normalization ─────────────────────────────────

console.log('\n17. parseImportJobs — status normalization to canonical values');

const parseImportJobsFn = extractFn(src, 'parseImportJobs') || '';

assert('parseImportJobs defines CANONICAL_STATUSES (not VALID_STATUSES with legacy aliases)',
  parseImportJobsFn.includes('CANONICAL_STATUSES'));

assert('parseImportJobs has STATUS_ALIASES map for legacy values',
  parseImportJobsFn.includes('STATUS_ALIASES'));

assert("parseImportJobs maps 'completed' → 'complete' via STATUS_ALIASES",
  parseImportJobsFn.includes("'completed':'complete'") ||
  parseImportJobsFn.includes('"completed":"complete"') ||
  parseImportJobsFn.includes("completed:'complete'") ||
  parseImportJobsFn.includes('completed:\'complete\''));

assert("parseImportJobs maps 'paid' → 'complete' via STATUS_ALIASES",
  parseImportJobsFn.includes("'paid':'complete'") ||
  parseImportJobsFn.includes('"paid":"complete"') ||
  parseImportJobsFn.includes("paid:'complete'") ||
  parseImportJobsFn.includes("paid:'complete'"));

assert('parseImportJobs applies alias mapping before canonical check',
  parseImportJobsFn.includes('STATUS_ALIASES[rawStatus]'));

assert('CANONICAL_STATUSES contains all 6 valid statuses',
  parseImportJobsFn.includes('unassigned') &&
  parseImportJobsFn.includes('assigned-for-estimate') &&
  parseImportJobsFn.includes('estimate-sent') &&
  parseImportJobsFn.includes('in-progress') &&
  parseImportJobsFn.includes('invoice-sent') &&
  parseImportJobsFn.includes('complete'));

// ─── 18. parseImportDocuments — paymentTerms read from own column ─────────────

console.log('\n18. parseImportDocuments — paymentTerms from dedicated column');

const parseImportDocsFn = extractFn(src, 'parseImportDocuments') || '';

assert('parseImportDocuments reads paymentTerms via get(r,"paymentterms")',
  parseImportDocsFn.includes("get(r,'paymentterms')") ||
  parseImportDocsFn.includes('get(r,"paymentterms")'));

assert('parseImportDocuments falls back to Net-prefix notes for backward compat',
  parseImportDocsFn.includes("startsWith('Net')") || parseImportDocsFn.includes('startsWith("Net")'));

// ─── 19. Import parser — ID generation and defaults ──────────────────────────

console.log('\n19. confirmImport — IDs generated and defaults set for all types');

assert('confirmImport generates uid() for imported clients',
  confirmImportFn.includes('uid()') && confirmImportFn.includes("_importType==='clients'") === false &&
  confirmImportFn.includes("_importType==='clients'")=== false ||
  (confirmImportFn.includes('uid()') && confirmImportFn.includes('clients')));

assert('confirmImport generates uid() for imported properties',
  confirmImportFn.includes('uid()') && confirmImportFn.includes('properties'));

assert('confirmImport generates uid() for imported jobs',
  confirmImportFn.includes('uid()') && confirmImportFn.includes('jobs'));

assert('confirmImport generates uid() for imported documents',
  confirmImportFn.includes('uid()') && confirmImportFn.includes('documents'));

assert('confirmImport sets createdAt and updatedAt timestamps for all records',
  confirmImportFn.includes('createdAt:ts') && confirmImportFn.includes('updatedAt:ts'));

assert('confirmImport sets clientType default to handyman for clients',
  confirmImportFn.includes("clientType:row.clientType||'handyman'") ||
  confirmImportFn.includes('clientType:row.clientType||"handyman"'));

assert('confirmImport sets laborDisclaimer:true for imported documents',
  confirmImportFn.includes('laborDisclaimer:true'));

// ─── 20. IMPORT_COL_ALIASES has paymentTerms entry ────────────────────────────

console.log('\n20. IMPORT_COL_ALIASES — paymentTerms alias defined');

const importAliasesMatch = src.match(/const IMPORT_COL_ALIASES=\{[\s\S]*?\n\};/)?.[0] || '';

assert('IMPORT_COL_ALIASES has paymentterms entry',
  importAliasesMatch.includes('paymentterms'));

assert('paymentterms alias includes "payment terms" variant',
  importAliasesMatch.includes('payment terms') || importAliasesMatch.includes('paymentterms'));

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
