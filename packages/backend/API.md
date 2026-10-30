# API reference — dev deployment elegant-echidna-735

Generated from `npx convex function-spec` + source. Roles: owner, admin, office, engineer, client_user.
`Discipline` = fire_alarm | emergency_lighting | fire_extinguishers | sprinklers | fire_doors | dry_wet_risers | smoke_ventilation | gas_suppression | fire_risk_assessment | intruder_alarm | cctv | access_control | nurse_call | other.
All org-scoped functions take `orgId` and check membership via `requireMember`; client_user is read-only and limited to their client/granted sites. Errors are `ConvexError` with a user-facing message.

## Role scoping (server-enforced)

- **owner / admin / office**: everything in their org.
- **engineer**: only jobs they are assigned to (`jobs.assignedEngineerIds`, mirrored in `jobAssignments`) and the sites of those jobs (any job status).
  - `jobs:list` returns assigned jobs only; `jobs:get`, `visits:*`, `inspections:listForVisit`, job/visit attachments need the assignment -> `You're not assigned to this job`.
  - Site-scoped records (sites, assets, locations, defects, certificates, readings, site attachments) need an assigned job at that site -> `You're not assigned to a job at this site`; site lookups via `sites:get`, `assets:list`, `locations:listBySite`, `defects:openForSite`, `certificates:listBySite`, `assets:registerForSite`, `inspections:listForAsset`/`readingsForAsset` answer `Site not found`.
  - `sites:list` and `clients:list` return one full page (`isDone: true`) of assigned sites / their clients; `clients:*` give engineers `{_id, name}` only (`clients:get` on another client -> `You're not assigned to a job for this client`).
  - `certificates:list` and `defects:list` (org-wide) are filtered to assigned sites, so pages can be shorter than `numItems`; with `siteId` they refuse unassigned sites.
  - Refused with `Insufficient permissions`: `quotes:list/get/getPdf`, `invoices:*`, `serviceSchedules:list/get/dueSoon`, `reminders:*`, `certificates:reissue`, attachments on quotes.
  - `organizations:get` omits `bankDetails`, `quoteTerms`, `invoiceFooter`, `defaultTaxRate`, `jobAutomation`.
- **client_user** (portal): unchanged, plus `clients:get` now omits `notes`, `accountNumber`, `externalAccountingId`; `certificates:getPdf`/`listBySite` respect their granted sites.

## Counts by area

| Area | Queries | Mutations | Actions | Total |
|---|---|---|---|---|
| assetTypes | 1 | 3 | 0 | 4 |
| assets | 3 | 6 | 0 | 9 |
| attachments | 1 | 4 | 0 | 5 |
| auth | 1 | 0 | 2 | 3 |
| certificatePdf | 0 | 0 | 1 | 1 |
| certificateTypes | 1 | 2 | 0 | 3 |
| certificates | 6 | 8 | 0 | 14 |
| checklistTemplates | 2 | 2 | 0 | 4 |
| clients | 2 | 3 | 0 | 5 |
| defects | 3 | 5 | 0 | 8 |
| inspections | 3 | 3 | 0 | 6 |
| invoices | 3 | 8 | 0 | 11 |
| jobs | 4 | 4 | 0 | 8 |
| locations | 1 | 3 | 0 | 4 |
| organizations | 3 | 8 | 0 | 11 |
| portal | 2 | 5 | 0 | 7 |
| qualifications | 1 | 3 | 0 | 4 |
| quotes | 4 | 13 | 0 | 17 |
| reminders | 4 | 4 | 0 | 8 |
| serviceSchedules | 3 | 4 | 0 | 7 |
| sites | 2 | 3 | 0 | 5 |
| team | 3 | 5 | 0 | 8 |
| users | 1 | 0 | 0 | 1 |
| visits | 1 | 4 | 0 | 5 |
| **total** | 55 | 100 | 3 | 158 |

## assetTypes

### `assetTypes:create` (mutation)
- **Args:** `{ checklistTemplateId?: Id<checklistTemplates>, defaultServiceFrequency?: { interval: number, unit: "day" | "week" | "month" | "year" }, discipline: Discipline, expectedLifeYears?: number, name: string, orgId: Id<organizations>, readingDefinitions?: { key: string, label: string, max?: number, min?: number, unit?: string, valueType: "number" | "boolean" | "text" }[] }`
- **Who:** office (owner/admin/office)

### `assetTypes:list` (query)
Asset types available to the org: its own plus built-in (global) ones.
- **Args:** `{ discipline?: Discipline, orgId: Id<organizations> }`
- **Who:** staff (owner/admin/office/engineer)

### `assetTypes:remove` (mutation)
Delete an unused asset type (no assets of this type in the org).
- **Args:** `{ assetTypeId: Id<assetTypes> }`
- **Who:** office (owner/admin/office)

### `assetTypes:update` (mutation)
- **Args:** `{ assetTypeId: Id<assetTypes>, checklistTemplateId?: Id<checklistTemplates>, defaultServiceFrequency?: { interval: number, unit: "day" | "week" | "month" | "year" }, expectedLifeYears?: number, name?: string, readingDefinitions?: { key: string, label: string, max?: number, min?: number, unit?: string, valueType: "number" | "boolean" | "text" }[] }`
- **Who:** office (owner/admin/office)

## assets

### `assets:bulkImport` (mutation)
Bulk import a device list (e.g. from a spreadsheet) into a site. Up to 500 rows per call. Rows whose reference already exists at the site are skipped (or updated if `updateExisting`). `locationName` creates/uses a top-level "area" location with that name.

- **Args:** `{ rows: { assetTypeId: Id<assetTypes>, clientGeneratedId?: string, customFields?: Record<string, string | number | boolean>, description?: string, installedAt?: number, locationId?: Id<locations>, locationName?: string, manufacturedAt?: number, manufacturer?: string, model?: string, parentAssetId?: Id<assets>, photoIds?: Id<_storage>[], reference: string, replaceBy?: number, serialNumber?: string, warrantyExpiresAt?: number }[], siteId: Id<sites>, updateExisting?: boolean }`
- **Who:** staff (owner/admin/office/engineer)

### `assets:create` (mutation)
Add one asset (staff). Idempotent on clientGeneratedId for offline capture.
- **Args:** `{ assetTypeId: Id<assetTypes>, capturedAt?: number, clientGeneratedId?: string, customFields?: Record<string, string | number | boolean>, description?: string, deviceId?: string, installedAt?: number, locationId?: Id<locations>, manufacturedAt?: number, manufacturer?: string, model?: string, parentAssetId?: Id<assets>, photoIds?: Id<_storage>[], reference: string, replaceBy?: number, serialNumber?: string, siteId: Id<sites>, warrantyExpiresAt?: number }`
- **Who:** staff (owner/admin/office/engineer)

### `assets:decommission` (mutation)
Decommission: mark removed, or replaced (optionally linking the replacement asset).
- **Args:** `{ assetId: Id<assets>, reason: string, replacementAssetId?: Id<assets>, status: "removed" | "replaced" }`
- **Who:** staff (owner/admin/office/engineer)

### `assets:get` (query)
- **Args:** `{ assetId: Id<assets> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `assets:list` (query)
Paginated assets at a site (any member who can see the site).
- **Args:** `{ discipline?: Discipline, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, siteId: Id<sites> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `assets:move` (mutation)
Move an asset to another location at the same site, or to another site of the same client.
- **Args:** `{ assetId: Id<assets>, locationId?: Id<locations> | null, siteId?: Id<sites> }`
- **Who:** staff (owner/admin/office/engineer)

### `assets:registerForSite` (query)
Device register for a site, optionally by discipline (kept for the register screen).
- **Args:** `{ discipline?: Discipline, orgId: Id<organizations>, siteId: Id<sites> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `assets:setStatus` (mutation)
Set the operational status (in service / defective / out of service).
- **Args:** `{ assetId: Id<assets>, status: "in_service" | "defective" | "out_of_service" }`
- **Who:** staff (owner/admin/office/engineer)

### `assets:update` (mutation)
- **Args:** `{ assetId: Id<assets>, assetTypeId?: Id<assetTypes>, customFields?: Record<string, string | number | boolean>, description?: string, installedAt?: number, locationId?: Id<locations>, manufacturedAt?: number, manufacturer?: string, model?: string, parentAssetId?: Id<assets>, photoIds?: Id<_storage>[], reference?: string, replaceBy?: number, serialNumber?: string, warrantyExpiresAt?: number }`
- **Who:** staff (owner/admin/office/engineer)

## attachments

### `attachments:attach` (mutation)
Attach an uploaded file to any record (staff). Idempotent on clientGeneratedId.
- **Args:** `{ caption?: string, capturedAt?: number, clientGeneratedId?: string, deviceId?: string, entityId: string, entityType: "site" | "asset" | "job" | "visit" | "inspection" | "defect" | "certificate" | "quote", fileName: string, geo?: { lat: number, lng: number }, kind?: "photo" | "document" | "drawing" | "signature" | "other", orgId: Id<organizations>, storageId: Id<_storage>, visibleToClient?: boolean }`
- **Who:** staff (owner/admin/office/engineer)

### `attachments:generateUploadUrl` (mutation)
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** staff (owner/admin/office/engineer)

### `attachments:listForEntity` (query)
Files attached to a record, with download URLs. Client users only see client-visible files.
- **Args:** `{ entityId: string, entityType: "site" | "asset" | "job" | "visit" | "inspection" | "defect" | "certificate" | "quote", orgId: Id<organizations> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `attachments:remove` (mutation)
Delete an attachment and its file (uploader or office; not on issued certificates).
- **Args:** `{ attachmentId: Id<attachments> }`
- **Who:** staff (owner/admin/office/engineer)

### `attachments:update` (mutation)
- **Args:** `{ attachmentId: Id<attachments>, caption?: string, visibleToClient?: boolean }`
- **Who:** staff (owner/admin/office/engineer)

## auth

### `auth:isAuthenticated` (query)
- **Args:** none
- **Who:** PUBLIC

### `auth:signIn` (action)
- **Args:** `{ calledBy?: string, params?: any, provider?: string, refreshToken?: string, verifier?: string }`
- **Who:** PUBLIC

### `auth:signOut` (action)
- **Args:** none
- **Who:** PUBLIC

## certificatePdf

### `certificatePdf:generateLabel` (action)
Generate (or regenerate) a printable 50x25 mm QR label for an asset or a site. Staff only. Returns a download URL; the label is also saved on the record (labelPdfId).

- **Args:** `{ assetId?: Id<assets>, siteId?: Id<sites> }`
- **Who:** any signed-in user

## certificateTypes

### `certificateTypes:create` (mutation)
- **Args:** `{ code: string, discipline: Discipline, name: string, numberPrefix: string, orgId: Id<organizations>, requiresClientSignature: boolean, standard?: string, templateKey?: string, validityMonths?: number }`
- **Who:** office (owner/admin/office)

### `certificateTypes:list` (query)
Certificate types available to the org (own + built-in).
- **Args:** `{ discipline?: Discipline, includeInactive?: boolean, orgId: Id<organizations> }`
- **Who:** staff (owner/admin/office/engineer)

### `certificateTypes:update` (mutation)
Edit a type. Existing certificates keep their numbers; changes apply to new ones.
- **Args:** `{ certificateTypeId: Id<certificateTypes>, isActive?: boolean, name?: string, numberPrefix?: string, requiresClientSignature?: boolean, standard?: string, templateKey?: string, validityMonths?: number }`
- **Who:** office (owner/admin/office)

## certificates

### `certificates:createDraft` (mutation)
Create a draft certificate from a job, a visit, or just a site. With a job/visit, the draft is pre-filled with its inspections, the inspected assets and the defects raised on it.

- **Args:** `{ certificateTypeId: Id<certificateTypes>, clientGeneratedId?: string, inspectionDate?: number, jobId?: Id<jobs>, overallResult?: "satisfactory" | "unsatisfactory" | "satisfactory_with_observations", siteId?: Id<sites>, summary?: string, visitId?: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `certificates:get` (query)
- **Args:** `{ certificateId: Id<certificates> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `certificates:getPdf` (query)
Download URL + status of a certificate's PDF (staff or the client's portal users).
- **Args:** `{ certificateId: Id<certificates> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `certificates:issue` (mutation)
Finalise a draft certificate: checks signatures, sets status `issued`, dates and verification token, supersedes the previous revision, and queues PDF generation.

- **Args:** `{ certificateId: Id<certificates>, qualificationOverrideReason?: string }`
- **Who:** staff (owner/admin/office/engineer)

### `certificates:list` (query)
Certificates by status (office+ all; engineers those on sites of their assigned jobs; client users their client's issued ones). Paginated, newest first.
- **Args:** `{ orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, status?: "draft" | "pending_signature" | "issued" | "superseded" | "revoked" | "all" }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `certificates:listBySite` (query)
Certificates for a site (staff, or the site's client portal users). Newest first.
- **Args:** `{ orgId: Id<organizations>, siteId: Id<sites> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `certificates:qualificationCheck` (query)
Staff: would this engineer pass the qualification check for this certificate right now? Defaults to the current user (engineer signing) or, if already signed, the signing engineer. Use before showing the sign / issue buttons; `canOverride` = current user is owner/admin.

- **Args:** `{ certificateId: Id<certificates>, engineerUserId?: Id<users> }`
- **Who:** staff (owner/admin/office/engineer)

### `certificates:regeneratePdf` (mutation)
Re-render the PDF of an issued certificate, e.g. after a logo change (owner/admin).
- **Args:** `{ certificateId: Id<certificates> }`
- **Who:** managers (owner/admin)

### `certificates:reissue` (mutation)
Start a reissue: copies an issued certificate into a new draft revision (new number suffix /R1, /R2…, new QR token, signatures cleared). When the new draft is issued, the original becomes `superseded`.

- **Args:** `{ certificateId: Id<certificates>, reason?: string }`
- **Who:** OFFICE_ROLES

### `certificates:removeDraft` (mutation)
Delete a draft that was never issued (office).
- **Args:** `{ certificateId: Id<certificates> }`
- **Who:** office (owner/admin/office)

### `certificates:revoke` (mutation)
Withdraw an issued certificate (owner/admin). The QR page will show REVOKED.
- **Args:** `{ certificateId: Id<certificates>, reason: string }`
- **Who:** managers (owner/admin)

### `certificates:sign` (mutation)
Add the engineer's or the client's signature to a draft (image uploaded via visits.generateUploadUrl).
- **Args:** `{ as: "engineer" | "client", certificateId: Id<certificates>, qualificationOverrideReason?: string, signature: { deviceInfo?: string, signatureImageId?: Id<_storage>, signedByName: string, signedByRole?: string } }`
- **Who:** staff (owner/admin/office/engineer)

### `certificates:updateDraft` (mutation)
Edit a draft (content, covered assets/inspections/defects, dates). Issued certificates are locked; use reissue.
- **Args:** `{ addAssetIds?: Id<assets>[], addDefectIds?: Id<defects>[], addInspectionIds?: Id<inspections>[], assetIds?: Id<assets>[], certificateId: Id<certificates>, data?: any, defectIds?: Id<defects>[], expiresAt?: number, inspectionDate?: number, inspectionIds?: Id<inspections>[], nextInspectionDueAt?: number, overallResult?: "satisfactory" | "unsatisfactory" | "satisfactory_with_observations", summary?: string }`
- **Who:** staff (owner/admin/office/engineer)

### `certificates:verify` (query)
PUBLIC: QR-code verification by token. Returns only non-sensitive fields.
- **Args:** `{ token: string }`
- **Who:** PUBLIC (holder of token)

## checklistTemplates

### `checklistTemplates:create` (mutation)
- **Args:** `{ discipline: Discipline, items: { guidance?: string, key: string, label: string, required: boolean, responseType: "pass_fail" | "yes_no_na" | "number" | "text" | "photo" | "signature", section?: string, unit?: string }[], name: string, orgId: Id<organizations>, scope: "system" | "asset", standard?: string }`
- **Who:** office (owner/admin/office)

### `checklistTemplates:get` (query)
- **Args:** `{ templateId: Id<checklistTemplates> }`
- **Who:** staff (owner/admin/office/engineer)

### `checklistTemplates:list` (query)
Org templates plus built-in ones (any staff; engineers need them in the field).
- **Args:** `{ discipline?: Discipline, includeInactive?: boolean, orgId: Id<organizations> }`
- **Who:** staff (owner/admin/office/engineer)

### `checklistTemplates:update` (mutation)
Edit a template. Changing the items bumps `version` (inspections keep the version they used).
- **Args:** `{ isActive?: boolean, items?: { guidance?: string, key: string, label: string, required: boolean, responseType: "pass_fail" | "yes_no_na" | "number" | "text" | "photo" | "signature", section?: string, unit?: string }[], name?: string, standard?: string, templateId: Id<checklistTemplates> }`
- **Who:** office (owner/admin/office)

## clients

### `clients:create` (mutation)
- **Args:** `{ accountNumber?: string, billingAddress?: { city?: string, country?: string, line1: string, line2?: string, postcode?: string, region?: string }, contacts?: { email?: string, name: string, phone?: string, role?: string }[], name: string, notes?: string, orgId: Id<organizations>, primaryContact?: { email?: string, name: string, phone?: string, role?: string }, reminderEmails?: string[], type: "commercial" | "residential" | "public_sector" | "managing_agent" }`
- **Who:** office (owner/admin/office)

### `clients:get` (query)
One client. Office+: full record. Engineers: `{ _id, name }` only, and only for clients of their assigned jobs' sites. Portal users: their own client without notes / account number / accounting id.

- **Args:** `{ clientId: Id<clients> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `clients:list` (query)
Clients. Office+: full records, paginated newest first; `search` uses the name search index. Engineers: only clients of their assigned jobs' sites, as `{ _id, name }` (single page).

- **Args:** `{ orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, search?: string, status?: "active" | "archived" }`
- **Who:** staff (owner/admin/office/engineer)

### `clients:setArchived` (mutation)
Archive (hide) or restore a client. Clients are never hard-deleted (certificates reference them).
- **Args:** `{ archived: boolean, clientId: Id<clients> }`
- **Who:** office (owner/admin/office)

### `clients:update` (mutation)
- **Args:** `{ accountNumber?: string, billingAddress?: { city?: string, country?: string, line1: string, line2?: string, postcode?: string, region?: string }, clientId: Id<clients>, contacts?: { email?: string, name: string, phone?: string, role?: string }[], name?: string, notes?: string, primaryContact?: { email?: string, name: string, phone?: string, role?: string }, reminderEmails?: string[], type?: "commercial" | "residential" | "public_sector" | "managing_agent" }`
- **Who:** office (owner/admin/office)

## defects

### `defects:get` (query)
- **Args:** `{ defectId: Id<defects> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `defects:linkJob` (mutation)
Link a defect to a remedial job (marks it "scheduled") or clear the link.
- **Args:** `{ defectId: Id<defects>, jobId: Id<jobs> | null }`
- **Who:** office (owner/admin/office)

### `defects:linkQuote` (mutation)
Link a defect to a quote (marks it "quoted") or clear the link.
- **Args:** `{ defectId: Id<defects>, quoteId: Id<quotes> | null }`
- **Who:** office (owner/admin/office)

### `defects:list` (query)
Defects by status: org-wide (office+), sites of assigned jobs (engineers), or the client user's client. Paginated.
- **Args:** `{ orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, siteId?: Id<sites>, status?: "open" | "quoted" | "scheduled" | "in_progress" | "resolved" | "verified" | "closed_no_action" | "all" }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `defects:openForSite` (query)
Open (unresolved) defects for a site. Client users only see client-visible defects.
- **Args:** `{ orgId: Id<organizations>, siteId: Id<sites> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `defects:raise` (mutation)
Raise a defect (staff, e.g. from the field). Idempotent on clientGeneratedId.
- **Args:** `{ assetId?: Id<assets>, capturedAt?: number, clientGeneratedId?: string, description?: string, deviceId?: string, discipline?: Discipline, inspectionId?: Id<inspections>, locationId?: Id<locations>, photoIds?: Id<_storage>[], recommendedAction?: string, severity: "critical" | "major" | "minor" | "advisory", siteId: Id<sites>, targetResolutionAt?: number, title: string, visibleToClient?: boolean, visitId?: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `defects:setStatus` (mutation)
Move a defect through its life cycle. Resolving records who/when; verifying or closing needs the office.
- **Args:** `{ defectId: Id<defects>, resolutionNotes?: string, status: "open" | "quoted" | "scheduled" | "in_progress" | "resolved" | "verified" | "closed_no_action" }`
- **Who:** staff (owner/admin/office/engineer)

### `defects:update` (mutation)
- **Args:** `{ defectId: Id<defects>, description?: string, photoIds?: Id<_storage>[], recommendedAction?: string, severity?: "critical" | "major" | "minor" | "advisory", targetResolutionAt?: number, title?: string, visibleToClient?: boolean }`
- **Who:** staff (owner/admin/office/engineer)

## inspections

### `inspections:listForAsset` (query)
- **Args:** `{ assetId: Id<assets>, limit?: number }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `inspections:listForVisit` (query)
- **Args:** `{ visitId: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `inspections:readingsForAsset` (query)
Reading history for one asset and key (newest first), e.g. battery voltage over time.
- **Args:** `{ assetId: Id<assets>, key: string, limit?: number }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `inspections:record` (mutation)
Bulk-record inspections from the field (one per asset or one system-level). Each item is idempotent on clientGeneratedId, so a device can safely re-send its whole offline queue. Nested readings are stored against the asset. Updates the asset's last inspected/result.

- **Args:** `{ deviceId?: string, inspections: { assetId?: Id<assets>, clientGeneratedId?: string, discipline?: Discipline, overallResult: "pass" | "fail" | "advisory" | "not_tested", performedAt?: number, readings?: { clientGeneratedId?: string, key: string, label?: string, recordedAt?: number, unit?: string, value: number | boolean | string }[], responses: { comment?: string, itemKey: string, photoIds?: Id<_storage>[], result?: "pass" | "fail" | "na", value?: string | number | boolean | null }[], templateId?: Id<checklistTemplates> }[], visitId: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `inspections:recordReadings` (mutation)
Bulk readings for assets (e.g. battery voltages / lux levels), idempotent on clientGeneratedId.
- **Args:** `{ deviceId?: string, readings: { assetId: Id<assets>, clientGeneratedId?: string, key: string, label?: string, recordedAt?: number, unit?: string, value: number | boolean | string }[], visitId: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `inspections:update` (mutation)
Correct an inspection. Locked once an issued certificate covers it (reissue the certificate instead).
- **Args:** `{ inspectionId: Id<inspections>, overallResult?: "pass" | "fail" | "advisory" | "not_tested", responses?: { comment?: string, itemKey: string, photoIds?: Id<_storage>[], result?: "pass" | "fail" | "na", value?: string | number | boolean | null }[] }`
- **Who:** staff (owner/admin/office/engineer)

## invoices

### `invoices:create` (mutation)
Manual invoice (office). Amounts in pence; VAT rate defaults to the company's rate.
- **Args:** `{ clientId: Id<clients>, lines: { description: string, discountPercent?: number, quantity: number, taxRate?: number, unitPrice: number }[], notes?: string, paymentTermsDays?: number, siteId?: Id<sites> }`
- **Who:** office (owner/admin/office)

### `invoices:createFromJob` (mutation)
Invoice a completed job: from its accepted quote if it has one, otherwise from the lines given. Job becomes "invoiced".
- **Args:** `{ jobId: Id<jobs>, lines?: { description: string, discountPercent?: number, quantity: number, taxRate?: number, unitPrice: number }[], notes?: string, paymentTermsDays?: number }`
- **Who:** office (owner/admin/office)

### `invoices:createFromQuote` (mutation)
Invoice an accepted quote (selected lines, keeping unit prices and line discounts).
- **Args:** `{ notes?: string, paymentTermsDays?: number, quoteId: Id<quotes> }`
- **Who:** office (owner/admin/office)

### `invoices:get` (query)
- **Args:** `{ invoiceId: Id<invoices> }`
- **Who:** OFFICE_OR_CLIENT

### `invoices:getPdf` (query)
PDF status + download URL. Office/managers any status; portal users only sent invoices they can see. Engineers can't.
- **Args:** `{ invoiceId: Id<invoices> }`
- **Who:** OFFICE_OR_CLIENT

### `invoices:list` (query)
Invoices by status (office), or the client user's own invoices (sent onwards). Paginated.
- **Args:** `{ clientId?: Id<clients>, orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, status?: "draft" | "sent" | "partially_paid" | "paid" | "overdue" | "void" | "all" }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `invoices:recordPayment` (mutation)
Record a payment (office). Status becomes partially_paid or paid; overpayment is refused.
- **Args:** `{ amount: number, invoiceId: Id<invoices>, method: "bank_transfer" | "card" | "cash" | "cheque" | "other", paidAt?: number, reference?: string }`
- **Who:** office (owner/admin/office)

### `invoices:regeneratePdf` (mutation)
Re-render the PDF now (office), e.g. after changing bank details or the logo. Drafts render as a DRAFT preview.
- **Args:** `{ invoiceId: Id<invoices> }`
- **Who:** office (owner/admin/office)

### `invoices:send` (mutation)
Issue and email the invoice (dry run until email is configured). Due date = issue + payment terms (default 30 days).
- **Args:** `{ invoiceId: Id<invoices>, message?: string, to?: string }`
- **Who:** office (owner/admin/office)

### `invoices:update` (mutation)
- **Args:** `{ invoiceId: Id<invoices>, lines?: { description: string, discountPercent?: number, quantity: number, taxRate?: number, unitPrice: number }[], notes?: string, paymentTermsDays?: number, siteId?: Id<sites> }`
- **Who:** office (owner/admin/office)

### `invoices:voidInvoice` (mutation)
Void an invoice (owner/admin, reason required). A voided job invoice puts the job back to completed.
- **Args:** `{ invoiceId: Id<invoices>, reason: string }`
- **Who:** managers (owner/admin)

## jobs

### `jobs:assignEngineers` (mutation)
- **Args:** `{ engineerIds: Id<users>[], jobId: Id<jobs> }`
- **Who:** office (owner/admin/office)

### `jobs:checkAssignment` (query)
Office: preview qualification warnings before assigning (e.g. while picking engineers in the job form). `at` = planned visit date (defaults to now). Returns [] when everyone is qualified.

- **Args:** `{ at?: number, disciplines: Discipline[], engineerIds: Id<users>[], orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `jobs:create` (mutation)
- **Args:** `{ assignedEngineerIds?: Id<users>[], description?: string, disciplines: Discipline[], priority?: "low" | "normal" | "high" | "emergency", purchaseOrderNumber?: string, quoteId?: Id<quotes>, scheduleId?: Id<serviceSchedules>, scheduledEnd?: number, scheduledStart?: number, siteId: Id<sites>, title: string, type: "routine_service" | "inspection" | "installation" | "commissioning" | "remedial" | "callout" | "survey" }`
- **Who:** office (owner/admin/office)

### `jobs:get` (query)
- **Args:** `{ jobId: Id<jobs> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `jobs:list` (query)
Jobs by status. Office+ all; engineers only jobs assigned to them; client users their own client's jobs. Paginated.
- **Args:** `{ orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, siteId?: Id<sites>, status?: "draft" | "scheduled" | "in_progress" | "on_hold" | "completed" | "invoiced" | "cancelled" }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `jobs:myJobs` (query)
The signed-in engineer's open jobs in a date window (defaults: last 7 days to next 30).
- **Args:** `{ from?: number, orgId: Id<organizations>, to?: number }`
- **Who:** staff (owner/admin/office/engineer)

### `jobs:setStatus` (mutation)
Change status. Office can make any allowed change; an assigned engineer can start, hold and complete. Completing a job advances its linked service schedule (next due = completion date + frequency).

- **Args:** `{ completedAt?: number, jobId: Id<jobs>, reason?: string, status: "draft" | "scheduled" | "in_progress" | "on_hold" | "completed" | "invoiced" | "cancelled" }`
- **Who:** staff (owner/admin/office/engineer)

### `jobs:update` (mutation)
- **Args:** `{ description?: string, disciplines?: Discipline[], jobId: Id<jobs>, priority?: "low" | "normal" | "high" | "emergency", purchaseOrderNumber?: string, scheduledEnd?: number, scheduledStart?: number, title?: string, type?: "routine_service" | "inspection" | "installation" | "commissioning" | "remedial" | "callout" | "survey" }`
- **Who:** office (owner/admin/office)

## locations

### `locations:create` (mutation)
- **Args:** `{ code?: string, floorPlanId?: Id<_storage>, kind: "building" | "floor" | "zone" | "room" | "area", name: string, parentId?: Id<locations>, siteId: Id<sites>, sortOrder?: number }`
- **Who:** staff (owner/admin/office/engineer)

### `locations:listBySite` (query)
All locations (building > floor > zone > room) at a site, flat; build the tree with parentId.
- **Args:** `{ siteId: Id<sites> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `locations:remove` (mutation)
Delete an empty location (no sub-locations and no assets).
- **Args:** `{ locationId: Id<locations> }`
- **Who:** staff (owner/admin/office/engineer)

### `locations:update` (mutation)
- **Args:** `{ code?: string, floorPlanId?: Id<_storage>, kind?: "building" | "floor" | "zone" | "room" | "area", locationId: Id<locations>, name?: string, parentId?: Id<locations> | null, sortOrder?: number }`
- **Who:** staff (owner/admin/office/engineer)

## organizations

### `organizations:createWithOwner` (mutation)
First-time onboarding: the signed-in user creates their company and becomes its owner.
- **Args:** `{ currency?: string, disciplines: Discipline[], email?: string, name: string, phone?: string, timezone?: string }`
- **Who:** any signed-in user

### `organizations:generateLogoUploadUrl` (mutation)
Owner/admin: get a URL to upload the logo to (POST the file, then call setLogo with the storageId).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** managers (owner/admin)

### `organizations:get` (query)
Company profile (any member, incl. client portal users: name/logo/contact only).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `organizations:getJobAutomationSettings` (query)
Office: automatic routine-job settings (defaults applied).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `organizations:getReminderSettings` (query)
Effective reminder settings (defaults merged).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `organizations:removeLogo` (mutation)
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** managers (owner/admin)

### `organizations:setLogo` (mutation)
Owner/admin: use an uploaded image (PNG/JPEG/WebP, max 2 MB) as the company logo.
- **Args:** `{ orgId: Id<organizations>, storageId: Id<_storage> }`
- **Who:** managers (owner/admin)

### `organizations:updateBillingSettings` (mutation)
Invoice/quote settings (owner/admin): bank details printed on invoices, default quote terms, invoice footer. Pass `bankDetails: null` to clear. UK sort code = 6 digits, account number = 8 digits.

- **Args:** `{ bankDetails?: null | { accountName?: string, accountNumber?: string, bankName?: string, bic?: string, iban?: string, paymentInstructions?: string, sortCode?: string }, invoiceFooter?: string, orgId: Id<organizations>, quoteTerms?: string }`
- **Who:** managers (owner/admin)

### `organizations:updateJobAutomationSettings` (mutation)
Office: turn automatic routine jobs on/off, change the lead window (0-365 days) or the office summary email.
- **Args:** `{ enabled?: boolean, leadDays?: number, notifyOffice?: boolean, orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `organizations:updateProfile` (mutation)
Owner/admin: edit the company profile shown on certificates, quotes, invoices and emails.
- **Args:** `{ accreditations?: { body: string, expiresAt?: number, number?: string, scheme?: string }[], address?: { city?: string, country?: string, line1: string, line2?: string, postcode?: string, region?: string }, defaultTaxRate?: number, disciplines?: Discipline[], email?: string, legalName?: string, name?: string, orgId: Id<organizations>, phone?: string, registrationNumber?: string, timezone?: string, vatNumber?: string }`
- **Who:** managers (owner/admin)

### `organizations:updateReminderSettings` (mutation)
Owner/admin: change reminder lead times, recipients and digest. Omitted fields are unchanged.
- **Args:** `{ certificateLeadDays?: number[], defectFollowUpDays?: { advisory: number, critical: number, major: number, minor: number }, enabled?: boolean, invoiceOverdueDays?: number[], invoiceRemindClient?: boolean, officeEmails?: string[], orgId: Id<organizations>, overdueMaxReminders?: number, overdueRepeatDays?: number, qualificationLeadDays?: number[], quoteFollowUpDays?: number[], serviceLeadDays?: number[], weeklyDigest?: boolean }`
- **Who:** managers (owner/admin)

## portal

### `portal:acceptInvitation` (mutation)
Signed-in user accepts a portal invitation: creates a client_user membership for the client and a portalAccess grant (limited to the invited sites, if any).

- **Args:** `{ token: string }`
- **Who:** signed-in user holding the invite token

### `portal:createInvitation` (mutation)
Invite a client contact to the read-only portal (office). Returns the invite link once; only a hash of the token is stored. An email is queued (dry run until email is configured).

- **Args:** `{ clientId: Id<clients>, email: string, name?: string, siteIds?: Id<sites>[] }`
- **Who:** office (owner/admin/office)

### `portal:listAccess` (query)
Portal users for a client, with their access (office).
- **Args:** `{ clientId: Id<clients> }`
- **Who:** office (owner/admin/office)

### `portal:listInvitations` (query)
Pending invitations for the org or one client (office). Paginated.
- **Args:** `{ clientId?: Id<clients>, orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number } }`
- **Who:** office (owner/admin/office)

### `portal:revokeAccess` (mutation)
Remove a portal user's access (office). Their client_user membership is disabled.
- **Args:** `{ accessId: Id<portalAccess> }`
- **Who:** office (owner/admin/office)

### `portal:revokeInvitation` (mutation)
- **Args:** `{ invitationId: Id<portalInvitations> }`
- **Who:** office (owner/admin/office)

### `portal:updateAccess` (mutation)
Change a portal user's site scope or quote-acceptance right (office).
- **Args:** `{ accessId: Id<portalAccess>, canAcceptQuotes?: boolean, siteIds?: Id<sites>[] }`
- **Who:** office (owner/admin/office)

## qualifications

### `qualifications:create` (mutation)
- **Args:** `{ discipline: Discipline, documentId?: Id<_storage>, expiresAt?: number, issuedAt?: number, issuer?: string, orgId: Id<organizations>, reference?: string, title: string, userId: Id<users> }`
- **Who:** office (owner/admin/office)

### `qualifications:list` (query)
Qualifications for the org (office) or for one engineer (office, or the engineer themself).
- **Args:** `{ orgId: Id<organizations>, userId?: Id<users> }`
- **Who:** staff (owner/admin/office/engineer)

### `qualifications:remove` (mutation)
- **Args:** `{ qualificationId: Id<engineerQualifications> }`
- **Who:** office (owner/admin/office)

### `qualifications:update` (mutation)
- **Args:** `{ discipline?: Discipline, documentId?: Id<_storage>, expiresAt?: number, issuedAt?: number, issuer?: string, qualificationId: Id<engineerQualifications>, reference?: string, title?: string }`
- **Who:** office (owner/admin/office)

## quotes

### `quotes:addLine` (mutation)
- **Args:** `{ defectId?: Id<defects>, description: string, discountPercent?: number, kind?: "labour" | "material" | "equipment" | "service" | "other", optional?: boolean, productCode?: string, quantity: number, quoteId: Id<quotes>, taxRate?: number, unitPrice: number }`
- **Who:** office (owner/admin/office)

### `quotes:convertToJob` (mutation)
Turn an accepted quote into a remedial job; linked defects become "scheduled".
- **Args:** `{ assignedEngineerIds?: Id<users>[], quoteId: Id<quotes>, scheduledEnd?: number, scheduledStart?: number, siteId?: Id<sites> }`
- **Who:** office (owner/admin/office)

### `quotes:create` (mutation)
- **Args:** `{ clientId: Id<clients>, defectIds?: Id<defects>[], introduction?: string, lines?: { defectId?: Id<defects>, description: string, discountPercent?: number, kind?: "labour" | "material" | "equipment" | "service" | "other", optional?: boolean, productCode?: string, quantity: number, taxRate?: number, unitPrice: number }[], siteId?: Id<sites>, terms?: string, title: string, validUntil?: number }`
- **Who:** office (owner/admin/office)

### `quotes:generateSignatureUploadUrl` (mutation)
PUBLIC: upload URL for the acceptance signature image (only while the quote is open).
- **Args:** `{ token: string }`
- **Who:** PUBLIC (holder of token)

### `quotes:get` (query)
- **Args:** `{ quoteId: Id<quotes> }`
- **Who:** OFFICE_OR_CLIENT

### `quotes:getByToken` (query)
PUBLIC: the client-facing view of a quote, by its acceptance link token.
- **Args:** `{ token: string }`
- **Who:** PUBLIC (holder of token)

### `quotes:getPdf` (query)
PDF status + download URL. Staff any status; portal users only for quotes they can see (not drafts/superseded). `publicUrl` is the stable emailed link (latest render), null for drafts.

- **Args:** `{ quoteId: Id<quotes> }`
- **Who:** OFFICE_OR_CLIENT

### `quotes:list` (query)
Quotes by status (staff) or the client user's quotes (sent onwards). Paginated, newest first.
- **Args:** `{ clientId?: Id<clients>, orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, status?: "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired" | "superseded" | "all" }`
- **Who:** OFFICE_OR_CLIENT

### `quotes:markViewed` (mutation)
PUBLIC: record that the client opened the link (call once on page load).
- **Args:** `{ token: string }`
- **Who:** PUBLIC (holder of token)

### `quotes:regeneratePdf` (mutation)
Re-render the PDF now (office). Works for drafts too (watermarked DRAFT) as a preview.
- **Args:** `{ quoteId: Id<quotes> }`
- **Who:** office (owner/admin/office)

### `quotes:remove` (mutation)
Delete a draft quote that was never sent.
- **Args:** `{ quoteId: Id<quotes> }`
- **Who:** office (owner/admin/office)

### `quotes:removeLine` (mutation)
- **Args:** `{ lineId: Id<quoteLineItems> }`
- **Who:** office (owner/admin/office)

### `quotes:respond` (mutation)
PUBLIC: accept or decline via the link. Accepting needs the signer's name (+ optional signature image) and can opt in/out of optional lines; totals are recalculated from the selection.

- **Args:** `{ decision: "accepted" | "declined", declineReason?: string, purchaseOrderNumber?: string, selectedOptionalLineIds?: Id<quoteLineItems>[], signatureImageId?: Id<_storage>, signedByName?: string, signedByRole?: string, token: string, userAgent?: string }`
- **Who:** PUBLIC (holder of quote link)

### `quotes:revise` (mutation)
Copy a sent/declined/expired quote into a new draft revision; the old one becomes superseded.
- **Args:** `{ quoteId: Id<quotes> }`
- **Who:** office (owner/admin/office)

### `quotes:send` (mutation)
Send to the client: freezes the quote, creates the public acceptance link and queues an email (dry run until email is configured). Recipient defaults to the client's primary contact.

- **Args:** `{ message?: string, quoteId: Id<quotes>, to?: string, validUntil?: number }`
- **Who:** office (owner/admin/office)

### `quotes:update` (mutation)
- **Args:** `{ defectIds?: Id<defects>[], introduction?: string, quoteId: Id<quotes>, siteId?: Id<sites>, terms?: string, title?: string, validUntil?: number }`
- **Who:** office (owner/admin/office)

### `quotes:updateLine` (mutation)
- **Args:** `{ description?: string, discountPercent?: number, kind?: "labour" | "material" | "equipment" | "service" | "other", lineId: Id<quoteLineItems>, optional?: boolean, productCode?: string, quantity?: number, sortOrder?: number, taxRate?: number, unitPrice?: number }`
- **Who:** office (owner/admin/office)

## reminders

### `reminders:dismiss` (mutation)
Dismiss a pending reminder; it will not be recreated for the same stage. Office+ only.
- **Args:** `{ reason?: string, reminderId: Id<reminders> }`
- **Who:** office (owner/admin/office)

### `reminders:getNotification` (query)
One notification including its rendered HTML / text (preview). Office+ only.
- **Args:** `{ notificationId: Id<notifications> }`
- **Who:** office (owner/admin/office)

### `reminders:list` (query)
Reminders by status (default: pending = upcoming), soonest first; dispatched ones newest first. Office+ only.
- **Args:** `{ limit?: number, orgId: Id<organizations>, status?: "pending" | "dispatched" | "no_recipients" | "dismissed" | "cancelled" }`
- **Who:** office (owner/admin/office)

### `reminders:listNotifications` (query)
Notification log (sent / dry-run / skipped / failed), newest first. Office+ only.
- **Args:** `{ limit?: number, orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `reminders:providerStatus` (query)
Whether real sending is configured (for a settings screen).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `reminders:runNow` (mutation)
Run the planner + dispatcher for your company now instead of waiting for 07:00 (owner/admin).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** managers (owner/admin)

### `reminders:sendTest` (mutation)
Send a test reminder email to yourself (or a given address). Dry-run when no provider is configured.
- **Args:** `{ orgId: Id<organizations>, to?: string }`
- **Who:** office (owner/admin/office)

### `reminders:snooze` (mutation)
Postpone a pending reminder by N days (sent at 07:00 UK time on that day). Office+ only.
- **Args:** `{ days: number, reminderId: Id<reminders> }`
- **Who:** office (owner/admin/office)

## serviceSchedules

### `serviceSchedules:create` (mutation)
Create a schedule. autoCreateJob now defaults to true: a routine job is created automatically `autoJobLeadDays` (else the org's jobAutomation.leadDays, default 30) before each due date, unless the org has turned automation off.

- **Args:** `{ assetId?: Id<assets>, autoCreateJob?: boolean, autoJobLeadDays?: number, contractReference?: string, defaultEngineerId?: Id<users>, discipline: Discipline, frequency: { interval: number, unit: "day" | "week" | "month" | "year" }, lastCompletedAt?: number, name: string, nextDueAt?: number, notifyClient?: boolean, notifyOrg?: boolean, reminderOffsetsDays?: number[], siteId: Id<sites> }`
- **Who:** office (owner/admin/office)

### `serviceSchedules:dueSoon` (query)
Active service schedules due within the next `days` days (incl. overdue). Office+ only.
- **Args:** `{ days?: number, orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `serviceSchedules:get` (query)
- **Args:** `{ scheduleId: Id<serviceSchedules> }`
- **Who:** OFFICE_OR_CLIENT

### `serviceSchedules:list` (query)
Schedules ordered by next due date (office+), or for one site (office+ or that site's portal users). Engineers refused. Paginated.
- **Args:** `{ orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, siteId?: Id<sites>, status?: "active" | "paused" | "ended" }`
- **Who:** OFFICE_OR_CLIENT

### `serviceSchedules:runAutoJobsNow` (mutation)
Office: run the daily auto-job step now (same rules and dedupe as the 07:00 UK run).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `serviceSchedules:setStatus` (mutation)
Pause, resume or end a schedule. Paused/ended schedules send no reminders and get no new auto jobs.
- **Args:** `{ scheduleId: Id<serviceSchedules>, status: "active" | "paused" | "ended" }`
- **Who:** office (owner/admin/office)

### `serviceSchedules:update` (mutation)
- **Args:** `{ autoCreateJob?: boolean, autoJobLeadDays?: number | null, contractReference?: string, defaultEngineerId?: Id<users> | null, frequency?: { interval: number, unit: "day" | "week" | "month" | "year" }, name?: string, nextDueAt?: number, notifyClient?: boolean, notifyOrg?: boolean, reminderOffsetsDays?: number[], scheduleId: Id<serviceSchedules> }`
- **Who:** office (owner/admin/office)

## sites

### `sites:create` (mutation)
- **Args:** `{ accessNotes?: string, address: { city?: string, country?: string, line1: string, line2?: string, postcode?: string, region?: string }, clientId: Id<clients>, geo?: { lat: number, lng: number }, hazards?: string[], name: string, orgId: Id<organizations>, reference?: string, responsiblePerson?: { email?: string, name: string, phone?: string, role?: string }, siteContact?: { email?: string, name: string, phone?: string, role?: string } }`
- **Who:** office (owner/admin/office)

### `sites:get` (query)
- **Args:** `{ siteId: Id<sites> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `sites:list` (query)
Sites for a client (staff or that client's portal users), or all org sites (office+). Engineers: only sites of their assigned jobs (one page). Paginated.
- **Args:** `{ clientId?: Id<clients>, orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number }, search?: string }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `sites:setArchived` (mutation)
- **Args:** `{ archived: boolean, siteId: Id<sites> }`
- **Who:** office (owner/admin/office)

### `sites:update` (mutation)
Edit site details. Engineers may update access notes, hazards, contacts and GPS from the field.
- **Args:** `{ accessNotes?: string, address?: { city?: string, country?: string, line1: string, line2?: string, postcode?: string, region?: string }, geo?: { lat: number, lng: number }, hazards?: string[], name?: string, reference?: string, responsiblePerson?: { email?: string, name: string, phone?: string, role?: string }, siteContact?: { email?: string, name: string, phone?: string, role?: string }, siteId: Id<sites> }`
- **Who:** staff (owner/admin/office/engineer)

## team

### `team:acceptInvitation` (mutation)
Signed-in user accepts a staff invitation (their account email must match the invite).
- **Args:** `{ token: string }`
- **Who:** signed-in user holding the invite token

### `team:invite` (mutation)
Owner/admin: invite a staff member by email. Returns the invite link (shown once); an invite email is also queued (dry run until email sending is configured).

- **Args:** `{ email: string, name?: string, orgId: Id<organizations>, role: "owner" | "admin" | "office" | "engineer" }`
- **Who:** managers (owner/admin)

### `team:list` (query)
Team members with name/email (owner/admin/office). Client portal users are listed under portal.
- **Args:** `{ includeDisabled?: boolean, orgId: Id<organizations> }`
- **Who:** office (owner/admin/office)

### `team:listEngineers` (query)
Active engineers (for job assignment pickers). Any staff member.
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** staff (owner/admin/office/engineer)

### `team:listInvitations` (query)
- **Args:** `{ orgId: Id<organizations>, paginationOpts: { cursor: string | null, endCursor?: string | null, id?: number, maximumBytesRead?: number, maximumRowsRead?: number, numItems: number } }`
- **Who:** managers (owner/admin)

### `team:revokeInvitation` (mutation)
- **Args:** `{ invitationId: Id<teamInvitations> }`
- **Who:** managers (owner/admin)

### `team:setActive` (mutation)
Owner/admin: deactivate (or reactivate) a staff member. Deactivated users lose access immediately.
- **Args:** `{ active: boolean, membershipId: Id<memberships> }`
- **Who:** managers (owner/admin)

### `team:updateRole` (mutation)
Owner/admin: change a staff member's role. Only owners can grant/remove owner; the last owner can't be demoted.
- **Args:** `{ membershipId: Id<memberships>, role: "owner" | "admin" | "office" | "engineer" }`
- **Who:** managers (owner/admin)

## users

### `users:me` (query)
Current signed-in user plus their org memberships; null when signed out.
- **Args:** none
- **Who:** any signed-in user

## visits

### `visits:abort` (mutation)
Abort a visit (no access, unsafe, etc.).
- **Args:** `{ reason: string, visitId: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `visits:finish` (mutation)
Engineer leaves site: notes plus engineer/customer signatures. Optionally completes the job.
- **Args:** `{ completeJob?: boolean, customerSignature?: { deviceInfo?: string, signatureImageId?: Id<_storage>, signedByName: string, signedByRole?: string }, departedAt?: number, engineerSignature?: { deviceInfo?: string, signatureImageId?: Id<_storage>, signedByName: string, signedByRole?: string }, geo?: { lat: number, lng: number }, notes?: string, visitId: Id<visits> }`
- **Who:** staff (owner/admin/office/engineer)

### `visits:generateUploadUrl` (mutation)
Upload URL for a signature image or photo captured during a visit (staff).
- **Args:** `{ orgId: Id<organizations> }`
- **Who:** staff (owner/admin/office/engineer)

### `visits:listByJob` (query)
Visits for a job (with signature image URLs).
- **Args:** `{ jobId: Id<jobs> }`
- **Who:** any member incl. client_user (client_user scoped to own client/sites, read-only)

### `visits:start` (mutation)
Engineer arrives on site. Idempotent on clientGeneratedId (offline). Moves the job to in_progress. Office staff may start a visit on behalf of an assigned engineer via `engineerId`.

- **Args:** `{ arrivedAt?: number, clientGeneratedId?: string, deviceId?: string, engineerId?: Id<users>, geo?: { lat: number, lng: number }, jobId: Id<jobs> }`
- **Who:** staff (owner/admin/office/engineer)
