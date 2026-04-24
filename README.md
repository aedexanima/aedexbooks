# AEDEXBOOKS

Business management app for small contractors and handyman businesses. Manage clients, properties, jobs, estimates, invoices, expenses, and sub-contractors — all in one place, backed by Google Sheets.

Built for [Aedex Anima LLC](https://aedexanima.com) (Austin, TX).

**Live app:** https://www.aedexbooks.com

---

## Features

### Jobs & Pipeline
- Kanban board with 6 stages: Unassigned → Assigned for Estimate → Estimate Sent → In Progress → Invoice Sent → Complete
- Drag-and-drop cards between stages
- Job value synced automatically from linked estimate
- Drive folder structure created per job (Before / After / General / Receipts)

### Clients & Properties
- Client profiles with billing address, notes, client type (handyman / property manager)
- Properties linked to clients with tenant info and move-in date
- Soft delete (archive) with restore

### Estimates & Invoices
- Create estimates and invoices with line items, tax, payment terms
- Line items pulled from a reusable service catalog
- PDF generation (jsPDF + html2canvas) — email as attachment, save to Drive, or download
- Auto-creates a job when a doc is saved with no existing active job

### Contractor Portal
- Send sub-contractors a secure link to submit their estimate
- Contractor fills out labor items, materials cost, and uploads before photos
- Owner gets a Resend notification email when the contractor submits
- Review contractor estimate in the app, including before photos
- "Convert to Client Estimate" creates a real estimate doc pre-filled with the contractor's line items

### Expenses
- Log job expenses with category and receipt photo
- Receipts uploaded to Google Drive

### Email
- Send estimates and invoices directly from the app via Gmail
- PDF attached automatically
- Sent log tracks every email with recipient, subject, and message

### Service Catalog
- Reusable labor and material line items
- Quick-add to any estimate or invoice

### Settings
- Business name, address, phone, license number
- Default tax rate
- Logo (stored in Drive, shown on PDFs)

---

## Tech stack

| Layer | Tech |
|---|---|
| Hosting | Cloudflare Pages |
| Access control | Cloudflare KV |
| Auth | Google Identity Services (OAuth 2.0) |
| Data | Google Sheets (one spreadsheet per user) |
| Files | Google Drive (`drive.file` scope) |
| Email (docs) | Gmail API |
| Email (notifications) | Resend.com |
| PDF | jsPDF + html2canvas |
| Fonts | DM Sans + DM Mono |
| Server-side | Cloudflare Functions (4 endpoints) |

No build step. No npm. No framework. The entire app is one HTML file.

---

## Run locally

```bash
# Install Wrangler if you haven't
npm install -g wrangler

# Authenticate
wrangler login

# Start local dev server (serves . and runs Functions)
npx wrangler pages dev . --port 8788
```

Open http://localhost:8788.

> **Note:** Google OAuth requires a registered redirect origin. Add `http://localhost:8788` to your OAuth client's authorized JavaScript origins in Google Cloud Console.

---

## Deploy to Cloudflare Pages

```bash
npx wrangler pages deploy . --project-name aedexbooks
```

Or connect the repo to Cloudflare Pages for automatic deploys on push (set build output directory to `.`).

---

## Environment variables & secrets

### Cloudflare KV namespaces
Two KV namespaces must exist and be bound in `wrangler.toml`:

| Binding | Purpose |
|---|---|
| `ACCESS_LIST` | User allowlist + per-user Google Sheet ID |
| `PORTAL_TOKENS` | Contractor portal tokens and submission data |

Create them:
```bash
npx wrangler kv namespace create ACCESS_LIST
npx wrangler kv namespace create PORTAL_TOKENS
```

Then add the returned IDs to `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "ACCESS_LIST"
id = "your-access-list-id"

[[kv_namespaces]]
binding = "PORTAL_TOKENS"
id = "your-portal-tokens-id"
```

### Cloudflare secret
```bash
npx wrangler secret put RESEND_API_KEY
```

Used by `/api/portal/submit` to send contractor submission notifications. Get your API key from [resend.com](https://resend.com).

### Google Cloud project
1. Create a project at [console.cloud.google.com](https://console.cloud.google.com)
2. Enable: Google Sheets API, Google Drive API, Gmail API
3. Create an OAuth 2.0 client (Web application)
4. Add your app's domain to Authorized JavaScript Origins
5. Copy the Client ID into `index.html`:
   ```javascript
   const GOOGLE_CLIENT_ID = 'your-client-id.apps.googleusercontent.com';
   ```

**Scopes required:**
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/gmail.send`
- `email`
- `profile`

### Resend (notification emails)
- Verify your sending domain at [resend.com](https://resend.com)
- Update the `from` address in `functions/api/portal/submit.js` to match your verified domain

---

## Access management

Users must be allowlisted in the `ACCESS_LIST` KV namespace:

```bash
# Grant access
npx wrangler kv key put \
  --namespace-id=YOUR_ACCESS_LIST_ID \
  "user@example.com" \
  '{"status":"active"}' \
  --remote

# Revoke access
npx wrangler kv key delete \
  --namespace-id=YOUR_ACCESS_LIST_ID \
  "user@example.com" \
  --remote
```

On first sign-in, the app creates a new Google Sheet and registers the Sheet ID back to KV. Subsequent sign-ins load directly from that sheet.

---

## Project structure

```
aedexbooks-app/
├── index.html             ← entire app (~5200 lines)
├── contractor.html        ← contractor portal (no auth required)
├── sw.js                  ← service worker (cache: aedexbooks-v3)
├── manifest.json          ← PWA manifest
├── wrangler.toml          ← Cloudflare Pages + KV config
├── functions/
│   └── api/
│       ├── check-access.js
│       ├── register-sheet.js
│       └── portal/
│           ├── create.js
│           ├── get.js
│           └── submit.js
├── tests/
│   ├── bug-fixes.test.js
│   ├── job-doc-links.test.js
│   └── client-sync.test.js
└── icons/
```

Run tests:
```bash
node tests/bug-fixes.test.js
node tests/job-doc-links.test.js
node tests/client-sync.test.js
```

---

## Data storage

All business data is stored in the user's own Google Sheets spreadsheet — Levi owns the data. There is no central database. The app reads and writes directly to Google Sheets via the Sheets API using the user's OAuth token.

Cloudflare KV stores only:
- The access allowlist (email → sheet ID)
- Contractor portal sessions (30-day TTL, then auto-deleted)
