/**
 * Static analysis tests for PDF generation and invoice send fixes.
 *
 * Tests cover:
 *  1. captureDocCanvas — no infinite recursion, uses onclone, sets 720px width
 *  2. All html2canvas call sites route through captureDocCanvas
 *  3. renderRows filters out blank line items
 *  4. Send flow opens/closes preview modal around capture
 *  5. downloadDocPdf, savePdfToDrive, and send all use captureDocCanvas
 *  6. Estimates use the same capture path as invoices
 */

const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../app.html'), 'utf8');

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function extractFn(name) {
  // Grab everything from "async function NAME(" or "function NAME(" to the matching closing brace
  const re = new RegExp(`(?:async )?function ${name}\\s*\\([^)]*\\)\\s*\\{`);
  const start = src.search(re);
  if (start === -1) return null;
  let depth = 0;
  let i = src.indexOf('{', start);
  const begin = i;
  while (i < src.length) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(begin, i + 1); }
    i++;
  }
  return null;
}

// ─── 1. captureDocCanvas structure ────────────────────────────────────────────

console.log('\n1. captureDocCanvas structure');

const captureFn = extractFn('captureDocCanvas');

assert('captureDocCanvas exists', captureFn !== null);

if (captureFn) {
  assert(
    'does not call itself recursively',
    !captureFn.includes('captureDocCanvas(el)') && !captureFn.includes('captureDocCanvas('),
    'found recursive call inside captureDocCanvas'
  );

  assert(
    'calls html2canvas directly (not via captureDocCanvas)',
    captureFn.includes('html2canvas('),
    'html2canvas call missing'
  );

  assert(
    'uses onclone callback',
    captureFn.includes('onclone'),
    'onclone not found — mobile width fix missing'
  );

  assert(
    'sets width to 720px on cloned element',
    captureFn.includes("'720px'") || captureFn.includes('"720px"'),
    '720px not found in captureDocCanvas'
  );

  assert(
    'sets minWidth on cloned element',
    captureFn.includes('minWidth'),
    'minWidth not set'
  );

  assert(
    'targets preview-content by id in clone',
    captureFn.includes('preview-content'),
    'cloned element not targeted by id'
  );
}

// ─── 2. All html2canvas call sites route through captureDocCanvas ──────────────

console.log('\n2. html2canvas call sites');

// Find all occurrences of html2canvas( in the source, minus the one inside captureDocCanvas itself
const captureStart = src.indexOf('async function captureDocCanvas');
const captureEnd   = captureStart + (captureFn ? captureFn.length : 0);

const outsideCaptureSource = src.slice(0, captureStart) + src.slice(captureEnd);
const rawHtml2canvasCalls = (outsideCaptureSource.match(/html2canvas\s*\(/g) || []).length;

assert(
  'no raw html2canvas() calls outside captureDocCanvas',
  rawHtml2canvasCalls === 0,
  `found ${rawHtml2canvasCalls} raw html2canvas call(s) that bypass captureDocCanvas`
);

// ─── 3. All three PDF paths use captureDocCanvas ───────────────────────────────

console.log('\n3. PDF paths (download / save-to-drive / send)');

const downloadFn   = extractFn('downloadDocPdf');
const saveDriveFn  = extractFn('savePdfToDrive');

assert('downloadDocPdf exists',  downloadFn  !== null);
assert('savePdfToDrive exists',  saveDriveFn !== null);

if (downloadFn)  assert('downloadDocPdf uses captureDocCanvas',  downloadFn.includes('captureDocCanvas('));
if (saveDriveFn) assert('savePdfToDrive uses captureDocCanvas',  saveDriveFn.includes('captureDocCanvas('));

// Send function — locate sendInvoiceEmail, not the button definition
const sendFnIdx  = src.indexOf('async function sendInvoiceEmail');
const sendRegion = src.slice(sendFnIdx, sendFnIdx + 6000);
assert(
  'send flow uses captureDocCanvas',
  sendRegion.includes('captureDocCanvas('),
  'captureDocCanvas not found in sendInvoiceEmail'
);

// ─── 4. Send flow modal open/close around capture ─────────────────────────────

console.log('\n4. Send flow: modal open/close around capture');

// The send flow should open preview-modal BEFORE capturing and close it AFTER
const modalOpenIdx   = sendRegion.indexOf("'preview-modal').classList.add('open')");
const captureIdx     = sendRegion.indexOf('captureDocCanvas(');
const modalCloseIdx  = sendRegion.indexOf("'preview-modal').classList.remove('open')");

assert('preview-modal opens before capture',  modalOpenIdx  !== -1 && modalOpenIdx  < captureIdx);
assert('preview-modal closes after capture',  modalCloseIdx !== -1 && modalCloseIdx > captureIdx);

// ─── 5. renderRows filters blank line items ────────────────────────────────────

console.log('\n5. renderRows — blank line item filter');

const renderRowsMatch = src.match(/const renderRows\s*=\s*items\s*=>\s*items\.filter\([^)]+\)/);

assert(
  'renderRows uses .filter() before .map()',
  renderRowsMatch !== null,
  'renderRows does not filter — blank items ($0/no desc) will still appear'
);

if (renderRowsMatch) {
  const filterExpr = renderRowsMatch[0];
  assert(
    'filter checks desc or price',
    filterExpr.includes('desc') && filterExpr.includes('price'),
    `filter expression: ${filterExpr}`
  );
}

// ─── 6. Estimate and invoice use same preview render path ─────────────────────

console.log('\n6. Estimate/invoice shared render path');

const showDocPreviewFn = extractFn('showDocPreview');
assert('showDocPreview exists', showDocPreviewFn !== null);

if (showDocPreviewFn) {
  const showDocPreviewLower = showDocPreviewFn.toLowerCase();
  assert(
    'showDocPreview handles both estimate and invoice types',
    showDocPreviewLower.includes('estimate') && showDocPreviewLower.includes('invoice'),
    'type handling missing in showDocPreview'
  );

  assert(
    'showDocPreview renders into preview-content',
    showDocPreviewFn.includes('preview-content'),
    'preview-content not written by showDocPreview'
  );
}

// viewDoc should delegate to showDocPreview for both types
const viewDocFn = extractFn('viewDoc');
assert('viewDoc exists', viewDocFn !== null);
if (viewDocFn) {
  assert('viewDoc delegates to showDocPreview', viewDocFn.includes('showDocPreview('));
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log(`\n${'─'.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
