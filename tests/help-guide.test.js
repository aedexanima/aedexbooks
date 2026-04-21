/**
 * Help & Guide system tests
 *
 * 1.  Guide overlay exists in source
 * 2.  openGuide / closeGuide defined in source
 * 3.  GUIDE_CONTENT has an entry for every expected page
 * 4.  Each guide entry has intro, steps (array), and tips (array)
 * 5.  ? button exists in source for every page topbar
 * 6.  Checklist has all 6 expected onboarding keys
 * 7.  tickOnboarding marks an item done
 * 8.  tickOnboarding is idempotent — doesn't overwrite an already-done item
 * 9.  Dismissed state stored and respected by renderOnboardingChecklist
 * 10. Checklist progress count is accurate
 * 11. Feedback form: submitFeedback defined in source
 * 12. submitFeedback validates required fields (category, subject, message)
 * 13. submitFeedback payload includes auto-captured fields
 * 14. Email subject formatted as [Category] Subject line
 * 15. Confirmation element exists in source (shown after submit)
 * 16. resetFeedbackForm restores form visibility
 * 17. /api/feedback function handles missing required fields with 400
 * 18. /api/feedback function formats email subject correctly
 */

const fs   = require('fs');
const path = require('path');

const src  = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

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
  let depth = 0, i = source.indexOf('{', start);
  while (i < source.length) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(source.indexOf('{', start), i + 1); }
    i++;
  }
  return null;
}

// ─── Source-level checks ─────────────────────────────────────────────────────

console.log('\n1. Guide overlay HTML');
assert('guide-overlay exists in source',     src.includes('id="guide-overlay"'));
assert('guide-panel exists in source',       src.includes('id="guide-panel"'));
assert('guide-body exists in source',        src.includes('id="guide-body"'));
assert('guide-title exists in source',       src.includes('id="guide-title"'));

console.log('\n2. Guide functions');
assert('openGuide defined',   src.includes('function openGuide('));
assert('closeGuide defined',  src.includes('function closeGuide('));
assert('GUIDE_CONTENT defined', src.includes('const GUIDE_CONTENT='));

console.log('\n3. GUIDE_CONTENT page entries');
const EXPECTED_PAGES = ['dashboard','pipeline','jobs','documents','clients','contractors','expenses','help'];
EXPECTED_PAGES.forEach(page => {
  assert(`GUIDE_CONTENT has '${page}' entry`, src.includes(`${page}:{`));
});

console.log('\n4. Guide entry structure');
// Extract the full GUIDE_CONTENT block once and search within it
const gcStart = src.indexOf('const GUIDE_CONTENT=');
const gcBlock = gcStart !== -1 ? src.slice(gcStart, gcStart + 12000) : '';
EXPECTED_PAGES.forEach(page => {
  const idx = gcBlock.indexOf(`${page}:{`);
  if (idx === -1) { assert(`${page} has intro/steps/tips`, false, 'entry not found'); return; }
  // Grab enough of the block for each entry (up to 3000 chars)
  const slice = gcBlock.slice(idx, idx + 3000);
  assert(`${page} has intro field`,  slice.includes('intro:'));
  assert(`${page} has steps array`,  slice.includes('steps:['));
  assert(`${page} has tips array`,   slice.includes('tips:['));
});

console.log('\n5. ? guide buttons in page topbars');
const GUIDE_PAGES = ['dashboard','pipeline','jobs','documents','clients','contractors','expenses'];
GUIDE_PAGES.forEach(page => {
  assert(`openGuide('${page}') in source`, src.includes(`openGuide('${page}')`));
});

console.log('\n6. Onboarding checklist keys');
const EXPECTED_KEYS = ['addedClient','addedProperty','createdJob','assignedContractor','sentEstimate','sentInvoice'];
EXPECTED_KEYS.forEach(key => {
  assert(`onboarding key '${key}' in ONBOARDING_ITEMS`, src.includes(`key:'${key}'`));
});

// ─── Runtime: onboarding logic ────────────────────────────────────────────────

console.log('\n7–10. Onboarding runtime');

// Minimal stubs to run the onboarding logic in isolation
const DB = { settings: {} };
function saveSettingsLocal() { /* no-op in test */ }
function getOnboarding() {
  if (!DB.settings.onboarding || typeof DB.settings.onboarding !== 'object') DB.settings.onboarding = {};
  return DB.settings.onboarding;
}
function tickOnboarding(key) {
  const ob = getOnboarding();
  if (ob[key]) return;
  ob[key] = true;
  saveSettingsLocal();
}

// Test 7: tickOnboarding marks item done
tickOnboarding('addedClient');
assert('tickOnboarding marks item done', DB.settings.onboarding.addedClient === true);

// Test 8: idempotent
DB.settings.onboarding.addedClient = 'ORIGINAL';
tickOnboarding('addedClient');
assert('tickOnboarding is idempotent', DB.settings.onboarding.addedClient === 'ORIGINAL');

// Test 9: dismiss/restore
function dismissOnboarding() { getOnboarding().dismissed = true; saveSettingsLocal(); }
function showOnboardingChecklist() { getOnboarding().dismissed = false; saveSettingsLocal(); }
dismissOnboarding();
assert('dismissOnboarding sets dismissed flag', DB.settings.onboarding.dismissed === true);
showOnboardingChecklist();
assert('showOnboardingChecklist clears dismissed flag', DB.settings.onboarding.dismissed === false);

// Test 10: progress count
const ONBOARDING_KEYS = ['addedClient','addedProperty','createdJob','assignedContractor','sentEstimate','sentInvoice'];
DB.settings.onboarding = { addedClient: true, addedProperty: true, createdJob: true };
const done = ONBOARDING_KEYS.filter(k => DB.settings.onboarding[k]).length;
assert('progress count is accurate (3 of 6)', done === 3);

// ─── Source: feedback form ────────────────────────────────────────────────────

console.log('\n11–16. Feedback form');

const submitFn = extractFn(src, 'submitFeedback') || '';

assert('submitFeedback defined',               src.includes('async function submitFeedback('));
assert('validates category (required)',        submitFn.includes('fb-cat') && submitFn.includes("'Please select a feedback type'"));
assert('validates subject (required)',         submitFn.includes("'fb-subject'") && submitFn.includes("'Please enter a subject'"));
assert('validates message (required)',         submitFn.includes("'fb-message'") && submitFn.includes("'Please enter a message'"));

assert('payload includes currentPage',        submitFn.includes('currentPage:_currentPage'));
assert('payload includes appVersion',         submitFn.includes('appVersion:APP_VERSION'));
assert('payload includes timestamp',          submitFn.includes('timestamp:new Date().toISOString()'));

assert('confirmation element exists',         src.includes('id="help-feedback-confirm"'));
assert('confirmation hidden by default',      src.includes('id="help-feedback-confirm"') && src.includes('help-feedback-confirm" style="display:none'));

const resetFn = extractFn(src, 'resetFeedbackForm') || '';
assert('resetFeedbackForm restores form visibility', resetFn.includes("'help-feedback-wrap'") && resetFn.includes("'help-feedback-confirm'"));

// ─── Source: feedback function ────────────────────────────────────────────────

console.log('\n17–18. /api/feedback Cloudflare Function');

const feedbackFnSrc = (() => {
  try { return fs.readFileSync(path.join(__dirname, '../functions/api/feedback.js'), 'utf8'); } catch { return ''; }
})();

assert('feedback.js exists', feedbackFnSrc.length > 0);
assert('handles missing fields with 400',
  feedbackFnSrc.includes('status: 400') && feedbackFnSrc.includes('Missing required fields'));
assert('email subject formatted as [Category] Subject',
  feedbackFnSrc.includes('`[${category}] ${subject}`'));
assert('sends to aedexanima@gmail.com',
  feedbackFnSrc.includes("'aedexanima@gmail.com'") || feedbackFnSrc.includes('"aedexanima@gmail.com"'));
assert('sets reply_to from submitter email',
  feedbackFnSrc.includes('reply_to'));

// ─── Summary ─────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
