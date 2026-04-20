# AEDEXBOOKS — Claude Code Guide

## Development Rules
- **Always explain what you're going to do before writing code**
- **Make small, focused changes — one feature at a time**
- **Commit to Git after every working feature**

## After Every Bug Fix
1. Write a test that would have caught this bug
2. Run full test suite
3. Check adjacent features for regressions
4. Confirm fix works in both test and live Stripe modes if payment-related

## Before Starting Any Session
- Read this file
- Ask Levi what we're working on today
- Check the last Git commit: `git log --oneline -5`

---

## What this is
Single-file HTML/JS PWA for Aedex Anima LLC (handyman business). Business manager: clients, jobs, estimates, invoices, expenses, contractors.

**Live URL:** https://aedexbooks.aedexanima.com  
**Deploy:** `npx wrangler pages deploy . --project-name aedexbooks` (from this dir)

---

## Folder structure
```
aedexbooks-app/
├── index.html          ← entire app (HTML + CSS + JS, ~4100 lines)
├── sw.js               ← service worker, cache name: aedexbooks-v3
├── manifest.json       ← PWA manifest
├── wrangler.toml       ← Cloudflare Pages config
├── functions/
│   └── api/
│       ├── check-access.js    ← GET: KV gate (email → {status,sheetId})
│       └── register-sheet.js  ← POST: saves sheetId to KV for user
└── icons/              ← PWA icons (192, 512, apple-touch-icon)
```

---

## Stack
| Layer | Tech |
|---|---|
| Hosting | Cloudflare Pages |
| Auth gate | Cloudflare KV namespace `ACCESS_LIST` (id: `20d2c2856c0748c59c544da10f98876d`) |
| Auth | Google Identity Services (GIS) token client, OAuth popup |
| Data store | Google Sheets (one sheet per user) |
| Drive | Google Drive API (photo uploads, PDF saves, folder creation) |
| Email | Gmail API (MIME multipart with PDF attachment) |
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
   - Then calls `onSignedIn()` (async) which fetches userinfo and calls `loadFromSheet()`
5. `gapiReady` flag: if sign-in completes before Sheets API ready, `onSignedIn` returns early; GAPI callback calls `loadFromSheet()` when ready
6. `_signInPending`: if user taps sign-in before GIS loads, shows "tap again" toast (popup requires user gesture)

**Critical:** All button text updates must happen **synchronously** in the token callback. Async `onSignedIn()` takes ~1s. If buttons still say "Sign in" during that window, user taps them and triggers sign-out.

---

## Data model (Google Sheets)

Sheet ID stored in KV per user. One tab per entity.

```
const TABS = ['Clients','Properties','Jobs','Documents','Expenses',
               'ActivityLog','SentLog','Contractors','Settings','ServiceCatalog'];
```

### HEADERS (positional — parse() maps by index, not name)
**NEVER insert a field in the middle of a HEADERS array. Always append to the END.**  
Inserting mid-array shifts all subsequent columns and corrupts all existing data.

### Drive folder IDs
**Job folder IDs (e.g. `afterFolderId`) are persisted to the Jobs sheet and must always be read from `DB.jobs`.**  
Never rely on `_jobFolderCache` as the source of truth — it is in-memory only and is empty on every new session.  
`drive.file` scope restricts `files.list` queries across sessions, so `_buildJobFolders` may create a duplicate empty folder instead of finding the existing one. Always check `job.afterFolderId` from the DB first. Use `resolveAfterFolderFromPhotos()` (reads a file's parent via `files.get` by ID — works across sessions) as the fallback for legacy jobs that predate this rule.

| Tab | Key fields |
|---|---|
| Clients | id, firstName, lastName, phone, email, billingAddr, ref, notes, createdAt, updatedAt, archived, clientType, company |
| Properties | id, clientId, address, type, tenantFirstName, tenantLastName, tenantPhone, tenantEmail, notes, moveInDate, createdAt, updatedAt |
| Jobs | id, clientId, propertyId, title, status, startDate, endDate, value, materials, photoNotes, notes, estRef, createdAt, updatedAt, workDetails, contractorIds, archived, photos, afterFolderId |
| Documents | id, number, estRef, type, clientId, propertyId, date, dueDate, paymentMethod, notes, lineItems, taxRate, subtotal, taxAmt, total, paid, createdAt, updatedAt, paymentTerms, laborDisclaimer, archived, jobId |
| Expenses | id, date, amount, desc, category, jobId, createdAt, updatedAt, receiptFileId, receiptFileName, receiptWebViewLink |
| Contractors | id, name, trade, phone, email, notes, createdAt, updatedAt |
| ServiceCatalog | id, name, type, price, cat |

### Boolean fields in sheets
- `paid`, `laborDisclaimer`, `archived` are stored as **lowercase strings** `'true'`/`'false'`
- Google Sheets returns booleans as `'TRUE'`/`'FALSE'` — parser uses `String(x).toLowerCase()==='true'`
- `contractorIds` and `photos` stored as **JSON array strings** — parsed with `safeJSON()`

---

## In-memory DB

```javascript
let DB = {
  clients: [], properties: [], jobs: [], docs: [],
  expenses: [], activity: [], sentLog: [], contractors: [],
  settings: { bizName, sheetId, taxRate, catalog: [...], ... }
};
```

- `saveLocal()` — serializes DB to `localStorage` key `ab_data`; settings to `ab_settings`
- `syncToSheet()` — writes entire DB to Google Sheets (full overwrite per tab)
- `loadFromSheet()` — reads all tabs, parses into DB, calls `migrateNames()`, re-renders

---

## Key conventions

- **IDs:** `cli-`, `prp-`, `job-`, `doc-`, `exp-`, `ctr-` prefixes + timestamp
- **Soft delete:** `archived: true` — filter out in render functions; show/hide with "Show archived" checkbox
- **Job statuses:** `estimate-sent`, `in-progress`, `invoice-sent`, `awaiting-payment`, `paid`, `cancelled`
- **Doc types:** `estimate`, `invoice`
- **Activity log:** `logActivity(action, entityType, entityId, detail)` — auto-called on every save/delete
- **Error pattern:** `try { ... } catch(e) { showToast('Error: '+e.message); }`
- **Null guards:** Always `(field||'').toLowerCase()` before string ops; `||'?'` fallbacks on display

---

## Mobile UI
- Fixed 52px top header (`mob-header`) + fixed 60px bottom tab bar (`mob-tab-bar`)
- More drawer: bottom sheet (`mob-more-drawer`) with overlay — opens via `openMoreDrawer()`
- **Ghost-click guard:** `_drawerOpenedAt` timestamp — `mob-auth-btn` ignores taps within 500ms of drawer open
- CSS helpers: `.hide-mobile` (hidden ≤600px), `.show-mobile-only` (visible ≤600px)
- Mobile card views: `job-cards-m`, `doc-cards-m` — populated alongside desktop tables in render functions
- Inputs: `min-height: 42px` tap targets (excludes checkboxes/radios)

---

## Drive folder structure (jobs)
```
AEDEX ANIMA LLC/Clients/[ClientName]/[Date — JobTitle]/
  ├── Before/
  ├── After/      ← set to "anyone with link" (makeShareable)
  ├── General/
  └── Receipts/
```
`_jobFolderCache{}` caches folder IDs per jobId for the session.

---

## Service account
`id-aedexbooks-sync@aedexbooks.iam.gserviceaccount.com`  
Key file: same folder as app — `service_account.json` (not in this repo)

---

## Expense editing (added 2026-04-19)
- `openExpenseModal(id='')` — pass an expense ID to edit, omit to create new
- `_editingExpenseId` — module-level var tracks whether modal is in edit vs create mode
- `saveExpense()` — branches on `_editingExpenseId`: updates in-place vs pushes new record
- `deleteExpenseFromModal()` — deletes from inside the edit modal (separate from row-level `deleteExpense()`)
- Modal title, save button text, and delete button visibility all update dynamically

---

## Service catalog (added 2026-04-19)
- Stored in dedicated `ServiceCatalog` sheet tab — not in Settings blob
- `DB.catalog[]` — array of `{id, name, type, price, cat}`
- `seedCatalog()` — idempotent by ID; seeds 1 sample item for new users (`cat-001`)
- `catalogTabCreated` flag in settings — forces `ensureSheetTabs()` to re-run once for existing users who didn't have the tab
- Migration: on load, if `Settings.catalog` blob exists and `DB.catalog` is empty, imports the old data
- After seeding a blank catalog, `syncToSheet()` runs automatically so new users' sheets populate

---

## Google OAuth / verification (completed 2026-04-19)
- **Scopes:** `spreadsheets`, `drive.file`, `gmail.send`, `email`, `profile`
- `drive.file` (not `drive`) — only accesses files the app itself created; Drive search removed
- `findOrCreateSheet()` skips Drive search entirely — relies on KV `sheetId` from `check-access`
- Privacy policy: `https://aedexanima.com/privacy`
- Terms of service: `https://aedexanima.com/terms`
- Both links visible on the **login card** (`setup-screen`) so Google's crawler can find them
- OAuth app submitted for Google verification 2026-04-19

---

## KV access management
```bash
# Grant access
npx wrangler kv key put --namespace-id=20d2c2856c0748c59c544da10f98876d "email@example.com" '{"status":"active"}' --remote

# Revoke
npx wrangler kv key delete --namespace-id=20d2c2856c0748c59c544da10f98876d "email@example.com" --remote
```
