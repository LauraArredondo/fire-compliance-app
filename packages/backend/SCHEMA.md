# Fire & Security Compliance Platform — Convex Schema

Deployment: `elegant-echidna-735` (dev). Source: `convex/schema.ts`.
Standards: UK (BS 5839, BS 5266, BS EN 3/BS 5306, BS EN 12845, BS EN 50131, BS EN 62676, BAFE/NSI/SSAIB).
Multi-tenant: almost every table carries `orgId` (the compliance service company). Money is stored in minor units (pence/cents). Timestamps are ms since epoch.

## Tenancy & users
- **organizations** — service companies (tenants): accreditations (BAFE/NSI/SSAIB), disciplines offered, currency, plan.
- **users** — Convex Auth users table (name, email, phone, image, verification times) extended with `avatarId`, `defaultOrgId`, `lastSeenAt`; indexes `email`, `phone`.
- **memberships** — user ↔ org with role `owner | admin | office | engineer | client_user`; client users are scoped by `clientId`.
- **engineerQualifications** — engineer competencies per discipline, with expiry.
- **teamInvitations** — staff invites (email, role, hashed token, expiry, status); indexes `by_org`, `by_token_hash`, `by_org_email`.
- **organizations** billing fields (optional): `bankDetails` {bankName, accountName, sortCode, accountNumber, iban, bic, paymentInstructions}, `quoteTerms` (default quote T&Cs), `invoiceFooter` (default invoice payment terms text). Set with `organizations:updateBillingSettings` (owner/admin).

## Clients & properties
- **clients** — the org's customers (billing, contacts, reminder emails, accounting id).
- **sites** — properties per client (address, geo, responsible person, access notes, site QR token).
- **locations** — hierarchy within a site: building › floor › zone › room (self-referencing `parentId`).

## Asset & defect tracking
- **assetTypes** — device catalogue per discipline, with expected readings and default service frequency (`orgId` empty = global).
- **assets** — the localised device register: site/location, type, make/model/serial, status, last result, next due, QR tag code, parent asset (e.g. panel → detector).
- **checklistTemplates** — versioned inspection checklists per discipline/standard (e.g. BS 5839-1, BS 5266-1).
- **inspections** — completed checklists (system-level or per asset) with item responses and overall result.
- **readings** — time-series metrics per asset (battery V, lux, pressure, dB, duration…), indexed by asset+key+time.
- **defects** — severity (critical/major/minor/advisory), status workflow open → quoted → scheduled → in_progress → resolved → verified, linked to quote and remedial job.
- **attachments** — photos/docs/drawings linked to any entity (`entityType` + `entityId`), with client-visibility flag.

## Jobs & field capture (mobile)
- **jobs** — work orders (routine service, inspection, install, remedial, callout…), assigned engineers, status.
- **visits** — an engineer's on-site attendance: arrival/departure, GPS, engineer + customer signatures.
- Offline fields on field records: `clientGeneratedId` (device UUID for de-dupe), `capturedAt`, `syncedAt`, `deviceId`. Files use `v.id("_storage")`.

## Certificates & QR verification
- **certificateTypes** — per discipline/standard, numbering prefix, validity months, client-signature requirement.
- **numberSequences** — per-org counters for certificate/quote/job/invoice numbers.
- **certificates** — issued compliance certificates: links to job/visit and snapshots of asset/inspection/defect ids, PDF storage id + SHA-256 hash, engineer & client signatures, `verificationToken` (QR), status draft → pending_signature → issued → superseded/revoked, issue/expiry/next-due dates.
- **verificationScans** — log of public QR look-ups (`kind` certificate/asset/site, hashed IP, user agent).
- New certificate fields: `pdfStatus` (pending/ready/failed), `pdfGeneratedAt`, `pdfError`, `revision`, `revokedAt`. Assets and sites have `labelPdfId` (latest printable QR label).

## Automated reminders
- **serviceSchedules** — recurring service obligations; `reminderOffsetsDays` (empty = org default), `notifyClient`, `notifyOrg`.
- **organizations.reminderSettings** — optional per-company lead times / recipients (defaults in `convex/lib/reminderConfig.ts`).
- **reminders** — one row per reminder *stage* (e.g. `d30`, `d14`, `d7`, `d0`, `od1`, `f3`, `weekly_digest`); unique `dedupeKey` = `source:id:dueAt:stage`. Status `pending → dispatched | no_recipients | dismissed | cancelled`.
- **notifications** — one row per recipient per email: rendered subject (`title`), text (`body`), `html`, status `queued | sent | failed | skipped_no_provider | skipped_opt_out`, attempts/backoff, provider message id, unsubscribe token.
- **emailSuppressions** — per-company opt-outs (unsubscribed / bounced / complained / manual).

## Client portal
- **portalInvitations** — email invites to client users (hashed token, optional site restriction, expiry).
- **portalAccess** — read-only access grants (unlimited per client), optional site restriction, `canAcceptQuotes`.

## Quoting & finance
- **quotes** — quote with revisions, totals, status draft/sent/viewed/accepted/declined/expired/superseded, public acceptance token, acceptance record (signature, PO number, decline reason), links to defects and resulting job.
- **quoteLineItems** — labour/material/service lines, tax, optional lines the client can opt into.
- **quotes** PDF fields: `pdfStorageId`, `pdfHash` (SHA-256), `pdfStatus` (pending/ready/failed), `pdfGeneratedAt`, `pdfError`.
- **invoices** — in-app invoices (source of truth): embedded lines (with optional `discountPercent`), totals, discount, status draft/sent/partially_paid/paid/overdue/void, issued/sent/due/paid dates, payment terms, recorded payments, notes. `externalProvider`/`externalId` are optional for a future Xero/QuickBooks/Sage sync. PDF fields as for quotes, plus `pdfToken` (unguessable download token, set on send; index `by_pdf_token`).
- **accountingIntegrations** — connection status per org (secrets kept out of the DB).

## Audit
- **auditLog** — who changed what, when, from which device.

## Key relationships
organization → clients → sites → locations → assets → inspections/readings/defects
jobs → visits → inspections → certificates (→ PDF + QR token)
serviceSchedules → reminders → notifications; serviceSchedules → jobs
defects → quotes → quoteLineItems → jobs → invoices

## Starter functions
- `certificates:verify` (public) — QR verification by token; returns only non-sensitive fields.
- `certificates:listBySite`, `assets:registerForSite`, `defects:openForSite`, `serviceSchedules:dueSoon` — require a signed-in org member; client users are limited to their own client's data.
- `users:me` — current user + memberships (org name, role, client scope); `null` when signed out.
- `organizations:createWithOwner` — onboarding: signed-in user creates their company (unique slug, trial plan, GBP / Europe/London defaults) and becomes `owner`.

## Auth (Convex Auth — `@convex-dev/auth`)
- Files: `convex/auth.ts` (providers), `convex/auth.config.ts`, `convex/http.ts` (auth HTTP routes), `convex/lib/auth.ts` (helpers).
- Tables: `authTables` merged into the schema (`authAccounts`, `authSessions`, `authRefreshTokens`, `authVerificationCodes`, `authVerifiers`, `authRateLimits`) with our extended `users` table.
- Provider enabled: **Password** (email + password). Client: `signIn("password", { email, password, flow: "signUp" | "signIn", name? })`. Emails are lower-cased; passwords need ≥8 chars with a letter and a number.
- Helpers: `getCurrentUser` / `requireUser` use `getAuthUserId`; `requireMember(ctx, orgId, roles?)` checks an active membership; `canSeeClient` scopes `client_user` members to their `clientId`.
- Deployment env vars (dev): `JWT_PRIVATE_KEY`, `JWKS`, `SITE_URL` (placeholder `http://localhost:5173`).
- Roles live in `memberships`, not in `users`: one login can belong to several orgs, and client portal users are memberships with role `client_user` + `clientId` (plus a `portalAccess` row).

### Not enabled yet (needs secrets)
- **Google sign-in**: create an OAuth client in Google Cloud, redirect URI `https://elegant-echidna-735.convex.site/api/auth/callback/google`; set `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`; add `Google` from `@auth/core/providers/google` to `convex/auth.ts`.
- **Magic link / email codes and password reset**: an email sender, e.g. Resend (`AUTH_RESEND_KEY`, verified sending domain). The same sender can be reused for reminder emails and client portal invitations.
- **SITE_URL**: replace the placeholder with the real app URL (needed for OAuth redirects and email links).


## Certificate PDFs & QR verification
Files: `convex/certificatePdf.ts` (Node runtime: pdf-lib + qrcode), `convex/certificates.ts`, `convex/http.ts`, `convex/lib/{verification,verifyPage,tokens,labels}.ts`.

**Issue flow**
1. Certificate starts as `draft` (or `pending_signature`) with engineer + client signatures captured (image in storage).
2. `certificates:issue({ certificateId })` (owner/admin/office/engineer): requires the engineer signature, and the client signature if the certificate type has `requiresClientSignature`. Sets `status: "issued"`, `issuedAt`, `issuedBy`, `expiresAt` (inspection date + type `validityMonths` unless set), `nextInspectionDueAt` (defaults to expiry), and queues `certificatePdf:generate`.
3. `certificatePdf:generate` (internal action) renders the A4 PDF, stores it, and saves `pdfStorageId` + `pdfHash` (SHA-256) + `pdfStatus: "ready"`. On error: `pdfStatus: "failed"` + `pdfError`.
4. `certificates:getPdf({ certificateId })` returns the status, download URL, hash and verify URL (staff, or the client's portal users once issued).

**Reissue / revoke / regenerate**
- `certificates:reissue({ certificateId, reason? })` copies an issued certificate into a new draft `FA-000123/R1` (new QR token, signatures cleared so they're re-captured). Issuing the new draft marks the original `superseded` with `supersededById`.
- `certificates:revoke({ certificateId, reason })` (owner/admin) → QR page shows REVOKED.
- `certificates:regeneratePdf({ certificateId })` (owner/admin) re-renders, e.g. after a logo change (the SHA-256 changes).

**PDF content**: company header (logo from `organizations.logoId` if set, else text), address, company/VAT numbers, accreditations; certificate title + standard; certificate number; discipline; inspection/issue/expiry/next-due dates; job/PO reference; overall result banner with device/defect counts; vector QR code + grouped verification code; client and premises (with responsible person); summary; devices table (ref, type, description, location, pass/fail); defects table (severity colour-coded, recommended action, status); variations (`certificate.data.variations`); declaration referencing the standard; engineer (with qualification) and client signature images, names and dates; footer on every page with page x of y and the verify URL. Long tables flow onto extra pages with a continuation header.

**QR / verification URLs**
- Base = env `VERIFY_BASE_URL` if set, else `${CONVEX_SITE_URL}/verify` → currently `https://elegant-echidna-735.convex.site/verify`.
- `GET /verify/<token>` (or `/verify?token=`) – certificate page: VALID / EXPIRED / SUPERSEDED (with replacement number) / REVOKED / NOT FOUND, plus non-sensitive fields and the PDF SHA-256. Tokens are 16-char Crockford base32 (80-bit), case/dash-insensitive.
- `GET /verify/a/<tagCode>` – asset label page (device status, last/next inspection, current certificate).
- `GET /verify/s/<qrToken>` – site label page (current certificate per discipline).
- Every scan is logged in `verificationScans`. Public query `certificates:verify({ token })` returns the same data as JSON for a future frontend.

**QR labels**: `certificatePdf:generateLabel({ assetId } | { siteId })` (staff) creates a 50 × 25 mm PDF label (QR, company, asset ref/type or site name, code), creates the asset `tagCode` / site `qrToken` if missing, saves `labelPdfId`, and returns `{ url, code, verifyUrl }`.

**Once the real web app exists**, set `VERIFY_BASE_URL` (e.g. `https://app.example.co.uk/verify`) so new QR codes point at it. Already-printed QR codes keep the convex.site URL, so keep the HTTP route (or redirect it) for good.

## Reminder emails (`convex/reminders.ts`, `convex/emails.ts`, `convex/crons.ts`)

**Schedule.** `crons.ts` runs `reminders:hourlyTick` every hour on the hour; it only does work when it is 07:00 Europe/London (correct in both GMT and BST). It then runs `planForOrg` for each active company, which creates any reminders due today and runs `dispatchForOrg`.

**What is scanned** (only the *current* stage is created, so a schedule first seen 5 days before due gets a single "7-day" reminder, not 30/14/7):

| Source | When | Default leads | Goes to |
|---|---|---|---|
| Service schedules (active) | before `nextDueAt`, then overdue | 30/14/7/0 days, overdue every 7 days ×4 | company and/or client per `notifyOrg`/`notifyClient` |
| Certificates (issued, `expiresAt`) | before expiry | 30/14/7/0 | company + client; **skipped** if an active schedule for the same site + discipline is due within 31 days (avoids double reminders) |
| Defects (open/quoted/scheduled/in progress) | `targetResolutionAt`, else raised + 1 / 14 / 30 days (critical / major / minor; advisory never) | then overdue repeats | company; client too if `visibleToClient` and critical/major |
| Quotes (sent/viewed, still valid) | 3 and 10 days after `sentAt` | — | company + client (link to acceptance page) |
| Engineer qualifications | before `expiresAt` | 60/30/7/0 | company + the engineer |
| Weekly digest (opt-in) | Mondays | — | company |

**Dispatch.** Before sending, each reminder is re-checked (service already done, certificate replaced, defect resolved, quote answered, qualification renewed → `cancelled` with a reason). Company recipients = `reminderSettings.officeEmails`, else the org email + owner/admin/office users. Client recipients = `clients.reminderEmails` (else the primary contact) + active portal users who can see that site. Addresses are de-duplicated; opted-out ones are logged as `skipped_opt_out`. Each email is rendered (branded HTML + plain text, UK wording, property, system, due date, button to portal / verification page / quote) and stored in `notifications`, then sent by `emails:send`.

**Sending (Resend).** `emails:send` posts to `https://api.resend.com/emails` with `RESEND_API_KEY`, `EMAIL_FROM`, reply-to = the company email, `List-Unsubscribe` + one-click headers, and an idempotency key per notification. **Without `RESEND_API_KEY`/`EMAIL_FROM` it is a dry run**: nothing leaves the system and the notification is saved as `skipped_no_provider` with the full rendered email. 429/5xx/network errors retry after 1 min, 5 min, 30 min, 2 h (max 5 attempts), then `failed`; other 4xx fail immediately.

**Unsubscribe.** Every email links to `https://<deployment>.convex.site/unsubscribe/<token>`: GET shows a confirmation page, POST (button or RFC 8058 one-click) adds an `emailSuppressions` row for that company.

**Staff functions.**
- `reminders:list({orgId, status?})` — upcoming (`pending`, default) or `dispatched` / `dismissed` / `cancelled` / `no_recipients`.
- `reminders:listNotifications({orgId})` (log without bodies), `reminders:getNotification({notificationId})` (with HTML/text for preview).
- `reminders:snooze({reminderId, days})` — resend at 07:00 UK time N days from now; `reminders:dismiss({reminderId, reason?})`.
- `reminders:sendTest({orgId, to?})` — test email (to yourself by default); `reminders:runNow({orgId})` (owner/admin) — run today's reminders immediately.
- `reminders:providerStatus({orgId})` — whether real sending is configured.
- `organizations:getReminderSettings` / `organizations:updateReminderSettings` (owner/admin): `enabled`, `serviceLeadDays`, `certificateLeadDays`, `qualificationLeadDays`, `quoteFollowUpDays`, `defectFollowUpDays`, `overdueRepeatDays`, `overdueMaxReminders`, `officeEmails`, `weeklyDigest`.

**Environment variables.**
| Variable | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend API key; unset = dry run |
| `EMAIL_FROM` | e.g. `Northern Fire Reminders <reminders@yourdomain.co.uk>`; a bare address gets the company name as display name |
| `SITE_URL` | web app base URL used for portal/app/quote links (currently `http://localhost:5173`) |
| `RESEND_API_URL` | optional override, for testing only |

## Quote & invoice PDFs (`convex/commercialPdf.ts`, `convex/commercialDocs.ts`, `convex/lib/pdfKit.ts`)

A4 PDFs (pdf-lib) share the certificate branding: company logo/name/address, accreditations, company and VAT numbers, UK dates, GBP, and a footer with "Page x of y".
- **Quote:** number, revision, dates, valid until, client and site, scope, linked defects, line items (type, qty, unit price, discount, VAT rate) with optional items in their own table (OPTIONAL, or SELECTED / NOT SELECTED once answered), totals with VAT per rate, a QR code and link to the accept page, and terms (quote terms, else `organizations.quoteTerms`, else a default). Once accepted, the PDF is regenerated with an acceptance record: name, role, date/time, PO number, content fingerprint and signature image. Watermarks: DRAFT / SUPERSEDED / EXPIRED / DECLINED.
- **Invoice:** "TAX INVOICE" when the company has a VAT number. Shows date/tax point, due date, terms, job/quote/PO refs, a balance-due panel, bill-to and site, lines (with a discount column when used), VAT per rate, total, payments received and balance due, bank details with the invoice number as payment reference, and terms (`invoiceFooter`, else a default citing the Late Payment Act). Status pills: PAID / VOID / PART PAID / OVERDUE. Watermarks: PAID (green), VOID (red), DRAFT.
- **When generated:** on `quotes:send`, `quotes:respond` (accepted/declined copy), `invoices:send`, `invoices:recordPayment` and `invoices:voidInvoice`. Staff can also call `quotes:regeneratePdf` / `invoices:regeneratePdf` (office+; draft previews allowed). Each render replaces the stored file, saves its SHA-256 in `pdfHash` and writes a `quote.pdf_generated` / `invoice.pdf_generated` audit entry with the hash.
- **Access:** `quotes:getPdf` / `invoices:getPdf` return status, hash, a signed storage URL and the public link. Client portal users never see drafts, superseded quotes, hidden invoices or sites outside their scope. Engineers can't see invoices.
- **Public links (HTTP):** `https://<deployment>.convex.site/pdf/q/<acceptanceToken>` and `/pdf/i/<pdfToken>` always serve the latest render. These links are included in quote/invoice emails. Behaviour: 404 for unknown tokens or drafts, 503 + Retry-After while rendering; otherwise inline, `no-store`, `noindex`, with an `X-Content-SHA256` header.

## Auto-created routine jobs (`convex/lib/autoJobs.ts`)
- Runs daily inside `reminders:planForOrg` (07:00 UK tick), **before** the reminders-enabled check, so it works even when reminder emails are off. Manual trigger: `serviceSchedules:runAutoJobsNow` (office).
- Settings: `organizations.jobAutomation { enabled (default true), leadDays (default 30, 0-365), notifyOffice (default true) }`, via `organizations:getJobAutomationSettings` / `updateJobAutomationSettings` (owner/admin/office, audited `org.job_automation_updated`).
- Per schedule: `serviceSchedules.autoCreateJob` (now **defaults to true** on create), `autoJobLeadDays` (override), `defaultEngineerId` (must be an active staff member; `null` clears on update).
- Rule: an active schedule with `autoCreateJob` and `nextDueAt <= now + lead` gets one job: `type routine_service`, `status "draft"` (= unscheduled), linked schedule/site/client/discipline, priority `high` if already overdue, `jobs.autoCreated = true`, `jobs.scheduleDueAt = nextDueAt` (the cycle key).
- Dedupe: skipped if any job for the schedule has the same `scheduleDueAt` (any status, so a cancelled one is not recreated), or an open manual job is linked to the schedule. Paused/ended schedules and archived sites are skipped.
- Cycle: completing the job or issuing the certificate advances the schedule (existing `advanceSchedule`); older-cycle **draft** auto jobs are cancelled (`job.auto_cancelled`). Editing `nextDueAt` re-points the open auto job. Ending a schedule cancels its draft auto jobs; pausing keeps them.
- Audit: `job.created` + `job.auto_created` with system actor (no `actorUserId`), incl. qualification warnings. `jobs.createdBy` = org owner (required field).
- Office summary: reminder `sourceType "jobs_auto_created"` (`jobIds`, audience org), emailed via the normal dispatch (dry run until Resend is configured).

## Engineer qualification checks (`convex/lib/qualifications.ts`)
- Valid = `engineerQualifications` row for the same org, user and discipline with `issuedAt <= now` (if set) and `expiresAt` unset or in the future. (There is no "verified" field and certificate types do not name a required qualification, so discipline is the requirement.)
- `certificates:sign` (as engineer) and `certificates:issue` block an unqualified signer with a clear message; `issue` also checks an engineer issuing someone else's certificate, and re-checks the signer (catches expiry between sign and issue).
- Override: optional `qualificationOverrideReason` (>= 5 chars), **owner/admin only**. A sign-stage override carries over to issue for the same signature. Audited `certificate.qualification_override`.
- `certificates.qualificationChecks[]`: `{stage, engineerUserId, engineerName, discipline, qualified, qualificationIds, detail, signatureSignedAt?, override?{byUserId, byName, reason, at}, at}`; staff see it on `certificates:get` (+ `qualificationOverridden`), client users don't. Cleared on reissue.
- `certificates:qualificationCheck` previews the result; `jobs:assignEngineers` now returns `{ warnings }`; `jobs:get` returns `qualificationWarnings`; `jobs:checkAssignment` previews (warnings never block assignment).

## Overdue invoices (`convex/lib/overdueInvoices.ts`)
- Stored status stays `sent` / `partially_paid`; reads still derive `overdue` (unchanged). Daily (in `planForOrg`, also when reminders are off) sets `invoices.overdueSince`, audits `invoice.overdue` (system actor) and regenerates the PDF. Cleared on full payment, void, re-send with a future due date, or by the daily safety pass (`invoice.overdue_cleared`).
- Reminders (when reminders enabled): `reminderSettings.invoiceOverdueDays` (default `[1, 7, 14, 30]`, 1-365) and `invoiceRemindClient` (default true). One reminder per stage, `sourceType "invoice_overdue"`, `invoiceId`, stage `od<days>`, dedupe `inv:<id>:<dueAt>:od<days>`; audience `both` (client + office) or `org`. Client email: amount due, due date, bank details, portal link + PDF link; office email: chase summary. Cancelled at dispatch if the invoice is paid/void, settled or its due date changed.

## Lists: names + "all" statuses
- `certificates`, `quotes`, `invoices`, `defects`, `jobs`, `serviceSchedules` list rows include `clientName` and `siteName` (`""` if none); `sites:list` rows include `clientName`. Looked up once per distinct client/site per page.
- `status: "all"` on `certificates:list`, `quotes:list`, `invoices:list`, `defects:list` returns every status newest first (new `by_org` index on those four tables; defects by site / portal use the existing index prefix). Omitting `status` keeps the old defaults (issued / draft / draft / open). Portal users still never see drafts / hidden items; certificate rows for portal users omit `qualificationChecks`.
- App links (`SITE_URL`): `/quotes/<token>`, `/invite/team/<token>`, `/invite/portal/<token>`, `/portal/invoices/<id>`, `/portal/defects/<id>`, `/portal/sites/<id>`, `/portal/quotes/<id>`, `/app/<section>/<id>`. QR codes stay on `<CONVEX_SITE_URL>/verify` (VERIFY_BASE_URL unset).
