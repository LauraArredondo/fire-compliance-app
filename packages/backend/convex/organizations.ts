import { v, ConvexError } from "convex/values";
import { JOB_AUTOMATION_DEFAULTS, jobAutomationFor } from "./lib/autoJobs";
import { mutation, query } from "./_generated/server";
import { requireUser, requireMember } from "./lib/auth";
import { DEFAULTS, settingsFor } from "./lib/reminderConfig";
import { audit, fail, str, optStr, email as cleanEmail, cleanAddress, addressV, num, requireFile, defined, MANAGERS, ANY } from "./lib/util";
import { discipline } from "./schema";

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48) || "org";
}

/** First-time onboarding: the signed-in user creates their company and becomes its owner. */
export const createWithOwner = mutation({
  args: {
    name: v.string(),
    disciplines: v.array(discipline),
    currency: v.optional(v.string()),
    timezone: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const name = args.name.trim();
    if (name.length < 2) throw new Error("Company name is too short");

    // Unique slug
    const base = slugify(name);
    let slug = base;
    for (let i = 2; ; i++) {
      const clash = await ctx.db.query("organizations").withIndex("by_slug", (q) => q.eq("slug", slug)).first();
      if (!clash) break;
      slug = `${base}-${i}`;
    }

    const now = Date.now();
    const orgId = await ctx.db.insert("organizations", {
      name,
      slug,
      disciplines: args.disciplines,
      currency: args.currency ?? "GBP",
      timezone: args.timezone ?? "Europe/London",
      email: args.email ?? user.email,
      phone: args.phone,
      plan: "trial",
      status: "active",
      createdAt: now,
    });
    await ctx.db.insert("memberships", {
      orgId,
      userId: user._id,
      role: "owner",
      status: "active",
      createdAt: now,
    });
    if (!user.defaultOrgId) await ctx.db.patch(user._id, { defaultOrgId: orgId });
    await ctx.db.insert("auditLog", {
      orgId,
      actorUserId: user._id,
      action: "organization.created",
      entityType: "organization",
      entityId: orgId,
      at: now,
    });
    return { orgId, slug };
  },
});

const days = (a: number[] | undefined, max: number, field: string) => {
  if (a === undefined) return undefined;
  if (a.length > 6 || a.some((d) => !Number.isInteger(d) || d < 0 || d > max)) throw new Error(`${field}: up to 6 whole numbers between 0 and ${max}`);
  return [...new Set(a)].sort((x, y) => y - x);
};

/** Effective reminder settings (defaults merged). */
export const getReminderSettings = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, ["owner", "admin", "office"]);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organisation not found");
    return { settings: settingsFor(org), defaults: DEFAULTS };
  },
});

/** Owner/admin: change reminder lead times, recipients and digest. Omitted fields are unchanged. */
export const updateReminderSettings = mutation({
  args: {
    orgId: v.id("organizations"),
    enabled: v.optional(v.boolean()),
    serviceLeadDays: v.optional(v.array(v.number())),
    certificateLeadDays: v.optional(v.array(v.number())),
    qualificationLeadDays: v.optional(v.array(v.number())),
    quoteFollowUpDays: v.optional(v.array(v.number())),
    defectFollowUpDays: v.optional(v.object({ critical: v.number(), major: v.number(), minor: v.number(), advisory: v.number() })),
    overdueRepeatDays: v.optional(v.number()),
    overdueMaxReminders: v.optional(v.number()),
    officeEmails: v.optional(v.array(v.string())),
    weeklyDigest: v.optional(v.boolean()),
    /** Overdue-invoice reminder stages in days after due (1-365). [] = no overdue-invoice reminders. */
    invoiceOverdueDays: v.optional(v.array(v.number())),
    invoiceRemindClient: v.optional(v.boolean()),
  },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, ["owner", "admin"]);
    if (a.invoiceOverdueDays?.some((d) => !Number.isInteger(d) || d < 1 || d > 365)) throw new Error("invoiceOverdueDays must be whole days 1-365");
    if (a.invoiceOverdueDays && a.invoiceOverdueDays.length > 10) throw new Error("At most 10 invoiceOverdueDays");
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organisation not found");
    const emails = a.officeEmails?.map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (emails?.some((e) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e))) throw new Error("Invalid office email address");
    if (a.overdueRepeatDays !== undefined && (a.overdueRepeatDays < 0 || a.overdueRepeatDays > 90)) throw new Error("overdueRepeatDays 0-90");
    if (a.overdueMaxReminders !== undefined && (a.overdueMaxReminders < 0 || a.overdueMaxReminders > 12)) throw new Error("overdueMaxReminders 0-12");
    const patch = Object.fromEntries(
      Object.entries({
        enabled: a.enabled,
        serviceLeadDays: days(a.serviceLeadDays, 365, "serviceLeadDays"),
        certificateLeadDays: days(a.certificateLeadDays, 365, "certificateLeadDays"),
        qualificationLeadDays: days(a.qualificationLeadDays, 365, "qualificationLeadDays"),
        quoteFollowUpDays: days(a.quoteFollowUpDays, 90, "quoteFollowUpDays")?.reverse(),
        defectFollowUpDays: a.defectFollowUpDays,
        overdueRepeatDays: a.overdueRepeatDays,
        overdueMaxReminders: a.overdueMaxReminders,
        officeEmails: emails ? [...new Set(emails)] : undefined,
        weeklyDigest: a.weeklyDigest,
        invoiceOverdueDays: a.invoiceOverdueDays && [...new Set(a.invoiceOverdueDays)].sort((x, y) => x - y),
        invoiceRemindClient: a.invoiceRemindClient,
      }).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(orgId, { reminderSettings: { ...(org.reminderSettings ?? {}), ...patch } });
    await ctx.db.insert("auditLog", { orgId, actorUserId: user._id, action: "org.reminder_settings_updated", entityType: "organization", entityId: orgId, changes: patch, at: Date.now() });
    return settingsFor((await ctx.db.get(orgId))!);
  },
});

/* ---------------- job automation ---------------- */

/** Office: automatic routine-job settings (defaults applied). */
export const getJobAutomationSettings = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, ["owner", "admin", "office"]);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organisation not found");
    return { settings: jobAutomationFor(org), defaults: JOB_AUTOMATION_DEFAULTS };
  },
});

/** Office: turn automatic routine jobs on/off, change the lead window (0-365 days) or the office summary email. */
export const updateJobAutomationSettings = mutation({
  args: { orgId: v.id("organizations"), enabled: v.optional(v.boolean()), leadDays: v.optional(v.number()), notifyOffice: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, ["owner", "admin", "office"]);
    const org = await ctx.db.get(orgId);
    if (!org) throw new Error("Organisation not found");
    if (a.leadDays !== undefined && (!Number.isInteger(a.leadDays) || a.leadDays < 0 || a.leadDays > 365)) throw new ConvexError("Lead time must be a whole number of days between 0 and 365");
    const patch = Object.fromEntries(Object.entries(a).filter(([, x]) => x !== undefined));
    await ctx.db.patch(orgId, { jobAutomation: { ...(org.jobAutomation ?? {}), ...patch } });
    await ctx.db.insert("auditLog", { orgId, actorUserId: user._id, action: "org.job_automation_updated", entityType: "organization", entityId: orgId, changes: patch, at: Date.now() });
    return jobAutomationFor((await ctx.db.get(orgId))!);
  },
});

/* ---------------- profile & branding ---------------- */

/** Company profile (any member, incl. client portal users: name/logo/contact only). */
export const get = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    const org = await ctx.db.get(orgId);
    if (!org) fail("Organisation not found");
    const logoUrl = org.logoId ? await ctx.storage.getUrl(org.logoId) : null;
    const publicPart = { _id: org._id, name: org.name, email: org.email ?? null, phone: org.phone ?? null, address: org.address ?? null, accreditations: org.accreditations ?? [], logoUrl };
    if (membership.role === "client_user") return publicPart;
    const { reminderSettings, ...rest } = org;
    return { ...rest, logoUrl, role: membership.role };
  },
});

const accreditationV = v.object({ body: v.string(), scheme: v.optional(v.string()), number: v.optional(v.string()), expiresAt: v.optional(v.number()) });

/** Owner/admin: edit the company profile shown on certificates, quotes, invoices and emails. */
export const updateProfile = mutation({
  args: {
    orgId: v.id("organizations"),
    name: v.optional(v.string()),
    legalName: v.optional(v.string()),
    registrationNumber: v.optional(v.string()),
    vatNumber: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(addressV),
    accreditations: v.optional(v.array(accreditationV)),
    disciplines: v.optional(v.array(discipline)),
    defaultTaxRate: v.optional(v.number()),
    timezone: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, MANAGERS);
    if (a.timezone) {
      try { new Intl.DateTimeFormat("en-GB", { timeZone: a.timezone }); } catch { fail("Unknown time zone"); }
    }
    if (a.accreditations && a.accreditations.length > 20) fail("At most 20 accreditations");
    if (a.disciplines && !a.disciplines.length) fail("Choose at least one discipline");
    const patch = defined({
      name: a.name === undefined ? undefined : str(a.name, "Company name", 120),
      legalName: optStr(a.legalName, "Legal name", 160),
      registrationNumber: optStr(a.registrationNumber, "Company number", 20),
      vatNumber: optStr(a.vatNumber, "VAT number", 20)?.toUpperCase().replace(/\s+/g, ""),
      email: a.email === undefined ? undefined : cleanEmail(a.email),
      phone: optStr(a.phone, "Phone", 30),
      address: a.address && cleanAddress(a.address),
      accreditations: a.accreditations?.map((x) => defined({ body: str(x.body, "Accreditation body", 60), scheme: optStr(x.scheme, "Scheme", 60), number: optStr(x.number, "Number", 40), expiresAt: x.expiresAt })) as any,
      disciplines: a.disciplines && [...new Set(a.disciplines)],
      defaultTaxRate: a.defaultTaxRate === undefined ? undefined : num(a.defaultTaxRate, "Default VAT rate", 0, 100),
      timezone: a.timezone,
    });
    if (!Object.keys(patch).length) return;
    await ctx.db.patch(orgId, patch);
    await audit(ctx, orgId, user._id, "org.profile_updated", "organization", orgId, patch);
  },
});

/** Owner/admin: get a URL to upload the logo to (POST the file, then call setLogo with the storageId). */
export const generateLogoUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, MANAGERS);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Owner/admin: use an uploaded image (PNG/JPEG/WebP, max 2 MB) as the company logo. */
export const setLogo = mutation({
  args: { orgId: v.id("organizations"), storageId: v.id("_storage") },
  handler: async (ctx, { orgId, storageId }) => {
    const { user } = await requireMember(ctx, orgId, MANAGERS);
    await requireFile(ctx, storageId, { types: /^image\/(png|jpeg|webp)$/, maxBytes: 2 * 1024 * 1024, label: "Logo" });
    const org = (await ctx.db.get(orgId))!;
    if (org.logoId && org.logoId !== storageId) await ctx.storage.delete(org.logoId);
    await ctx.db.patch(orgId, { logoId: storageId });
    await audit(ctx, orgId, user._id, "org.logo_set", "organization", orgId);
    return { logoUrl: await ctx.storage.getUrl(storageId) };
  },
});

export const removeLogo = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const { user } = await requireMember(ctx, orgId, MANAGERS);
    const org = (await ctx.db.get(orgId))!;
    if (org.logoId) await ctx.storage.delete(org.logoId);
    await ctx.db.patch(orgId, { logoId: undefined });
    await audit(ctx, orgId, user._id, "org.logo_removed", "organization", orgId);
  },
});

/**
 * Invoice/quote settings (owner/admin): bank details printed on invoices, default quote terms, invoice footer.
 * Pass `bankDetails: null` to clear. UK sort code = 6 digits, account number = 8 digits.
 */
export const updateBillingSettings = mutation({
  args: {
    orgId: v.id("organizations"),
    bankDetails: v.optional(
      v.union(
        v.null(),
        v.object({
          bankName: v.optional(v.string()), accountName: v.optional(v.string()), sortCode: v.optional(v.string()), accountNumber: v.optional(v.string()),
          iban: v.optional(v.string()), bic: v.optional(v.string()), paymentInstructions: v.optional(v.string()),
        }),
      ),
    ),
    quoteTerms: v.optional(v.string()),
    invoiceFooter: v.optional(v.string()),
  },
  handler: async (ctx, { orgId, bankDetails, quoteTerms, invoiceFooter }) => {
    const { user } = await requireMember(ctx, orgId, MANAGERS);
    const patch: Record<string, unknown> = defined({ quoteTerms: optStr(quoteTerms, "Quote terms", 10000), invoiceFooter: optStr(invoiceFooter, "Invoice footer", 2000) });
    if (bankDetails === null) patch.bankDetails = undefined;
    else if (bankDetails) {
      const digits = (s: string | undefined) => (s === undefined ? undefined : s.replace(/[\s-]/g, ""));
      const sortCode = digits(bankDetails.sortCode);
      if (sortCode !== undefined && sortCode !== "" && !/^\d{6}$/.test(sortCode)) fail("Sort code must be 6 digits, e.g. 12-34-56");
      const accountNumber = digits(bankDetails.accountNumber);
      if (accountNumber !== undefined && accountNumber !== "" && !/^\d{8}$/.test(accountNumber)) fail("UK account number must be 8 digits");
      const iban = digits(bankDetails.iban)?.toUpperCase();
      if (iban && !/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) fail("IBAN doesn't look valid");
      const bic = digits(bankDetails.bic)?.toUpperCase();
      if (bic && !/^[A-Z]{6}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(bic)) fail("BIC/SWIFT code doesn't look valid");
      patch.bankDetails = defined({
        bankName: optStr(bankDetails.bankName, "Bank name", 80), accountName: optStr(bankDetails.accountName, "Account name", 120),
        sortCode: sortCode || undefined, accountNumber: accountNumber || undefined, iban: iban || undefined, bic: bic || undefined,
        paymentInstructions: optStr(bankDetails.paymentInstructions, "Payment instructions", 1000),
      });
    }
    if (!Object.keys(patch).length) return;
    await ctx.db.patch(orgId, patch);
    await audit(ctx, orgId, user._id, "org.billing_updated", "organization", orgId, { fields: Object.keys(patch) });
  },
});
