# Google Document AI + GPT-5.4 — AP/Reimbursement OCR setup

This wires **Google Document AI** (high-precision invoice/receipt OCR) → **GPT-5.4** (reasoning)
into the AP pipeline. It's **opt-in per company** (`portal_ap_settings.ocr_provider = 'docai'`),
so nothing changes until you turn it on for a company. Setup ≈ 20 minutes, one time.

> 🔒 The service-account key is a secret. Only paste it into **Supabase Edge Secrets** — never
> into any chat box.

---

## Part A — Google Cloud (get the credentials)

### 1. Project + billing
- Go to https://console.cloud.google.com → create (or pick) a project, e.g. `ctg-finance-docai`.
- Enable **Billing** on it (Document AI is paid: ~$0.10 per document; needs billing on).

### 2. Enable the API
- Search bar → "Document AI API" → **Enable**.
  (Direct: https://console.cloud.google.com/apis/library/documentai.googleapis.com)

### 3. Create the two processors
- Go to **Document AI → Processors** (https://console.cloud.google.com/ai/document-ai/processors).
- **Create processor** → choose **Invoice Parser** → Region: **US (us)** (or EU) → Create.
  - Open it → copy the **Processor ID** (a long hex string) and note the **Region**.
- **Create processor** again → choose **Expense Parser** (for receipts / reimbursements) → same region → copy its **Processor ID**.

> Keep both region choices the SAME (both `us` or both `eu`).

### 4. Service account + key
- **IAM & Admin → Service Accounts** → **Create service account**, e.g. `docai-portal`.
- Grant it the role **Document AI API User** (`roles/documentai.apiUser`) → Done.
- Open the service account → **Keys** tab → **Add key → Create new key → JSON** → a `.json` file downloads.
- Open that JSON in a text editor. You'll paste its **entire contents** into Supabase next.

---

## Part B — Supabase Edge Secrets

Open https://supabase.com/dashboard/project/cmostxcjtbuhbzfojuid/settings/functions → **Secrets** →
add these **5** (Add new secret each time). Names must match **exactly** (case-sensitive):

| Name | Value |
|---|---|
| `GOOGLE_DOCAI_SA` | *(paste the ENTIRE contents of the downloaded JSON key file)* |
| `GOOGLE_DOCAI_PROJECT` | your project ID (e.g. `ctg-finance-docai`) |
| `GOOGLE_DOCAI_LOCATION` | `us` (or `eu` — must match your processors' region) |
| `GOOGLE_DOCAI_INVOICE_PROCESSOR` | the Invoice Parser processor ID |
| `GOOGLE_DOCAI_EXPENSE_PROCESSOR` | the Expense Parser processor ID |

Also make sure `OPENAI_API_KEY` is set (for GPT-5.4) — you already have this.

---

## Part C — Shadow test (I do this)

When A + B are done, tell me. I will:
1. Flip **one** company (e.g. SKINDAE) to `ocr_provider='docai'` **with auto-post OFF** (shadow mode — writes to the portal, does NOT touch Xero).
2. You forward (or point me to) a few real supplier invoices + one reimbursement.
3. I show you a side-by-side: **what Doc AI extracted (with confidence) vs the actual document** — totals, line items, tax, vendor.
4. If it's clearly better, we roll it out to the other companies. If not, we flip back (one setting) and you've spent only a few cents.

---

## How it behaves once on
- **Invoices** → Doc AI reads the fields precisely → GPT-5.4 reasons text-only (cheaper).
- **Reimbursements** → Doc AI reads the invoice fields **+** GPT-5.4 also sees the images (to verify signatures / stamps / payment proof).
- **If Doc AI ever fails** (API down, misconfig) → it automatically falls back to the normal vision model, so no email is ever lost.
- Everything after extraction — duplicate check, amount reconciliation, GL coding, Xero bill (SUBMITTED), audit log, auto-reply — is **unchanged**.

## To turn a company off again
One line: set its `portal_ap_settings.ocr_provider` back to `'vision-llm'`. Instant, reversible.
