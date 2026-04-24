# AEDEXBOOKS — Claude Code Guide

## Development Rules
- **Always explain what you're going to do before writing code**
- **Make small, focused changes — one feature at a time**
- **Commit to Git after every working feature**
- **Run the test suite after any change to core data logic**

## After Every Bug Fix
1. Write a test that would have caught this bug
2. Run full test suite: `node tests/bug-fixes.test.js && node tests/job-doc-links.test.js && node tests/client-sync.test.js && node tests/help-guide.test.js`
3. Check adjacent features for regressions
4. Confirm fix works in both test and live modes

## Before Starting Any Session
- Read this file
- Ask Levi what we're working on today
- Check the last Git commit: `git log --oneline -5`

---

## What this is
Single-file HTML/JS PWA for Aedex Anima LLC (handyman business). Business manager: clients, properties, jobs, estimates, invoices, expenses, contractors, service catalog.

**Live URL:** https://www.aedexbooks.com  
**Deploy:** `npx wrangler pages deploy . --project-name aedexbooks` (from this dir)

---

## Folder structure
```
aedexbooks-app/
├── index.html             ← entire app (HTML + CSS + JS, ~5600 lines)
├── contractor.html        ← contractor portal (unauthenticated, mobile-first)
├── sw.js                  ← service worker, cache name: aedexbooks-v3
├── manifest.json          ← PWA manifest (name: "AEDEXBOOKS — Business Manager")
├── wrangler.toml          ← Cloudflare Pages config + KV namespace bindings
├── functions/
│   └── api/
│       ├── check-access.js      ← GET: KV gate (email → {allowed, sheetId})
│       ├── register-sheet.js    ← POST: saves {sheetId} to KV entry for user
│       ├── feedback.js          ← POST: sends feedback email via Resend to aedexanima@gmail.com
│       └── portal/
│           ├── create.js        ← POST: creates KV portal token entry
│           ├── get.js           ← GET: returns job snapshot (+ submission if include=submission)
│           └── submit.js        ← POST: stores submission, sends Resend notification
├── tests/
│   ├── bug-fixes.test.js        ← general bug regression tests
│   ├── job-doc-links.test.js    ← job/doc linking logic tests
│   ├── client-sync.test.js      ← client sync (cascade + prompt) tests
│   └── help-guide.test.js       ← guide system, onboarding checklist, feedback form tests
└── icons/                 ← PWA icons (192, 512, apple-touch-icon)
```

---

## Stack
| Layer | Tech |
|---|---|
| Hosting | Cloudflare Pages |
| Auth gate | Cloudflare KV `ACCESS_LIST` (id: `20d2c2856c0748c59c544da10f98876d`) |
| Portal tokens | Cloudflare KV `PORTAL_TOKENS` (id: `23df3f4378e54346a70cc3b719480722`) |
| Auth | Google Identity Services (GIS) token client, OAuth popup |
| Data store | Google Sheets (one sheet per user) |
| Drive | Google Drive API `drive.file` scope (photos, PDFs, folder creation) |
| Email (docs/portal link) | Gmail API (MIME multipart with PDF attachment) |
| Email (notifications) | Resend.com — key: `RESEND_API_KEY` Cloudflare secret |
| PDF | jsPDF + html2canvas |
| Fonts | DM Sans + DM Mono (Google Fonts) |

**No build step. No npm. No framework. Deploy = upload the files.**

---

## Auth flow
1. `loadGapi()` — loads GIS + GAPI/Sheets in **parallel** (not sequential)
2. `initTokenClient()` — sets up `tokenClient` with scopes (Sheets, Drive, Gmail, `email profile`)
3. `handleAuth()` — calls `tokenClient.requestAccessToken()` for sign-in; clears token for sign-out
4. Token callback → sets `signedIn=true`, updates **all** sign-in UI **synchronously** before async work:
   - Hides `mob-signin-btn`, shows `mob-user-pill`, sets `mob-auth-btn`/`auth-btn` to "Sign out"
   - Then calls `onSignedIn()` (async) which fetches userinfo → `check-access` → `loadFromSheet()`
5. `gapiReady` flag: if sign-in completes before Sheets API ready, `onSignedIn` returns early; GAPI callback calls `loadFromSheet()` when ready
6. `_signInPending`: if user taps sign-in before GIS loads, shows "tap again" toast

**Critical:** All button text updates must happen **synchronously** in the token callback. Async `onSignedIn()` takes ~1s. If buttons still say "Sign in" during that window, user taps them and triggers sign-out.

---

## Data model (Google Sheets)

Sheet ID stored in KV per user (`check-access` returns it). One tab per entity.

```
const TABS = ['Clients','Properties','Jobs','Documents','Expenses',
               'ActivityLog','SentLog','Contractors','Settings','ServiceCatalog'];
```

### HEADERS (positional — parse() maps by index, not name)
**NEVER insert a field in the middle of a HEADERS array. Always append to the END.**  
Inserting mid-array shifts all subsequent columns and corrupts all existing data.

```javascript
const HEADERS = {
  Clients:     ['id','firstName','lastName','phone','email','billingAddr','ref','notes',
                 'createdAt','updatedAt','archived','clientType','company','altEmail'],
  Properties:  ['id','clientId','address','type','tenantFirstName','tenantLastName',
                 'tenantPhone','tenantEmail','notes','moveInDate','createdAt','updatedAt'],
  Jobs:        ['id','clientId','propertyId','title','status','startDate','endDate','value',
                 'materials','photoNotes','notes','estRef','createdAt','updatedAt','workDetails',
                 'contractorIds','archived','photos','afterFolderId','portalToken',
                 'contractorEstimate','clientEstimate','contractorInstructions','jobNumber'],
  Documents:   ['id','number','estRef','type','clientId','propertyId','date','dueDate',
                 'paymentMethod','notes','lineItems','taxRate','subtotal','taxAmt','total',
                 'paid','createdAt','updatedAt','paymentTerms','laborDisclaimer','archived','jobId'],
  Expenses:    ['id','date','amount','desc','category','jobId','createdAt','updatedAt',
                 'receiptFileId','receiptFileName','receiptWebViewLink'],
  ActivityLog: ['id','ts','action','recordType','recordId','detail'],
  SentLog:     ['id','docId','docNumber','clientId','clientName','propertyId','propertyAddr',
                 'toEmail','ccEmail','subject','message','sentAt'],
  Contractors: ['id','name','trade','phone','email','notes','createdAt','updatedAt'],
  Settings:    ['key','value'],
  ServiceCatalog: ['id','name','type','price','cat']
};
```

### Boolean fields in sheets
- `paid`, `laborDisclaimer`, `archived` stored as lowercase strings `'true'`/`'false'`
- Google Sheets returns booleans as `'TRUE'`/`'FALSE'` — parser uses `String(x).toLowerCase()==='true'`
- `contractorIds` and `photos` stored as JSON array strings — parsed with `safeJSON()`
- `contractorEstimate`, `clientEstimate` stored as JSON strings — parsed with `safeJSON()`

---

## In-memory DB

```javascript
let DB = {
  clients: [], properties: [], jobs: [], docs: [],
  expenses: [], activity: [], sentLog: [], contractors: [],
  catalog: [],
  settings: { bizName, yourName, phone, email, addr, license, taxRate,
               sheetId, logoFileId, userEmail, ... }
};
```

- `saveLocal()` — serializes DB to `localStorage` key `ab_data`; settings to `ab_settings`
- `syncToSheet()` — writes entire DB to Google Sheets (full overwrite per tab, row 2 onward)
- `loadFromSheet()` — reads all tabs, parses into DB, calls `migrateNames()`, re-renders
- `saveAndSync()` — calls `saveLocal()` + `syncToSheet()`

---

## Key conventions

- **IDs:** `cli-`, `prp-`, `job-`, `doc-`, `exp-`, `ctr-` prefixes + timestamp
- **Soft delete:** `archived: true` — filtered in render functions; toggled with "Show archived" checkbox
- **Null guards:** Always `(field||'').toLowerCase()` before string ops; `||'?'` fallbacks on display
- **Navigation:** `goto('section-name')` — NOT `showSection()` (does not exist)

---

## Job statuses (STAGES — in order)
```
unassigned → assigned-for-estimate → estimate-sent → in-progress → invoice-sent → complete
```

Pipeline is a Kanban board with one column per stage. Cards are drag-and-drop between stages.

**Status advancement rules:**
- `saveJob`: `unassigned` → `assigned-for-estimate` when contractor is assigned
- `sendPortalLink`: does NOT advance status
- `checkPortalSubmission`: does NOT advance status
- `sendInvoiceEmail` (estimate doc): → `estimate-sent`
- `sendInvoiceEmail` (invoice doc): → `invoice-sent`
- `saveDoc` (new invoice on `estimate-sent` job): → `in-progress`

Legacy status strings (`paid`, `progress`, `awaiting-payment`, `approved`) are display-mapped in `STAGE_LABEL` for any old data not yet migrated.

---

## Document numbering
`nextNumber()` — unified 5-digit counter across both docs AND jobs:
- Scans all `doc.number` and `job.jobNumber` values, takes max, adds a random bump of 3 or 4
- Falls back to `'03001'` if no numbers exist yet
- Used for both `doc.number` and `job.jobNumber` on create

---

## Client sync (job ↔ docs)
- **Job → Docs (silent cascade):** When saving a job where `clientId` changed, `saveJob` silently updates `clientId` on all docs linked to that job (`d.jobId === job.id`)
- **Doc → Job (user prompt):** When saving a doc where `clientId` changed on an existing doc with a linked job, `saveDoc` calls `confirm()` asking whether to update the linked job's client too
- Job is treated as the source of truth; doc-to-job direction requires user confirmation

---

## `docPropertyLabel(d)` helper
Used in docs table and doc cards to show the property label:
1. If `d.propertyId` matches a property → shows `property.address`
2. Else if `d.jobId` matches a job → shows `job.title`
3. Else → `'No property'`

---

## Drive folder structure (jobs)
```
AEDEX ANIMA LLC/Clients/[ClientName]/[Date — JobTitle]/
  ├── Before/
  ├── After/      ← set to "anyone with link" (makeShareable)
  ├── General/
  └── Receipts/
```
`_jobFolderCache{}` caches folder IDs per jobId **for the session only**.

**`afterFolderId` is persisted to the Jobs sheet and must be read from `DB.jobs`.**  
Never rely on `_jobFolderCache` as the source of truth — it is empty on every new session.  
`drive.file` scope prevents `files.list` across sessions, so `_buildJobFolders` may create a duplicate folder. Always check `job.afterFolderId` from the DB first. Use `resolveAfterFolderFromPhotos()` as fallback for legacy jobs.

---

## Contractor Portal
- **Portal page:** `/contractor.html?token=UUID` — unauthenticated, mobile-first
- **Token:** `crypto.randomUUID()` generated in `sendPortalLink()`, stored on `job.portalToken`
- **Portal link sent via:** Gmail API (same as estimates/invoices) — NOT Resend
- **Submission notification sent via:** Resend.com (back to owner) — NOT Gmail

### KV keys (PORTAL_TOKENS namespace)
- `portal:TOKEN` → job snapshot (30-day TTL)
- `submission:TOKEN` → submitted estimate with base64 photos (30-day TTL)

### KV entry fields (portal:TOKEN)
```
{ jobId, contractorId, contractorName, contractorEmail,
  jobTitle, jobAddress, jobInstructions,
  beforeFolderId, receiptsFolderId,
  bizName, ownerEmail, logoBase64,
  status: 'pending' | 'submitted',
  createdAt, submittedAt? }
```

### Cloudflare Functions
| Endpoint | Method | Auth | Purpose |
|---|---|---|---|
| `/api/check-access` | GET | — | KV gate: email → `{allowed, sheetId}` |
| `/api/register-sheet` | POST | — | Save `sheetId` to user's KV entry |
| `/api/portal/create` | POST | — | Create token entry in KV |
| `/api/portal/get` | GET | — | Get job snapshot; `?include=submission` also returns submitted data |
| `/api/portal/submit` | POST | — | Store submission, mark token submitted, send Resend notification |

### Photo handling
- Contractor photos stored as base64 in `submission:TOKEN` in KV
- When Levi clicks "Save Photos to Drive" in the contractor estimate modal, app fetches from KV and uploads using his OAuth token
- `_estViewPhotos` caches fetched photos — "Save Photos to Drive" does not re-fetch
- After Drive upload, `job.contractorEstimate.photoFileIds[]` holds Drive file IDs; modal switches from base64 thumbnails to Drive links

### Job estimate fields
- `job.contractorEstimate`: `{laborItems, laborSubtotal, materialsTotal, materialsNotes, grandTotal, submittedAt, photoFileIds[], receiptFileId}` — never overwritten once submitted
- `job.clientEstimate`: `{docId, createdAt}` — points to a real doc in `DB.docs`

---

## Convert to Client Estimate flow
1. `convertToClientEstimate(jobId)` — creates a real `estimate` doc in `DB.docs` from `job.contractorEstimate`
2. Line items use doc modal format: `{id, desc, type, price, qty}` — NOT `{rate, amount}`
3. Sets `job.clientEstimate = {docId, createdAt}` — no inline editor
4. Navigates to Documents tab + opens doc modal: `goto('documents'); editDoc(id)`
5. Pipeline card "Est. ✓" badge → `viewContractorEstimate()` (not yet converted); "Est. →" badge → `convertToClientEstimate()` which goes directly to the doc (already converted)
6. `saveDoc` updates `linkedJob.value` from estimate total so pipeline cards stay in sync

---

## Email (type-specific)
- `openSendEmailModal(docId)` — type-aware: different title, subject, body for estimate vs invoice
- `sendInvoiceEmail()` — shared send function, handles both doc types
- Send button label: "✉ Send Estimate" or "✉ Send Invoice"
- Resend notification from: `{bizName} <notifications@aedexanima.com>` (domain verified in Resend)
- Notification to: `entry.ownerEmail` (stored in KV at portal create time from `DB.settings.userEmail`)

---

## Expense editing
- `openExpenseModal(id='')` — pass expense ID to edit, omit to create new
- `_editingExpenseId` — module-level var tracks edit vs create mode
- `saveExpense()` — branches on `_editingExpenseId`
- `deleteExpenseFromModal()` — deletes from inside modal

---

## Service catalog
- Stored in `ServiceCatalog` sheet tab — not in Settings blob
- `DB.catalog[]` — array of `{id, name, type, price, cat}`
- `seedCatalog()` — idempotent by ID; seeds 1 sample item for new users
- Migration: on load, if `Settings.catalog` blob exists and `DB.catalog` is empty, imports old data

---

## Mobile UI
- Fixed 52px top header (`mob-header`) + fixed 60px bottom tab bar (`mob-tab-bar`)
- More drawer: bottom sheet (`mob-more-drawer`) with overlay — opens via `openMoreDrawer()`
- **Ghost-click guard:** `_drawerOpenedAt` timestamp — `mob-auth-btn` ignores taps within 500ms of drawer open
- CSS helpers: `.hide-mobile` (hidden ≤600px), `.show-mobile-only` (visible ≤600px)
- Mobile card views: `job-cards-m`, `doc-cards-m` — populated alongside desktop tables
- Inputs: `min-height: 42px` tap targets (excludes checkboxes/radios)

---

## Service worker
- Cache name: `aedexbooks-v3`
- Strategy: **network-first for HTML** (always gets latest app), cache-first for other assets
- Google API domains always bypass cache (go straight to network)
- Install: caches app shell (index.html, manifest.json); skips waiting immediately

---

## `migrateNames()` (one-time migrations)
- Guarded by `DB.settings` flags so each migration runs exactly once
- Called every time `loadFromSheet()` completes
- `docJobIdReset`: clears all `doc.jobId` once, then safe backfill re-links via explicit `estRef` chains
- Other flags: various status renames, field normalizations

---

## Drive + `uploadFileToDrive`
- `uploadFileToDrive(file, folderId)` — includes `mimeType` in Drive metadata to ensure correct content-type
- `getDriveImageUrl(fileId)` — fetches Drive binary, returns blob URL, caches in `_blobCache`; accepts any successful HTTP response as image (does not check blob MIME type)

---

## KV access management
```bash
# Grant access
npx wrangler kv key put --namespace-id=20d2c2856c0748c59c544da10f98876d "email@example.com" '{"status":"active"}' --remote

# Revoke
npx wrangler kv key delete --namespace-id=20d2c2856c0748c59c544da10f98876d "email@example.com" --remote
```

---

## Guide System
- `GUIDE_CONTENT` — hardcoded object with `{title, intro, steps[], tips[]}` per page key
- Keys: `dashboard`, `pipeline`, `jobs`, `documents`, `clients`, `contractors`, `expenses`, `help`
- `openGuide(key)` — injects content into `#guide-overlay`, locks body scroll, opens overlay
- `closeGuide()` — removes open class, restores body scroll
- Overlay closes on backdrop click or × button
- `?` button sits inline in each page's topbar, to the left of the primary action button
- Desktop: 34×34px circle button; Mobile: 44×44px (adequate tap target)
- Guide footer has "Send Feedback →" link that closes guide and navigates to Help page

## Help & Feedback page (`goto('help')`)
- Accessible from sidebar "Help & Feedback" link (above `.sb-foot`) and mobile More drawer
- Not a Google Sheet tab — UI-only page, no data schema
- `renderHelpPage()` called by `goto('help')` — renders checklist + pre-fills email

### Getting Started Checklist
- State stored in `DB.settings.onboarding` as a flat object, persisted to Settings sheet as `onboarding` key (JSON string)
- Keys: `addedClient`, `addedProperty`, `createdJob`, `assignedContractor`, `sentEstimate`, `sentInvoice`, `dismissed`
- `tickOnboarding(key)` — idempotent, sets flag once, saves to localStorage, re-renders checklist if help page is visible
- Auto-tick hooks: `saveClient()` ticks `addedClient` + `addedProperty`; `saveJob()` ticks `createdJob` + `assignedContractor`; `sendInvoiceEmail()` ticks `sentEstimate` or `sentInvoice`
- Checklist is dismissible (×) and restorable via "Show Getting Started checklist" button
- Progress shown as `X of 6 complete` with an animated fill bar

### Feedback Form
- Category (radio): Bug Report, Feature Request, Question, General Feedback
- Fields: category (required), subject (required), message (required), email (pre-filled from `DB.settings.userEmail`)
- Auto-captured (not shown): `currentPage` (tracked via `_currentPage` var in `goto()`), `appVersion` (`APP_VERSION` constant), `timestamp`
- Submits to `POST /api/feedback` — no auth required
- Shows confirmation div on success; `resetFeedbackForm()` restores form for another submission

### `POST /api/feedback` (`functions/api/feedback.js`)
- No auth gate — accessible regardless of sign-in state
- Email subject: `[Category] Subject line`
- Sends to `aedexanima@gmail.com` via Resend from `notifications@aedexanima.com`
- Sets `reply_to` from submitter's email if provided
- Returns `{ok: true}` or `{ok: false, error}` with appropriate HTTP status

## `APP_VERSION`
- Constant: `const APP_VERSION='2026-04-21'`
- Included in feedback submissions for triage

## Google OAuth
- **Scopes:** `spreadsheets`, `drive.file`, `gmail.send`, `email`, `profile`
- `drive.file` (not `drive`) — only accesses files the app itself created
- Privacy policy: `https://aedexanima.com/privacy`
- OAuth app submitted for Google verification 2026-04-19 (in review, ~4-6 weeks)
