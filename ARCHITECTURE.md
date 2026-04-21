# AEDEXBOOKS — Architecture

## Overview

Single-file HTML/JS PWA. No build step, no framework, no npm. The entire application lives in `index.html` (~5200 lines). Data lives in Google Sheets. Files live in Google Drive. The only server-side code is four Cloudflare Functions for the access gate and contractor portal.

---

## Data stores

### Google Sheets (primary data store)
One spreadsheet per user. Sheet ID stored in Cloudflare KV, returned on login. Ten tabs:

| Tab | Purpose |
|---|---|
| Clients | People/businesses who hire Levi |
| Properties | Job sites linked to clients |
| Jobs | Work orders, linking clients + properties |
| Documents | Estimates and invoices linked to jobs |
| Expenses | Job costs with optional receipt images |
| ActivityLog | Audit trail (every create/update/delete) |
| SentLog | Record of every email sent |
| Contractors | Sub-contractors assigned to jobs |
| Settings | Key-value pairs for business config |
| ServiceCatalog | Reusable line items for docs |

**Parse is positional.** `loadFromSheet()` uses `HEADERS` arrays as column index maps. Columns must never be inserted mid-array — always append to the end.

### localStorage (offline cache)
- `ab_data` — full DB serialized as JSON
- `ab_settings` — settings blob
- Loaded immediately on page open so app is usable before Google auth completes

### Cloudflare KV — `ACCESS_LIST`
- Namespace ID: `20d2c2856c0748c59c544da10f98876d`
- Key: user's lowercase email address
- Value: `{ status: "active", sheetId: "..." }`
- Purpose: allowlist gate + per-user sheet ID lookup

### Cloudflare KV — `PORTAL_TOKENS`
- Namespace ID: `23df3f4378e54346a70cc3b719480722`
- Key patterns: `portal:TOKEN` and `submission:TOKEN`
- Both have 30-day TTL
- Purpose: contractor portal session storage (see Portal section below)

---

## Sheet schema

All fields are strings in the sheet. JSON objects/arrays are JSON-stringified. Booleans are `'true'`/`'false'`.

### Clients
| Field | Type | Notes |
|---|---|---|
| id | string | `cli-{timestamp}` |
| firstName | string | |
| lastName | string | |
| phone | string | |
| email | string | |
| billingAddr | string | |
| ref | string | How they found Levi |
| notes | string | |
| createdAt | ISO datetime | |
| updatedAt | ISO datetime | |
| archived | 'true'/'false' | Soft delete |
| clientType | string | `'handyman'` (default) or `'property-manager'` |
| company | string | |
| altEmail | string | Secondary email for billing |

### Properties
| Field | Type | Notes |
|---|---|---|
| id | string | `prp-{timestamp}` |
| clientId | string | FK → Clients |
| address | string | Full street address |
| type | string | e.g. `'residential'`, `'commercial'` |
| tenantFirstName | string | If rented |
| tenantLastName | string | |
| tenantPhone | string | |
| tenantEmail | string | |
| notes | string | |
| moveInDate | date string | |
| createdAt | ISO datetime | |
| updatedAt | ISO datetime | |

### Jobs
| Field | Type | Notes |
|---|---|---|
| id | string | `job-{timestamp}` |
| clientId | string | FK → Clients |
| propertyId | string | FK → Properties |
| title | string | |
| status | string | See status pipeline below |
| startDate | date string | |
| endDate | date string | |
| value | number | Job dollar value (synced from estimate total) |
| materials | number | Estimated materials cost |
| photoNotes | string | Notes about photos |
| notes | string | Internal notes |
| estRef | string | Reference estimate number |
| createdAt | ISO datetime | |
| updatedAt | ISO datetime | |
| workDetails | string | Detailed scope of work |
| contractorIds | JSON array | `["ctr-..."]` — assigned contractors |
| archived | 'true'/'false' | |
| photos | JSON array | `[{fileId, webViewLink, name}]` — Drive file references |
| afterFolderId | string | Drive folder ID for After photos — **persisted, source of truth** |
| portalToken | string | UUID — current active portal link token |
| contractorEstimate | JSON | `{laborItems, laborSubtotal, materialsTotal, materialsNotes, grandTotal, submittedAt, photoFileIds[], receiptFileId}` |
| clientEstimate | JSON | `{docId, createdAt}` — points to a real Document record |
| contractorInstructions | string | Shown on contractor portal page |
| jobNumber | string | 5-digit padded string — unified with doc.number |

### Documents
| Field | Type | Notes |
|---|---|---|
| id | string | `doc-{timestamp}` |
| number | string | 5-digit string — unified counter with job.jobNumber |
| estRef | string | Cross-reference to linked estimate (for invoices) |
| type | string | `'estimate'` or `'invoice'` |
| clientId | string | FK → Clients |
| propertyId | string | FK → Properties |
| date | date string | |
| dueDate | date string | |
| paymentMethod | string | |
| notes | string | |
| lineItems | JSON | `[{id, desc, type, price, qty}]` |
| taxRate | number | Percentage (e.g. `8.25`) |
| subtotal | number | |
| taxAmt | number | |
| total | number | |
| paid | 'true'/'false' | |
| createdAt | ISO datetime | |
| updatedAt | ISO datetime | |
| paymentTerms | string | |
| laborDisclaimer | 'true'/'false' | |
| archived | 'true'/'false' | |
| jobId | string | FK → Jobs |

### Expenses
| Field | Type | Notes |
|---|---|---|
| id | string | `exp-{timestamp}` |
| date | date string | |
| amount | number | |
| desc | string | |
| category | string | |
| jobId | string | FK → Jobs (optional) |
| createdAt | ISO datetime | |
| updatedAt | ISO datetime | |
| receiptFileId | string | Drive file ID |
| receiptFileName | string | |
| receiptWebViewLink | string | Drive view URL |

### Contractors
| Field | Type | Notes |
|---|---|---|
| id | string | `ctr-{timestamp}` |
| name | string | |
| trade | string | |
| phone | string | |
| email | string | |
| notes | string | |
| createdAt | ISO datetime | |
| updatedAt | ISO datetime | |

### ServiceCatalog
| Field | Type | Notes |
|---|---|---|
| id | string | `cat-{timestamp}` |
| name | string | |
| type | string | `'labor'` or `'material'` |
| price | number | |
| cat | string | Category label |

### Settings (key-value rows)
| Key | Notes |
|---|---|
| bizName | Business display name |
| yourName | Owner name |
| phone | Business phone |
| email | Reply-to email for sent docs |
| addr | Business address |
| license | Contractor license number |
| taxRate | Default tax rate (%) |
| logoFileId | Drive file ID for logo image |

---

## Record relationships

```
Clients ─┬─< Properties
         └─< Jobs ─┬─< Documents
                   ├─< Expenses
                   └── contractorEstimate ──> clientEstimate ──> Documents
                          ↑
                   Contractors (many-to-many via contractorIds[])
```

- A **Property** belongs to one Client
- A **Job** belongs to one Client + one Property
- A **Document** (estimate or invoice) belongs to one Client + one Property + one Job
- When a **Job's client changes**, all linked docs cascade silently
- When a **Doc's client changes**, user is prompted whether to update the linked Job
- `saveDoc` auto-creates a Job if none exists for that client+property combination
- When an **estimate doc** is saved, `job.value` is updated to match `doc.total`
- When an **invoice** is saved on an `estimate-sent` job, job status advances to `in-progress`

---

## Job status pipeline

```
unassigned
    ↓ (contractor assigned in saveJob)
assigned-for-estimate
    ↓ (estimate sent via sendInvoiceEmail)
estimate-sent
    ↓ (invoice created via saveDoc)
in-progress
    ↓ (invoice sent via sendInvoiceEmail)
invoice-sent
    ↓ (manually moved)
complete
```

---

## Contractor portal flow

```
aedexbooks (Levi)          Cloudflare KV            Contractor
──────────────────         ─────────────            ──────────
sendPortalLink()
  POST /api/portal/create ──→ portal:TOKEN = {
                               jobId, jobTitle,
                               contractorName,
                               ownerEmail, bizName,
                               status: 'pending'
                             }
  Sends link via Gmail ──────────────────────────→ /contractor.html?token=UUID
                                                    GET /api/portal/get?token=UUID
                                                    ←── job snapshot

                                                    [fills out estimate]
                                                    POST /api/portal/submit
                             submission:TOKEN = { ←─
                               laborItems,
                               materialsTotal,
                               grandTotal,
                               beforePhotos (base64)
                             }
                             portal:TOKEN.status = 'submitted'
  Resend notification ←─────────────────────────────────────────

checkPortalSubmission()
  GET /api/portal/get?token=UUID&include=submission
  ←── { ...entry, submission: {...} }
  stores in job.contractorEstimate

[optional] viewContractorEstimate()
  shows base64 thumbnails from KV
  "Save Photos to Drive" → fetches KV photos, uploads via Drive API
  → stores Drive fileIds in job.contractorEstimate.photoFileIds

[optional] convertToClientEstimate()
  creates real estimate doc in DB.docs
  sets job.clientEstimate = {docId, createdAt}
  navigates to Documents tab + opens doc modal
```

---

## Google Drive structure

```
AEDEX ANIMA LLC/
  Clients/
    [Client Full Name]/
      [YYYY-MM-DD — Job Title]/
        Before/          ← contractor before photos
        After/           ← after photos; shared "anyone with link"
        General/         ← misc job photos
        Receipts/        ← expense receipts
```

- `afterFolderId` stored on the Job record in Sheets (persists across sessions)
- `_jobFolderCache{}` is in-memory only — empty on every new session
- `drive.file` scope: app can only access files it created — no cross-session Drive search
- `uploadFileToDrive(file, folderId)` — multipart upload; includes `mimeType` in metadata
- `getDriveImageUrl(fileId)` — fetches binary, creates blob URL, caches in `_blobCache{}`

---

## Cloudflare Functions

All functions are in `functions/api/`. Cloudflare Pages auto-routes them.

### `GET /api/check-access?email=...`
- Looks up email in `ACCESS_LIST` KV
- Returns `{ allowed: true|false, sheetId: "..." }`
- Supports old string format (`"active"`) and new JSON format

### `POST /api/register-sheet`
- Body: `{ email, sheetId }`
- Saves `sheetId` into user's `ACCESS_LIST` KV entry

### `POST /api/portal/create`
- Body: `{ token, jobId, contractorId, contractorName, contractorEmail, jobTitle, jobAddress, jobInstructions, beforeFolderId, receiptsFolderId, bizName, ownerEmail, logoBase64 }`
- Stores entry in `PORTAL_TOKENS` with 30-day TTL

### `GET /api/portal/get?token=...&include=submission`
- Returns portal entry for valid, non-expired token
- With `include=submission`: also returns `submission:TOKEN` data if status is `submitted`

### `POST /api/portal/submit`
- Body: `{ token, laborItems, laborSubtotal, materialsTotal, materialsNotes, grandTotal, beforePhotos, receiptData }`
- Stores `submission:TOKEN` with base64 photos (30-day TTL)
- Marks `portal:TOKEN` status as `submitted`
- Fires non-blocking Resend notification to `entry.ownerEmail`

---

## Email architecture

| Use case | Transport | From | Auth |
|---|---|---|---|
| Send estimate/invoice to client | Gmail API | User's Gmail account | User's OAuth token |
| Send contractor portal link | Gmail API | User's Gmail account | User's OAuth token |
| Contractor submission notification | Resend.com | `notifications@aedexanima.com` | `RESEND_API_KEY` secret |
| Client portal login link (website) | Resend.com | `notifications@aedexanima.com` | Separate codebase |

Gmail sends use MIME multipart with PDF attachment (generated client-side via jsPDF + html2canvas).

---

## PDF generation
1. `generatePDF(docId)` — renders doc HTML into a hidden div
2. `html2canvas` captures it as a canvas
3. `jsPDF` creates a PDF from the canvas image
4. Used for: email attachment, "Save to Drive", "Download"

---

## Service worker
- Cache name: `aedexbooks-v3` — bump to bust cache on next deploy
- Strategy: network-first for HTML (always gets latest), cache-first for other assets
- Google API calls bypass cache entirely
- Falls back to cached `index.html` when offline

---

## Number generation
`nextNumber()` — unified 5-digit counter:
1. Scans all `doc.number` and `job.jobNumber` values
2. Takes the max numeric value
3. Adds a random bump of 3 or 4 (avoids consecutive-looking numbers)
4. Pads to 5 digits: `'03001'`, `'03005'`, etc.
5. Falls back to `'03001'` if no numbers exist

---

## Key functions reference

| Function | Location | Purpose |
|---|---|---|
| `nextNumber()` | ~line 1124 | Unified 5-digit counter for docs + jobs |
| `migrateNames()` | ~line 1133 | One-time data migrations, guarded by settings flags |
| `HEADERS` | ~line 1594 | Column index maps for all sheet tabs |
| `syncToSheet()` | ~line 1665 | Write entire DB to Sheets |
| `loadFromSheet()` | ~line 1699 | Read Sheets into DB, run migrations, re-render |
| `STAGES` | ~line 2178 | Job status pipeline definition |
| `renderPipeline()` | ~line 2182 | Kanban board render |
| `saveJob()` | ~line 2695 | Save job + cascade client to linked docs |
| `renderPortalSection()` | ~line 2762 | Portal/estimate section inside job modal |
| `sendPortalLink()` | ~line 2836 | Generate token, POST to /api/portal/create, send Gmail |
| `checkPortalSubmission()` | ~line 2939 | Fetch submission from KV, store on job |
| `viewContractorEstimate()` | ~line 3154 | Modal: show base64 thumbnails, Drive upload |
| `convertToClientEstimate()` | ~line 3154 | Create real estimate doc from contractor submission |
| `saveDoc()` | ~line 3553 | Save doc + auto-create/advance job + client sync prompt |
| `docPropertyLabel(d)` | after getProperty | Display helper: address → job title → 'No property' |
| `getDriveImageUrl(fileId)` | — | Fetch Drive binary → blob URL (cached) |
| `uploadFileToDrive(file, folderId)` | — | Multipart Drive upload with mimeType |
