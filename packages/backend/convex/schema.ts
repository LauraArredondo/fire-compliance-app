import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/* ------------------------------------------------------------------ */
/* Shared validators                                                   */
/* ------------------------------------------------------------------ */

export const discipline = v.union(
  v.literal("fire_alarm"),
  v.literal("emergency_lighting"),
  v.literal("fire_extinguishers"),
  v.literal("sprinklers"),
  v.literal("fire_doors"),
  v.literal("dry_wet_risers"),
  v.literal("smoke_ventilation"),
  v.literal("gas_suppression"),
  v.literal("fire_risk_assessment"),
  v.literal("intruder_alarm"),
  v.literal("cctv"),
  v.literal("access_control"),
  v.literal("nurse_call"),
  v.literal("other"),
);

export const userRole = v.union(
  v.literal("owner"),
  v.literal("admin"),
  v.literal("office"),
  v.literal("engineer"),
  v.literal("client_user"),
);

const address = v.object({
  line1: v.string(),
  line2: v.optional(v.string()),
  city: v.optional(v.string()),
  region: v.optional(v.string()),
  postcode: v.optional(v.string()),
  country: v.optional(v.string()),
});

const geo = v.object({ lat: v.number(), lng: v.number() });

const contact = v.object({
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  role: v.optional(v.string()),
});

/** Captured signature (engineer, client, or quote acceptor). */
const signature = v.object({
  signedByName: v.string(),
  signedByUserId: v.optional(v.id("users")),
  signedByRole: v.optional(v.string()),
  signatureImageId: v.optional(v.id("_storage")),
  signedAt: v.number(),
  ipAddress: v.optional(v.string()),
  deviceInfo: v.optional(v.string()),
  /** SHA-256 of the signed document/payload for tamper detection. */
  contentHash: v.optional(v.string()),
});

/** Fields used by mobile/offline-capable records. */
const fieldSync = {
  /** UUID created on the device so offline writes can be de-duplicated. */
  clientGeneratedId: v.optional(v.string()),
  /** When the record was captured on device (may be before sync). */
  capturedAt: v.optional(v.number()),
  /** When the record reached the server. */
  syncedAt: v.optional(v.number()),
  deviceId: v.optional(v.string()),
};

const frequency = v.object({
  interval: v.number(),
  unit: v.union(v.literal("day"), v.literal("week"), v.literal("month"), v.literal("year")),
});

const money = v.number(); // minor units (e.g. pence/cents) to avoid float errors

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

export default defineSchema({
  /* ======================= Convex Auth ======================= */
  ...authTables,

  /* ======================= Tenancy & users ======================= */

  organizations: defineTable({
    name: v.string(),
    slug: v.string(),
    legalName: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    vatNumber: v.optional(v.string()),
    /** Accreditations e.g. BAFE SP203, NSI Gold, SSAIB, FIA. */
    accreditations: v.optional(
      v.array(
        v.object({
          body: v.string(),
          scheme: v.optional(v.string()),
          number: v.optional(v.string()),
          expiresAt: v.optional(v.number()),
        }),
      ),
    ),
    address: v.optional(address),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    logoId: v.optional(v.id("_storage")),
    disciplines: v.array(discipline),
    currency: v.string(),
    timezone: v.string(),
    defaultTaxRate: v.optional(v.number()),
    /** Shown on invoices. All optional; sort code stored as 6 digits, account number as 8 digits. */
    bankDetails: v.optional(
      v.object({
        bankName: v.optional(v.string()),
        accountName: v.optional(v.string()),
        sortCode: v.optional(v.string()),
        accountNumber: v.optional(v.string()),
        iban: v.optional(v.string()),
        bic: v.optional(v.string()),
        /** e.g. "Please quote the invoice number as your payment reference." */
        paymentInstructions: v.optional(v.string()),
      }),
    ),
    /** Default terms printed on quotes / invoices when the document has none of its own. */
    quoteTerms: v.optional(v.string()),
    invoiceFooter: v.optional(v.string()),
    plan: v.union(v.literal("trial"), v.literal("starter"), v.literal("pro"), v.literal("enterprise")),
    /** Automated reminder settings; anything missing falls back to defaults in convex/lib/reminderConfig.ts. */
    reminderSettings: v.optional(
      v.object({
        enabled: v.optional(v.boolean()),
        /** Days before a service is due, e.g. [30, 14, 7, 0]. Per-schedule reminderOffsetsDays override this. */
        serviceLeadDays: v.optional(v.array(v.number())),
        certificateLeadDays: v.optional(v.array(v.number())),
        qualificationLeadDays: v.optional(v.array(v.number())),
        /** Days after a quote was sent to chase the client, e.g. [3, 10]. */
        quoteFollowUpDays: v.optional(v.array(v.number())),
        /** Days after a defect was raised to follow up, per severity (0 = never). */
        defectFollowUpDays: v.optional(
          v.object({ critical: v.number(), major: v.number(), minor: v.number(), advisory: v.number() }),
        ),
        /** Repeat overdue reminders every N days (0 = only once). */
        overdueRepeatDays: v.optional(v.number()),
        /** Max overdue repeats. */
        overdueMaxReminders: v.optional(v.number()),
        /** Company inboxes that receive reminders (otherwise org email + owner/admin/office users). */
        officeEmails: v.optional(v.array(v.string())),
        /** Monday-morning summary email for the company. */
        weeklyDigest: v.optional(v.boolean()),
        /** Days overdue at which to chase unpaid invoices, e.g. [1, 7, 14, 30]; [] = never. */
        invoiceOverdueDays: v.optional(v.array(v.number())),
        /** Send invoice chasers to the client as well as the office (default true). */
        invoiceRemindClient: v.optional(v.boolean()),
      }),
    ),
    /** Automatic routine jobs from service schedules (defaults in convex/lib/autoJobs.ts). */
    jobAutomation: v.optional(
      v.object({
        /** Master switch (default on). Schedules also need autoCreateJob = true. */
        enabled: v.optional(v.boolean()),
        /** Create the job this many days before the service is due (default 30). */
        leadDays: v.optional(v.number()),
        /** Email the office a summary when jobs are created (default on). */
        notifyOffice: v.optional(v.boolean()),
      }),
    ),
    status: v.union(v.literal("active"), v.literal("suspended"), v.literal("cancelled")),
    createdAt: v.number(),
  }).index("by_slug", ["slug"]),

  /**
   * Convex Auth users table, extended with app fields.
   * Core fields (name, image, email, phone, emailVerificationTime,
   * phoneVerificationTime, isAnonymous) and the `email` / `phone` indexes
   * are required by @convex-dev/auth.
   */
  users: defineTable({
    ...authTables.users.validator.fields,
    avatarId: v.optional(v.id("_storage")),
    /** Org to open by default after sign-in. */
    defaultOrgId: v.optional(v.id("organizations")),
    lastSeenAt: v.optional(v.number()),
  })
    .index("email", ["email"])
    .index("phone", ["phone"]),

  /** A user's role in an organization. client_user members are scoped to clientId. */
  memberships: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    role: userRole,
    clientId: v.optional(v.id("clients")),
    status: v.union(v.literal("active"), v.literal("invited"), v.literal("disabled")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_user", ["userId"])
    .index("by_org_and_user", ["orgId", "userId"])
    .index("by_org_and_role", ["orgId", "role"])
    .index("by_client", ["clientId"]),

  /** Staff invitations (owner/admin/office/engineer). Raw token is only ever in the invite link. */
  teamInvitations: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    name: v.optional(v.string()),
    role: v.union(v.literal("owner"), v.literal("admin"), v.literal("office"), v.literal("engineer")),
    tokenHash: v.string(),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_org_and_email", ["orgId", "email"]),

  /** Engineer competencies/qualifications per discipline. */
  engineerQualifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    discipline,
    title: v.string(),
    issuer: v.optional(v.string()),
    reference: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    documentId: v.optional(v.id("_storage")),
  })
    .index("by_org_and_user", ["orgId", "userId"])
    .index("by_org_and_expiry", ["orgId", "expiresAt"]),

  /* ======================= Clients & properties ======================= */

  clients: defineTable({
    orgId: v.id("organizations"),
    name: v.string(),
    accountNumber: v.optional(v.string()),
    type: v.union(v.literal("commercial"), v.literal("residential"), v.literal("public_sector"), v.literal("managing_agent")),
    billingAddress: v.optional(address),
    primaryContact: v.optional(contact),
    contacts: v.optional(v.array(contact)),
    /** Emails that should receive due-date reminders. */
    reminderEmails: v.optional(v.array(v.string())),
    externalAccountingId: v.optional(v.string()),
    notes: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["orgId"] }),

  sites: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    name: v.string(),
    reference: v.optional(v.string()),
    address,
    geo: v.optional(geo),
    siteContact: v.optional(contact),
    accessNotes: v.optional(v.string()),
    hazards: v.optional(v.array(v.string())),
    responsiblePerson: v.optional(contact),
    /** Public token used on site-level QR labels (e.g. on the panel/logbook). */
    qrToken: v.optional(v.string()),
    /** Latest printable QR label PDF for the site. */
    labelPdfId: v.optional(v.id("_storage")),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_client", ["clientId"])
    .index("by_qr_token", ["qrToken"])
    .searchIndex("search_name", { searchField: "name", filterFields: ["orgId", "clientId"] }),

  /** Hierarchical locations within a site: building > floor > zone > room. */
  locations: defineTable({
    orgId: v.id("organizations"),
    siteId: v.id("sites"),
    parentId: v.optional(v.id("locations")),
    kind: v.union(v.literal("building"), v.literal("floor"), v.literal("zone"), v.literal("room"), v.literal("area")),
    name: v.string(),
    /** e.g. fire alarm zone number. */
    code: v.optional(v.string()),
    floorPlanId: v.optional(v.id("_storage")),
    sortOrder: v.optional(v.number()),
  })
    .index("by_site", ["siteId"])
    .index("by_parent", ["parentId"]),

  /* ======================= Assets (device register) ======================= */

  /** Catalogue of device types per discipline; orgId null = global/system type. */
  assetTypes: defineTable({
    orgId: v.optional(v.id("organizations")),
    discipline,
    name: v.string(),
    /** Measurements expected for this type, drives field-capture forms. */
    readingDefinitions: v.optional(
      v.array(
        v.object({
          key: v.string(),
          label: v.string(),
          unit: v.optional(v.string()),
          valueType: v.union(v.literal("number"), v.literal("boolean"), v.literal("text")),
          min: v.optional(v.number()),
          max: v.optional(v.number()),
        }),
      ),
    ),
    defaultServiceFrequency: v.optional(frequency),
    expectedLifeYears: v.optional(v.number()),
    checklistTemplateId: v.optional(v.id("checklistTemplates")),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_discipline", ["orgId", "discipline"]),

  assets: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    siteId: v.id("sites"),
    locationId: v.optional(v.id("locations")),
    assetTypeId: v.id("assetTypes"),
    discipline,
    /** Device address/number e.g. "L1-D023". */
    reference: v.string(),
    description: v.optional(v.string()),
    manufacturer: v.optional(v.string()),
    model: v.optional(v.string()),
    serialNumber: v.optional(v.string()),
    /** Parent device, e.g. detector -> panel loop. */
    parentAssetId: v.optional(v.id("assets")),
    installedAt: v.optional(v.number()),
    manufacturedAt: v.optional(v.number()),
    warrantyExpiresAt: v.optional(v.number()),
    replaceBy: v.optional(v.number()),
    status: v.union(
      v.literal("in_service"),
      v.literal("defective"),
      v.literal("out_of_service"),
      v.literal("removed"),
      v.literal("replaced"),
    ),
    lastInspectedAt: v.optional(v.number()),
    lastResult: v.optional(v.union(v.literal("pass"), v.literal("fail"), v.literal("advisory"), v.literal("not_tested"))),
    nextDueAt: v.optional(v.number()),
    /** Public token for the asset's QR/barcode tag. */
    tagCode: v.optional(v.string()),
    /** Latest printable QR label PDF for the asset. */
    labelPdfId: v.optional(v.id("_storage")),
    photoIds: v.optional(v.array(v.id("_storage"))),
    customFields: v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean()))),
    ...fieldSync,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org", ["orgId"])
    .index("by_site", ["siteId"])
    .index("by_site_and_discipline", ["siteId", "discipline"])
    .index("by_location", ["locationId"])
    .index("by_client", ["clientId"])
    .index("by_org_and_next_due", ["orgId", "nextDueAt"])
    .index("by_tag_code", ["tagCode"])
    .index("by_client_generated_id", ["clientGeneratedId"]),

  /* ======================= Inspection templates ======================= */

  checklistTemplates: defineTable({
    orgId: v.optional(v.id("organizations")),
    discipline,
    name: v.string(),
    /** Standard referenced, e.g. "BS 5839-1:2017", "BS 5266-1". */
    standard: v.optional(v.string()),
    version: v.number(),
    scope: v.union(v.literal("system"), v.literal("asset")),
    items: v.array(
      v.object({
        key: v.string(),
        label: v.string(),
        section: v.optional(v.string()),
        responseType: v.union(
          v.literal("pass_fail"),
          v.literal("yes_no_na"),
          v.literal("number"),
          v.literal("text"),
          v.literal("photo"),
          v.literal("signature"),
        ),
        unit: v.optional(v.string()),
        required: v.boolean(),
        guidance: v.optional(v.string()),
      }),
    ),
    isActive: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_discipline", ["orgId", "discipline"]),

  /* ======================= Jobs & field work ======================= */

  jobs: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    siteId: v.id("sites"),
    jobNumber: v.string(),
    type: v.union(
      v.literal("routine_service"),
      v.literal("inspection"),
      v.literal("installation"),
      v.literal("commissioning"),
      v.literal("remedial"),
      v.literal("callout"),
      v.literal("survey"),
    ),
    disciplines: v.array(discipline),
    title: v.string(),
    description: v.optional(v.string()),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("emergency")),
    status: v.union(
      v.literal("draft"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("on_hold"),
      v.literal("completed"),
      v.literal("invoiced"),
      v.literal("cancelled"),
    ),
    scheduleId: v.optional(v.id("serviceSchedules")),
    quoteId: v.optional(v.id("quotes")),
    assignedEngineerIds: v.array(v.id("users")),
    scheduledStart: v.optional(v.number()),
    scheduledEnd: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    purchaseOrderNumber: v.optional(v.string()),
    /** Created by the daily service-schedule automation (createdBy is then the org owner). */
    autoCreated: v.optional(v.boolean()),
    /** The schedule's due date this job services (one auto job per schedule per due cycle). */
    scheduleDueAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_org_and_scheduled", ["orgId", "scheduledStart"])
    .index("by_site", ["siteId"])
    .index("by_client", ["clientId"])
    .index("by_org_and_job_number", ["orgId", "jobNumber"])
    .index("by_schedule", ["scheduleId"])
    .index("by_quote", ["quoteId"]),

  /**
   * One row per (job, assigned engineer). Mirrors jobs.assignedEngineerIds so engineer access
   * checks ("assigned jobs" / "sites of assigned jobs") are index-backed. Kept in sync by
   * lib/auth.syncJobAssignments (jobs.insertJob, jobs.assignEngineers).
   */
  jobAssignments: defineTable({
    orgId: v.id("organizations"),
    userId: v.id("users"),
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
  })
    .index("by_org_and_user", ["orgId", "userId"])
    .index("by_org_and_user_and_site", ["orgId", "userId", "siteId"])
    .index("by_job", ["jobId"]),

  /** An engineer's attendance at site for a job (one job may need several visits). */
  visits: defineTable({
    orgId: v.id("organizations"),
    jobId: v.id("jobs"),
    siteId: v.id("sites"),
    engineerId: v.id("users"),
    status: v.union(v.literal("planned"), v.literal("travelling"), v.literal("on_site"), v.literal("completed"), v.literal("aborted")),
    arrivedAt: v.optional(v.number()),
    departedAt: v.optional(v.number()),
    arrivalGeo: v.optional(geo),
    notes: v.optional(v.string()),
    engineerSignature: v.optional(signature),
    customerSignature: v.optional(signature),
    ...fieldSync,
  })
    .index("by_job", ["jobId"])
    .index("by_site", ["siteId"])
    .index("by_engineer_and_status", ["engineerId", "status"])
    .index("by_client_generated_id", ["clientGeneratedId"]),

  /** Completed checklist (system-level or per asset) during a visit. */
  inspections: defineTable({
    orgId: v.id("organizations"),
    siteId: v.id("sites"),
    jobId: v.optional(v.id("jobs")),
    visitId: v.optional(v.id("visits")),
    assetId: v.optional(v.id("assets")),
    templateId: v.optional(v.id("checklistTemplates")),
    templateVersion: v.optional(v.number()),
    discipline,
    engineerId: v.id("users"),
    responses: v.array(
      v.object({
        itemKey: v.string(),
        value: v.optional(v.union(v.string(), v.number(), v.boolean(), v.null())),
        result: v.optional(v.union(v.literal("pass"), v.literal("fail"), v.literal("na"))),
        comment: v.optional(v.string()),
        photoIds: v.optional(v.array(v.id("_storage"))),
      }),
    ),
    overallResult: v.union(v.literal("pass"), v.literal("fail"), v.literal("advisory"), v.literal("not_tested")),
    performedAt: v.number(),
    ...fieldSync,
  })
    .index("by_site", ["siteId"])
    .index("by_asset", ["assetId"])
    .index("by_visit", ["visitId"])
    .index("by_job", ["jobId"])
    .index("by_client_generated_id", ["clientGeneratedId"]),

  /** Time-series metrics: battery voltage, lux, pressure, dB, duration, weight... */
  readings: defineTable({
    orgId: v.id("organizations"),
    siteId: v.id("sites"),
    assetId: v.id("assets"),
    inspectionId: v.optional(v.id("inspections")),
    visitId: v.optional(v.id("visits")),
    key: v.string(),
    label: v.optional(v.string()),
    value: v.union(v.number(), v.boolean(), v.string()),
    unit: v.optional(v.string()),
    withinTolerance: v.optional(v.boolean()),
    source: v.union(v.literal("manual"), v.literal("device"), v.literal("integration")),
    recordedBy: v.optional(v.id("users")),
    recordedAt: v.number(),
    ...fieldSync,
  })
    .index("by_asset_and_key", ["assetId", "key", "recordedAt"])
    .index("by_client_generated_id", ["clientGeneratedId"])
    .index("by_inspection", ["inspectionId"])
    .index("by_site", ["siteId"]),

  defects: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    siteId: v.id("sites"),
    assetId: v.optional(v.id("assets")),
    locationId: v.optional(v.id("locations")),
    inspectionId: v.optional(v.id("inspections")),
    visitId: v.optional(v.id("visits")),
    discipline,
    reference: v.string(),
    title: v.string(),
    description: v.optional(v.string()),
    /** Critical = system non-compliant / immediate risk to life. */
    severity: v.union(v.literal("critical"), v.literal("major"), v.literal("minor"), v.literal("advisory")),
    status: v.union(
      v.literal("open"),
      v.literal("quoted"),
      v.literal("scheduled"),
      v.literal("in_progress"),
      v.literal("resolved"),
      v.literal("verified"),
      v.literal("closed_no_action"),
    ),
    recommendedAction: v.optional(v.string()),
    photoIds: v.optional(v.array(v.id("_storage"))),
    raisedBy: v.id("users"),
    raisedAt: v.number(),
    targetResolutionAt: v.optional(v.number()),
    quoteId: v.optional(v.id("quotes")),
    remedialJobId: v.optional(v.id("jobs")),
    resolvedAt: v.optional(v.number()),
    resolvedBy: v.optional(v.id("users")),
    resolutionNotes: v.optional(v.string()),
    visibleToClient: v.boolean(),
    ...fieldSync,
  })
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_site_and_status", ["siteId", "status"])
    .index("by_client_and_status", ["clientId", "status"])
    .index("by_asset", ["assetId"])
    .index("by_org_and_severity", ["orgId", "severity"])
    .index("by_org", ["orgId"])
    .index("by_client_generated_id", ["clientGeneratedId"]),

  /** Generic file attachments (photos, PDFs, drawings) linked to any record. */
  attachments: defineTable({
    orgId: v.id("organizations"),
    storageId: v.id("_storage"),
    fileName: v.string(),
    mimeType: v.string(),
    sizeBytes: v.optional(v.number()),
    kind: v.union(v.literal("photo"), v.literal("document"), v.literal("drawing"), v.literal("signature"), v.literal("other")),
    entityType: v.union(
      v.literal("site"),
      v.literal("asset"),
      v.literal("job"),
      v.literal("visit"),
      v.literal("inspection"),
      v.literal("defect"),
      v.literal("certificate"),
      v.literal("quote"),
    ),
    entityId: v.string(),
    caption: v.optional(v.string()),
    geo: v.optional(geo),
    visibleToClient: v.boolean(),
    uploadedBy: v.id("users"),
    ...fieldSync,
    createdAt: v.number(),
  })
    .index("by_entity", ["entityType", "entityId"])
    .index("by_org", ["orgId"])
    .index("by_client_generated_id", ["clientGeneratedId"]),

  /* ======================= Certificates & verification ======================= */

  certificateTypes: defineTable({
    orgId: v.optional(v.id("organizations")),
    discipline,
    /** e.g. "BS 5839-1 Inspection & Servicing Certificate", "BS 5266 Periodic". */
    name: v.string(),
    code: v.string(),
    standard: v.optional(v.string()),
    /** Prefix for numbering, e.g. "FA-" -> FA-000123. */
    numberPrefix: v.string(),
    validityMonths: v.optional(v.number()),
    requiresClientSignature: v.boolean(),
    templateKey: v.optional(v.string()),
    isActive: v.boolean(),
  })
    .index("by_org", ["orgId"])
    .index("by_org_and_discipline", ["orgId", "discipline"]),

  /** Per-org, per-sequence counters for certificate/quote/job/invoice numbers. */
  numberSequences: defineTable({
    orgId: v.id("organizations"),
    key: v.string(),
    next: v.number(),
  }).index("by_org_and_key", ["orgId", "key"]),

  certificates: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    siteId: v.id("sites"),
    certificateTypeId: v.id("certificateTypes"),
    discipline,
    certificateNumber: v.string(),
    jobId: v.optional(v.id("jobs")),
    visitId: v.optional(v.id("visits")),
    /** Snapshot of assets/inspections/defects the certificate covers. */
    assetIds: v.array(v.id("assets")),
    inspectionIds: v.array(v.id("inspections")),
    defectIds: v.array(v.id("defects")),
    overallResult: v.union(v.literal("satisfactory"), v.literal("unsatisfactory"), v.literal("satisfactory_with_observations")),
    summary: v.optional(v.string()),
    /** Structured certificate content used to render the PDF. */
    data: v.optional(v.any()),
    status: v.union(
      v.literal("draft"),
      v.literal("pending_signature"),
      v.literal("issued"),
      v.literal("superseded"),
      v.literal("revoked"),
    ),
    issuedAt: v.optional(v.number()),
    issuedBy: v.optional(v.id("users")),
    inspectionDate: v.number(),
    expiresAt: v.optional(v.number()),
    nextInspectionDueAt: v.optional(v.number()),
    pdfStorageId: v.optional(v.id("_storage")),
    /** SHA-256 of the issued PDF; shown on the verify page to detect tampering. */
    pdfHash: v.optional(v.string()),
    pdfStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    pdfGeneratedAt: v.optional(v.number()),
    pdfError: v.optional(v.string()),
    /** 0 for the original; incremented on each reissue. */
    revision: v.optional(v.number()),
    revokedAt: v.optional(v.number()),
    engineerSignature: v.optional(signature),
    clientSignature: v.optional(signature),
    /** Random unguessable public token encoded in the QR label. */
    verificationToken: v.string(),
    supersedesId: v.optional(v.id("certificates")),
    supersededById: v.optional(v.id("certificates")),
    revokedReason: v.optional(v.string()),
    /** Engineer qualification checks made when signing / issuing, incl. any owner/admin override. */
    qualificationChecks: v.optional(
      v.array(
        v.object({
          stage: v.union(v.literal("sign"), v.literal("issue")),
          engineerUserId: v.id("users"),
          engineerName: v.string(),
          discipline,
          qualified: v.boolean(),
          qualificationIds: v.array(v.id("engineerQualifications")),
          detail: v.string(),
          /** signedAt of the engineer signature the check was made for. */
          signatureSignedAt: v.optional(v.number()),
          override: v.optional(v.object({ byUserId: v.id("users"), byName: v.string(), reason: v.string(), at: v.number() })),
          at: v.number(),
        }),
      ),
    ),
    ...fieldSync,
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_verification_token", ["verificationToken"])
    .index("by_org_and_number", ["orgId", "certificateNumber"])
    .index("by_org", ["orgId"])
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_site", ["siteId"])
    .index("by_client", ["clientId"])
    .index("by_job", ["jobId"])
    .index("by_org_and_expiry", ["orgId", "expiresAt"]),

  /** Log of public QR scans / verification look-ups. */
  verificationScans: defineTable({
    kind: v.optional(v.union(v.literal("certificate"), v.literal("asset"), v.literal("site"))),
    certificateId: v.optional(v.id("certificates")),
    token: v.string(),
    found: v.boolean(),
    scannedAt: v.number(),
    userAgent: v.optional(v.string()),
    ipHash: v.optional(v.string()),
  }).index("by_certificate", ["certificateId"]),

  /* ======================= Schedules & reminders ======================= */

  /** Recurring service obligation for a site + discipline (or a single asset). */
  serviceSchedules: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    siteId: v.id("sites"),
    assetId: v.optional(v.id("assets")),
    discipline,
    name: v.string(),
    frequency,
    lastCompletedAt: v.optional(v.number()),
    nextDueAt: v.number(),
    /** Days before due to send reminders, e.g. [30, 14, 7, 0]. */
    reminderOffsetsDays: v.array(v.number()),
    notifyClient: v.boolean(),
    notifyOrg: v.boolean(),
    autoCreateJob: v.boolean(),
    /** Per-schedule override of organizations.jobAutomation.leadDays. */
    autoJobLeadDays: v.optional(v.number()),
    /** Engineer assigned to automatically created jobs. */
    defaultEngineerId: v.optional(v.id("users")),
    contractReference: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("paused"), v.literal("ended")),
    createdAt: v.number(),
  })
    .index("by_org_and_next_due", ["orgId", "nextDueAt"])
    .index("by_status_and_next_due", ["status", "nextDueAt"])
    .index("by_site", ["siteId"])
    .index("by_client", ["clientId"]),

  /**
   * Individual reminder occurrences, created by the daily planner cron and sent by the dispatcher.
   * `dedupeKey` (source:id:dueAt:stage) guarantees the same reminder is never created twice.
   */
  reminders: defineTable({
    orgId: v.id("organizations"),
    clientId: v.optional(v.id("clients")),
    siteId: v.optional(v.id("sites")),
    sourceType: v.union(
      v.literal("service_schedule"),
      v.literal("certificate_expiry"),
      v.literal("defect_followup"),
      v.literal("quote_followup"),
      v.literal("qualification_expiry"),
      v.literal("invoice_overdue"),
      v.literal("jobs_auto_created"),
      v.literal("custom"),
    ),
    scheduleId: v.optional(v.id("serviceSchedules")),
    invoiceId: v.optional(v.id("invoices")),
    /** Jobs listed in a "jobs_auto_created" office summary. */
    jobIds: v.optional(v.array(v.id("jobs"))),
    certificateId: v.optional(v.id("certificates")),
    defectId: v.optional(v.id("defects")),
    quoteId: v.optional(v.id("quotes")),
    qualificationId: v.optional(v.id("engineerQualifications")),
    dedupeKey: v.string(),
    /** Reminder stage, e.g. "d30", "d14", "d7", "d0", "od1" (1st overdue reminder), "f3" (follow-up day 3). */
    stage: v.string(),
    /** Short human title for staff lists, e.g. "Service due · Albion House · Fire Detection & Alarm". */
    title: v.optional(v.string()),
    dueAt: v.number(),
    sendAt: v.number(),
    audience: v.union(v.literal("org"), v.literal("client"), v.literal("both")),
    status: v.union(
      v.literal("pending"),
      v.literal("dispatched"),
      v.literal("no_recipients"),
      v.literal("dismissed"),
      v.literal("cancelled"),
    ),
    dispatchedAt: v.optional(v.number()),
    snoozedUntil: v.optional(v.number()),
    dismissedBy: v.optional(v.id("users")),
    cancelReason: v.optional(v.string()),
    message: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_status_and_send_at", ["status", "sendAt"])
    .index("by_org_and_status_and_send_at", ["orgId", "status", "sendAt"])
    .index("by_org_and_due", ["orgId", "dueAt"])
    .index("by_dedupe_key", ["dedupeKey"])
    .index("by_schedule", ["scheduleId"])
    .index("by_client", ["clientId"]),

  /** Every notification delivered or attempted (email/SMS/push/in-app). */
  notifications: defineTable({
    orgId: v.id("organizations"),
    userId: v.optional(v.id("users")),
    clientId: v.optional(v.id("clients")),
    recipientType: v.optional(v.union(v.literal("org"), v.literal("client"))),
    recipientEmail: v.optional(v.string()),
    recipientPhone: v.optional(v.string()),
    channel: v.union(v.literal("email"), v.literal("sms"), v.literal("push"), v.literal("in_app")),
    reminderId: v.optional(v.id("reminders")),
    type: v.string(),
    /** Subject line for email. */
    title: v.string(),
    /** Plain-text body. */
    body: v.optional(v.string()),
    html: v.optional(v.string()),
    link: v.optional(v.string()),
    status: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("delivered"),
      v.literal("failed"),
      v.literal("read"),
      /** Dry run: no RESEND_API_KEY / EMAIL_FROM configured; rendered content kept for review. */
      v.literal("skipped_no_provider"),
      /** Recipient unsubscribed. */
      v.literal("skipped_opt_out"),
    ),
    attempts: v.optional(v.number()),
    nextAttemptAt: v.optional(v.number()),
    unsubscribeToken: v.optional(v.string()),
    isTest: v.optional(v.boolean()),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    createdAt: v.number(),
    readAt: v.optional(v.number()),
  })
    .index("by_user_and_status", ["userId", "status"])
    .index("by_org_and_created", ["orgId", "createdAt"])
    .index("by_reminder", ["reminderId"])
    .index("by_unsubscribe_token", ["unsubscribeToken"]),

  /** Email addresses that have unsubscribed (per organization) or bounced. */
  emailSuppressions: defineTable({
    orgId: v.id("organizations"),
    email: v.string(),
    clientId: v.optional(v.id("clients")),
    reason: v.union(v.literal("unsubscribed"), v.literal("bounced"), v.literal("complained"), v.literal("manual")),
    createdAt: v.number(),
  }).index("by_org_and_email", ["orgId", "email"]),

  /* ======================= Client portal ======================= */

  portalInvitations: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    email: v.string(),
    name: v.optional(v.string()),
    /** Hashed invite token; never store the raw token. */
    tokenHash: v.string(),
    /** Limit access to specific sites; empty/absent = all client sites. */
    siteIds: v.optional(v.array(v.id("sites"))),
    status: v.union(v.literal("pending"), v.literal("accepted"), v.literal("revoked"), v.literal("expired")),
    invitedBy: v.id("users"),
    expiresAt: v.number(),
    acceptedAt: v.optional(v.number()),
    acceptedUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_token_hash", ["tokenHash"])
    .index("by_client", ["clientId"])
    .index("by_org_and_email", ["orgId", "email"])
    .index("by_org_and_status", ["orgId", "status"]),

  /** Read-only portal access grants for client users (unlimited per client). */
  portalAccess: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    userId: v.id("users"),
    siteIds: v.optional(v.array(v.id("sites"))),
    canAcceptQuotes: v.boolean(),
    status: v.union(v.literal("active"), v.literal("revoked")),
    lastAccessAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_client", ["clientId"])
    .index("by_user_and_client", ["userId", "clientId"]),

  /* ======================= Quotes & finance ======================= */

  quotes: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    siteId: v.optional(v.id("sites")),
    quoteNumber: v.string(),
    revision: v.number(),
    title: v.string(),
    introduction: v.optional(v.string()),
    terms: v.optional(v.string()),
    defectIds: v.optional(v.array(v.id("defects"))),
    currency: v.string(),
    subtotal: money,
    discountTotal: money,
    taxTotal: money,
    total: money,
    status: v.union(
      v.literal("draft"),
      v.literal("sent"),
      v.literal("viewed"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
      v.literal("superseded"),
    ),
    validUntil: v.optional(v.number()),
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    /** Public token for the client acceptance link. */
    acceptanceToken: v.optional(v.string()),
    acceptance: v.optional(
      v.object({
        decision: v.union(v.literal("accepted"), v.literal("declined")),
        decidedAt: v.number(),
        signature: v.optional(signature),
        purchaseOrderNumber: v.optional(v.string()),
        declineReason: v.optional(v.string()),
        acceptedByUserId: v.optional(v.id("users")),
      }),
    ),
    pdfStorageId: v.optional(v.id("_storage")),
    pdfHash: v.optional(v.string()),
    pdfStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    pdfGeneratedAt: v.optional(v.number()),
    pdfError: v.optional(v.string()),
    jobId: v.optional(v.id("jobs")),
    previousRevisionId: v.optional(v.id("quotes")),
    externalAccountingId: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_client", ["clientId"])
    .index("by_site", ["siteId"])
    .index("by_org_and_number", ["orgId", "quoteNumber"])
    .index("by_org", ["orgId"])
    .index("by_acceptance_token", ["acceptanceToken"])
    .index("by_status_and_valid_until", ["status", "validUntil"]),

  quoteLineItems: defineTable({
    orgId: v.id("organizations"),
    quoteId: v.id("quotes"),
    sortOrder: v.number(),
    kind: v.union(v.literal("labour"), v.literal("material"), v.literal("equipment"), v.literal("service"), v.literal("other")),
    description: v.string(),
    productCode: v.optional(v.string()),
    quantity: v.number(),
    unitPrice: money,
    discountPercent: v.optional(v.number()),
    taxRate: v.number(),
    lineTotal: money,
    defectId: v.optional(v.id("defects")),
    /** Optional lines the client can opt in/out of on acceptance. */
    optional: v.boolean(),
    selected: v.boolean(),
  }).index("by_quote", ["quoteId", "sortOrder"]),

  /** In-app invoices (source of truth). External accounting IDs are optional for a future Xero/QuickBooks/Sage sync. */
  invoices: defineTable({
    orgId: v.id("organizations"),
    clientId: v.id("clients"),
    jobId: v.optional(v.id("jobs")),
    quoteId: v.optional(v.id("quotes")),
    invoiceNumber: v.string(),
    currency: v.string(),
    subtotal: money,
    taxTotal: money,
    total: money,
    amountPaid: money,
    status: v.union(v.literal("draft"), v.literal("sent"), v.literal("partially_paid"), v.literal("paid"), v.literal("overdue"), v.literal("void")),
    issuedAt: v.optional(v.number()),
    dueAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    pdfStorageId: v.optional(v.id("_storage")),
    pdfHash: v.optional(v.string()),
    pdfStatus: v.optional(v.union(v.literal("pending"), v.literal("ready"), v.literal("failed"))),
    pdfGeneratedAt: v.optional(v.number()),
    pdfError: v.optional(v.string()),
    /** Unguessable token for the emailed PDF download link (set when first sent). */
    pdfToken: v.optional(v.string()),
    siteId: v.optional(v.id("sites")),
    sentAt: v.optional(v.number()),
    paymentTermsDays: v.optional(v.number()),
    notes: v.optional(v.string()),
    discountTotal: v.optional(money),
    lines: v.optional(
      v.array(v.object({ description: v.string(), quantity: v.number(), unitPrice: money, discountPercent: v.optional(v.number()), taxRate: v.number(), lineTotal: money })),
    ),
    /** In-app payment records (no accounting software required). */
    payments: v.optional(
      v.array(
        v.object({
          amount: money,
          paidAt: v.number(),
          method: v.union(v.literal("bank_transfer"), v.literal("card"), v.literal("cash"), v.literal("cheque"), v.literal("other")),
          reference: v.optional(v.string()),
          recordedBy: v.optional(v.id("users")),
        }),
      ),
    ),
    voidReason: v.optional(v.string()),
    /** Set by the daily job when a sent / part-paid invoice passes its due date; cleared when paid or voided. */
    overdueSince: v.optional(v.number()),
    externalProvider: v.optional(v.union(v.literal("xero"), v.literal("quickbooks"), v.literal("sage"), v.literal("other"))),
    externalId: v.optional(v.string()),
    lastSyncedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_org_and_status", ["orgId", "status"])
    .index("by_client", ["clientId"])
    .index("by_job", ["jobId"])
    .index("by_org_and_number", ["orgId", "invoiceNumber"])
    .index("by_org", ["orgId"])
    .index("by_org_and_due", ["orgId", "dueAt"])
    .index("by_external_id", ["externalProvider", "externalId"])
    .index("by_quote", ["quoteId"])
    .index("by_pdf_token", ["pdfToken"]),

  /** Accounting integration connection per org (tokens kept in env/secret store, not here). */
  accountingIntegrations: defineTable({
    orgId: v.id("organizations"),
    provider: v.union(v.literal("xero"), v.literal("quickbooks"), v.literal("sage"), v.literal("other")),
    tenantId: v.optional(v.string()),
    status: v.union(v.literal("connected"), v.literal("disconnected"), v.literal("error")),
    lastSyncAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_org", ["orgId"]),

  /* ======================= Audit ======================= */

  auditLog: defineTable({
    orgId: v.id("organizations"),
    actorUserId: v.optional(v.id("users")),
    action: v.string(),
    entityType: v.string(),
    entityId: v.string(),
    changes: v.optional(v.any()),
    at: v.number(),
    deviceId: v.optional(v.string()),
  })
    .index("by_org_and_at", ["orgId", "at"])
    .index("by_entity", ["entityType", "entityId"]),
});
