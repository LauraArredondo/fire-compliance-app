import { v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember } from "./lib/auth";
import { autoCreateJobsForOrg } from "./lib/autoJobs";
import { flagOverdueInvoices, invoiceOverdueStage } from "./lib/overdueInvoices";
import { formatMoney } from "./lib/money";
import { invoicePdfUrl } from "./lib/docPdf";
import { newPublicToken } from "./lib/tokens";
import { certificateVerifyUrl } from "./lib/verification";
import { disciplineLabel, formatDate } from "./lib/labels";
import { renderEmail, EmailInput, EmailTone, orgBlock } from "./lib/emailTemplates";
import {
  DAY,
  settingsFor,
  leadStage,
  followUpStage,
  describeDue,
  daysUntil,
  londonHour,
  londonWeekday,
  londonDateKey,
  londonMorning,
  SEND_HOUR_LONDON,
} from "./lib/reminderConfig";

const STAFF = ["owner", "admin", "office", "engineer"] as const;
const OFFICE = ["owner", "admin", "office"] as const;
const OPEN_DEFECT = ["open", "quoted", "scheduled", "in_progress"] as const;
const FIRE = new Set(["fire_alarm", "emergency_lighting", "fire_extinguishers", "sprinklers", "fire_doors", "dry_wet_risers", "smoke_ventilation", "gas_suppression", "fire_risk_assessment"]);

const siteUrl = () => (process.env.SITE_URL ?? "").replace(/\/+$/, "");
const convexSiteUrl = () => (process.env.CONVEX_SITE_URL ?? "").replace(/\/+$/, "");
export const unsubscribeUrl = (token: string) => `${convexSiteUrl()}/unsubscribe/${token}`;

/* ================================================================== */
/* Cron entry points                                                   */
/* ================================================================== */

/** Runs hourly from convex/crons.ts; does the real work only at 07:00 UK time (DST-safe). */
export const hourlyTick = internalMutation({
  args: { force: v.optional(v.boolean()) },
  handler: async (ctx, { force }) => {
    const now = Date.now();
    if (!force && londonHour(now) !== SEND_HOUR_LONDON) return { ran: false };
    const orgs = await ctx.db.query("organizations").take(1000);
    let n = 0;
    for (const org of orgs) {
      if (org.status !== "active") continue;
      await ctx.scheduler.runAfter(n * 200, internal.reminders.planForOrg, { orgId: org._id });
      n++;
    }
    return { ran: true, orgs: n };
  },
});

type NewReminder = Omit<Doc<"reminders">, "_id" | "_creationTime" | "status" | "sendAt" | "createdAt">;

async function ensureReminder(ctx: MutationCtx, r: NewReminder, now: number): Promise<boolean> {
  const existing = await ctx.db.query("reminders").withIndex("by_dedupe_key", (q) => q.eq("dedupeKey", r.dedupeKey)).first();
  if (existing) return false;
  await ctx.db.insert("reminders", { ...r, status: "pending", sendAt: now, createdAt: now });
  return true;
}

/** Create any reminders that are due today for one organization (idempotent), then dispatch. */
export const planForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.optional(v.number()), dispatch: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, now: nowArg, dispatch }) => {
    const now = nowArg ?? Date.now();
    const org = await ctx.db.get(orgId);
    if (!org || org.status !== "active") return null;
    const cfg = settingsFor(org);
    // 0. Automation that runs even when reminder emails are off: routine jobs from schedules.
    const autoJobs = await autoCreateJobsForOrg(ctx, org, now);
    // 0b. Overdue invoices: record overdueSince (always, even with reminders off).
    const od = await flagOverdueInvoices(ctx, org, now);
    const automation = { jobsCreated: autoJobs.created.length, jobsSkipped: autoJobs.skipped, jobAutomationDisabled: autoJobs.disabled ?? false, invoicesFlaggedOverdue: od.flagged, invoicesOverdueCleared: od.cleared };
    const created: Record<string, number> = { service_schedule: 0, certificate_expiry: 0, defect_followup: 0, quote_followup: 0, qualification_expiry: 0, weekly_digest: 0, invoice_overdue: 0 };
    if (!cfg.enabled) {
      if (autoJobs.created.length && dispatch !== false) await ctx.scheduler.runAfter(0, internal.reminders.dispatchForOrg, { orgId, now: nowArg });
      return { created, disabled: true, automation };
    }
    const siteNames = new Map<string, string>();
    const siteName = async (id: Id<"sites">) => {
      if (!siteNames.has(id)) siteNames.set(id, (await ctx.db.get(id))?.name ?? "Site");
      return siteNames.get(id)!;
    };

    // 1. Service schedules
    const maxService = Math.max(...cfg.serviceLeadDays, 0, ...[0]);
    const schedules = await ctx.db
      .query("serviceSchedules")
      .withIndex("by_org_and_next_due", (q) => q.eq("orgId", orgId).lte("nextDueAt", now + (maxService + 400) * DAY))
      .take(2000);
    for (const s of schedules) {
      if (s.status !== "active" || (!s.notifyClient && !s.notifyOrg)) continue;
      const leads = s.reminderOffsetsDays.length ? s.reminderOffsetsDays : cfg.serviceLeadDays;
      const stage = leadStage(s.nextDueAt, now, leads, cfg.overdueRepeatDays, cfg.overdueMaxReminders);
      if (!stage) continue;
      const ok = await ensureReminder(
        ctx,
        {
          orgId, clientId: s.clientId, siteId: s.siteId, sourceType: "service_schedule", scheduleId: s._id,
          dedupeKey: `svc:${s._id}:${s.nextDueAt}:${stage}`, stage, dueAt: s.nextDueAt,
          audience: s.notifyClient && s.notifyOrg ? "both" : s.notifyClient ? "client" : "org",
          title: `${stage.startsWith("od") ? "Service overdue" : "Service due"} · ${await siteName(s.siteId)} · ${s.name}`,
        },
        now,
      );
      if (ok) created.service_schedule++;
    }

    // 2. Certificate expiry (skipped when an active service schedule already covers the same site + discipline)
    const maxCert = Math.max(...cfg.certificateLeadDays, 0);
    const certs = await ctx.db
      .query("certificates")
      .withIndex("by_org_and_expiry", (q) => q.eq("orgId", orgId).lte("expiresAt", now + maxCert * DAY))
      .take(2000);
    for (const c of certs) {
      if (c.status !== "issued" || c.expiresAt === undefined) continue;
      const stage = leadStage(c.expiresAt, now, cfg.certificateLeadDays, cfg.overdueRepeatDays, cfg.overdueMaxReminders);
      if (!stage) continue;
      const covering = await ctx.db.query("serviceSchedules").withIndex("by_site", (q) => q.eq("siteId", c.siteId)).take(100);
      const covered = covering.some(
        (s) => s.status === "active" && s.discipline === c.discipline && Math.abs(s.nextDueAt - c.expiresAt!) <= 31 * DAY,
      );
      if (covered) continue;
      const ok = await ensureReminder(
        ctx,
        {
          orgId, clientId: c.clientId, siteId: c.siteId, sourceType: "certificate_expiry", certificateId: c._id,
          dedupeKey: `cert:${c._id}:${c.expiresAt}:${stage}`, stage, dueAt: c.expiresAt, audience: "both",
          title: `${stage.startsWith("od") ? "Certificate expired" : "Certificate expiring"} · ${c.certificateNumber} · ${await siteName(c.siteId)}`,
        },
        now,
      );
      if (ok) created.certificate_expiry++;
    }

    // 3. Open defects needing follow-up
    for (const status of OPEN_DEFECT) {
      const defects = await ctx.db
        .query("defects")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .take(2000);
      for (const d of defects) {
        const days = cfg.defectFollowUpDays[d.severity];
        const followAt = d.targetResolutionAt ?? (days > 0 ? d.raisedAt + days * DAY : undefined);
        if (followAt === undefined) continue;
        const stage = leadStage(followAt, now, [0], cfg.overdueRepeatDays, cfg.overdueMaxReminders);
        if (!stage) continue;
        const ok = await ensureReminder(
          ctx,
          {
            orgId, clientId: d.clientId, siteId: d.siteId, sourceType: "defect_followup", defectId: d._id,
            dedupeKey: `def:${d._id}:${followAt}:${stage}`, stage, dueAt: followAt,
            audience: d.visibleToClient && (d.severity === "critical" || d.severity === "major") ? "both" : "org",
            title: `Defect follow-up · ${d.severity.toUpperCase()} ${d.reference} · ${await siteName(d.siteId)}`,
          },
          now,
        );
        if (ok) created.defect_followup++;
      }
    }

    // 4. Quotes awaiting a response
    for (const status of ["sent", "viewed"] as const) {
      const quotes = await ctx.db
        .query("quotes")
        .withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status))
        .take(2000);
      for (const q of quotes) {
        if (!q.sentAt || (q.validUntil !== undefined && q.validUntil < now)) continue;
        const stage = followUpStage(q.sentAt, now, cfg.quoteFollowUpDays);
        if (!stage) continue;
        const ok = await ensureReminder(
          ctx,
          {
            orgId, clientId: q.clientId, siteId: q.siteId, sourceType: "quote_followup", quoteId: q._id,
            dedupeKey: `quote:${q._id}:${q.sentAt}:${stage}`, stage, dueAt: q.validUntil ?? q.sentAt,
            audience: "both", title: `Quote awaiting response · ${q.quoteNumber} · ${q.title}`,
          },
          now,
        );
        if (ok) created.quote_followup++;
      }
    }

    // 5. Engineer qualification expiry (company only)
    const maxQual = Math.max(...cfg.qualificationLeadDays, 0);
    const quals = await ctx.db
      .query("engineerQualifications")
      .withIndex("by_org_and_expiry", (q) => q.eq("orgId", orgId).lte("expiresAt", now + maxQual * DAY))
      .take(2000);
    for (const ql of quals) {
      if (ql.expiresAt === undefined) continue;
      const stage = leadStage(ql.expiresAt, now, cfg.qualificationLeadDays, cfg.overdueRepeatDays, cfg.overdueMaxReminders);
      if (!stage) continue;
      const user = await ctx.db.get(ql.userId);
      const ok = await ensureReminder(
        ctx,
        {
          orgId, sourceType: "qualification_expiry", qualificationId: ql._id,
          dedupeKey: `qual:${ql._id}:${ql.expiresAt}:${stage}`, stage, dueAt: ql.expiresAt, audience: "org",
          title: `Qualification ${stage.startsWith("od") ? "expired" : "expiring"} · ${user?.name ?? "Engineer"} · ${ql.title}`,
        },
        now,
      );
      if (ok) created.qualification_expiry++;
    }

    // 6. Overdue invoices: one reminder per stage (default 1/7/14/30 days after due) per due date.
    for (const inv of od.overdue) {
      const stage = invoiceOverdueStage(inv.dueAt!, now, cfg.invoiceOverdueDays);
      if (!stage) continue;
      const ok = await ensureReminder(
        ctx,
        {
          orgId, clientId: inv.clientId, siteId: inv.siteId, sourceType: "invoice_overdue", invoiceId: inv._id,
          dedupeKey: `inv:${inv._id}:${inv.dueAt}:${stage}`, stage, dueAt: inv.dueAt!, audience: cfg.invoiceRemindClient ? "both" : "org",
          title: `Invoice overdue · ${inv.invoiceNumber} · ${stage.slice(2)} day${stage === "od1" ? "" : "s"}`,
        },
        now,
      );
      if (ok) created.invoice_overdue++;
    }

    // 7. Weekly digest (Mondays)
    if (cfg.weeklyDigest && londonWeekday(now) === "Mon") {
      const ok = await ensureReminder(
        ctx,
        { orgId, sourceType: "custom", dedupeKey: `digest:${orgId}:${londonDateKey(now)}`, stage: "weekly_digest", dueAt: now, audience: "org", title: "Weekly compliance digest" },
        now,
      );
      if (ok) created.weekly_digest++;
    }

    if (dispatch !== false) await ctx.scheduler.runAfter(0, internal.reminders.dispatchForOrg, { orgId, now: nowArg });
    return { created, automation };
  },
});

/* ================================================================== */
/* Dispatcher                                                          */
/* ================================================================== */

type Recipient = { email: string; type: "org" | "client"; userId?: Id<"users">; name?: string };

async function orgRecipients(ctx: QueryCtx, org: Doc<"organizations">): Promise<Recipient[]> {
  const cfg = settingsFor(org);
  if (cfg.officeEmails.length) return cfg.officeEmails.map((email) => ({ email, type: "org" as const }));
  const out: Recipient[] = [];
  if (org.email) out.push({ email: org.email, type: "org" });
  for (const role of OFFICE) {
    const ms = await ctx.db.query("memberships").withIndex("by_org_and_role", (q) => q.eq("orgId", org._id).eq("role", role)).take(50);
    for (const m of ms) {
      if (m.status !== "active") continue;
      const u = await ctx.db.get(m.userId);
      if (u?.email) out.push({ email: u.email, type: "org", userId: u._id, name: u.name });
    }
  }
  return out;
}

async function clientRecipients(ctx: QueryCtx, clientId: Id<"clients">, siteId?: Id<"sites">): Promise<Recipient[]> {
  const client = await ctx.db.get(clientId);
  if (!client || client.status !== "active") return [];
  const out: Recipient[] = [];
  const listed = client.reminderEmails?.length ? client.reminderEmails : client.primaryContact?.email ? [client.primaryContact.email] : [];
  for (const email of listed) out.push({ email, type: "client", name: client.reminderEmails?.length ? undefined : client.primaryContact?.name });
  const access = await ctx.db.query("portalAccess").withIndex("by_client", (q) => q.eq("clientId", clientId)).take(200);
  for (const a of access) {
    if (a.status !== "active") continue;
    if (siteId && a.siteIds?.length && !a.siteIds.includes(siteId)) continue;
    const u = await ctx.db.get(a.userId);
    if (u?.email) out.push({ email: u.email, type: "client", userId: u._id, name: u.name });
  }
  return out;
}

function dedupeRecipients(list: Recipient[]): Recipient[] {
  const seen = new Map<string, Recipient>();
  for (const r of list) {
    const key = r.email.trim().toLowerCase();
    if (!key.includes("@")) continue;
    // if an address is both company and client, treat as company
    if (!seen.has(key) || r.type === "org") seen.set(key, { ...r, email: key });
  }
  return [...seen.values()];
}

/** Is the source still in a state that needs this reminder? */
async function stillRelevant(ctx: QueryCtx, r: Doc<"reminders">): Promise<string | null> {
  switch (r.sourceType) {
    case "service_schedule": {
      const s = r.scheduleId && (await ctx.db.get(r.scheduleId));
      if (!s || s.status !== "active") return "schedule no longer active";
      if (s.nextDueAt !== r.dueAt) return "service already completed / rescheduled";
      return null;
    }
    case "certificate_expiry": {
      const c = r.certificateId && (await ctx.db.get(r.certificateId));
      if (!c || c.status !== "issued" || c.expiresAt !== r.dueAt) return "certificate replaced or withdrawn";
      return null;
    }
    case "defect_followup": {
      const d = r.defectId && (await ctx.db.get(r.defectId));
      if (!d || !(OPEN_DEFECT as readonly string[]).includes(d.status)) return "defect resolved";
      return null;
    }
    case "quote_followup": {
      const q = r.quoteId && (await ctx.db.get(r.quoteId));
      if (!q || (q.status !== "sent" && q.status !== "viewed")) return "quote answered or withdrawn";
      return null;
    }
    case "qualification_expiry": {
      const q = r.qualificationId && (await ctx.db.get(r.qualificationId));
      if (!q || q.expiresAt !== r.dueAt) return "qualification renewed";
      return null;
    }
    case "invoice_overdue": {
      const i = r.invoiceId && (await ctx.db.get(r.invoiceId));
      if (!i || (i.status !== "sent" && i.status !== "partially_paid")) return "invoice paid or void";
      if (i.dueAt !== r.dueAt) return "invoice due date changed";
      if (i.total - i.amountPaid <= 0) return "invoice settled";
      return null;
    }
    case "jobs_auto_created": {
      const js = await Promise.all((r.jobIds ?? []).map((id) => ctx.db.get(id)));
      if (!js.some((j) => j && j.status !== "cancelled")) return "jobs no longer open";
      return null;
    }
    default:
      return null;
  }
}

type Content = Omit<EmailInput, "org" | "greeting" | "closing" | "footerReason" | "unsubscribeUrl"> & { subject: string; link?: string };


const lowerFirst = (s: string) => (/^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);
const siteAddress = (s: Doc<"sites">) => [s.address.line1, s.address.city, s.address.postcode].filter(Boolean).join(", ");

async function buildContent(ctx: QueryCtx, r: Doc<"reminders">, org: Doc<"organizations">, to: "org" | "client", now: number): Promise<Content | null> {
  const due = describeDue(r.dueAt, now);
  const tz = org.timezone || "Europe/London";
  const fd = (ms: number | undefined | null) => formatDate(ms, tz);
  const site = r.siteId ? await ctx.db.get(r.siteId) : null;
  const client = r.clientId ? await ctx.db.get(r.clientId) : null;
  const portal = site ? `${siteUrl()}/portal/sites/${site._id}` : `${siteUrl()}/portal`;
  const app = (path: string) => `${siteUrl()}/app/${path}`;
  const overdue = r.stage.startsWith("od");

  switch (r.sourceType) {
    case "service_schedule": {
      const s = r.scheduleId ? await ctx.db.get(r.scheduleId) : null;
      if (!s || !site) return null;
      const disc = disciplineLabel(s.discipline);
      const legal = FIRE.has(s.discipline)
        ? "Regular servicing by a competent person is required to keep your premises compliant with the Regulatory Reform (Fire Safety) Order 2005 and the relevant British Standards."
        : "Regular servicing keeps your system reliable and maintains compliance with your insurer's and the relevant British Standard's requirements.";
      return {
        subject: `${overdue ? "Overdue" : "Reminder"}: ${disc} service at ${site.name} ${overdue ? "was due" : "due"} ${fd(r.dueAt)}`,
        preheader: `${s.name} for ${site.name} - ${due.label.toLowerCase()}.`,
        statusLabel: due.label,
        tone: due.tone,
        heading: overdue ? `${disc} service is overdue` : `${disc} service due ${fd(r.dueAt)}`,
        paragraphs:
          to === "client"
            ? [
                overdue
                  ? `Our records show that the ${lowerFirst(s.name)} at ${site.name} was due on ${fd(r.dueAt)} and has not yet been carried out.`
                  : `This is a reminder that the ${lowerFirst(s.name)} at ${site.name} is due on ${fd(r.dueAt)}.`,
                legal,
                "Reply to this email or call us to arrange a convenient date for our engineer to attend.",
              ]
            : [
                `${s.name} for ${client?.name ?? "the client"} at ${site.name} is ${overdue ? "overdue" : "coming up"} (${due.label.toLowerCase()}).`,
                s.autoCreateJob ? "A job will be created automatically for this visit." : "Please schedule a visit and assign an engineer.",
              ],
        details: [
          ["Premises", `${site.name}, ${siteAddress(site)}`],
          ["System", disc],
          ["Service", s.name],
          ["Due date", fd(r.dueAt)],
          ["Frequency", `Every ${s.frequency.interval} ${s.frequency.unit}${s.frequency.interval === 1 ? "" : "s"}`],
          ...(s.contractReference ? ([["Contract ref.", s.contractReference]] as [string, string][]) : []),
          ...(to === "org" && client ? ([["Client", client.name]] as [string, string][]) : []),
        ],
        cta: to === "client" ? { label: "View compliance records", url: portal } : { label: "Schedule visit", url: app(`schedules/${s._id}`) },
      };
    }
    case "certificate_expiry": {
      const c = r.certificateId ? await ctx.db.get(r.certificateId) : null;
      if (!c || !site) return null;
      const type = await ctx.db.get(c.certificateTypeId);
      const disc = disciplineLabel(c.discipline);
      return {
        subject: `${overdue ? "Expired" : "Expiring"}: ${disc} certificate ${c.certificateNumber} for ${site.name} - ${fd(r.dueAt)}`,
        preheader: `Certificate ${c.certificateNumber} ${overdue ? "expired" : "expires"} on ${fd(r.dueAt)}.`,
        statusLabel: overdue ? "Expired" : due.label.replace("Due", "Expires"),
        tone: due.tone,
        heading: overdue ? `Your ${disc.toLowerCase()} certificate has expired` : `Your ${disc.toLowerCase()} certificate expires ${fd(r.dueAt)}`,
        paragraphs:
          to === "client"
            ? [
                `Certificate ${c.certificateNumber} for ${site.name} ${overdue ? "expired" : "expires"} on ${fd(r.dueAt)}.`,
                "To stay compliant, a re-inspection should be carried out before the expiry date. Reply to this email or call us to book it.",
              ]
            : [`Certificate ${c.certificateNumber} for ${client?.name ?? "the client"} at ${site.name} ${overdue ? "has expired" : "is expiring"}. Book a re-inspection.`],
        details: [
          ["Premises", `${site.name}, ${siteAddress(site)}`],
          ["Certificate", `${c.certificateNumber}${type ? ` - ${type.name}` : ""}`],
          ...(type?.standard ? ([["Standard", type.standard]] as [string, string][]) : []),
          ["Issued", fd(c.issuedAt)],
          ["Expiry date", fd(r.dueAt)],
        ],
        cta: to === "client" ? { label: "View certificate", url: certificateVerifyUrl(c.verificationToken) } : { label: "Book re-inspection", url: app(`certificates/${c._id}`) },
      };
    }
    case "defect_followup": {
      const d = r.defectId ? await ctx.db.get(r.defectId) : null;
      if (!d || !site) return null;
      const sev = d.severity.charAt(0).toUpperCase() + d.severity.slice(1);
      const days = -daysUntil(d.raisedAt, now);
      return {
        subject: `${to === "client" ? "Action required" : "Follow-up"}: ${sev} defect ${d.reference} at ${site.name}`,
        preheader: `${d.title} - outstanding for ${days} day${days === 1 ? "" : "s"}.`,
        statusLabel: `${sev} defect`,
        tone: d.severity === "critical" || d.severity === "major" ? "overdue" : "soon",
        heading: to === "client" ? `An outstanding ${d.severity} defect needs your attention` : `${sev} defect ${d.reference} is still open`,
        paragraphs:
          to === "client"
            ? [
                `During our visit to ${site.name} we recorded the defect below. It is still outstanding and may affect the compliance or reliability of your ${disciplineLabel(d.discipline).toLowerCase()} system.`,
                d.quoteId ? "We have sent you a quote for the remedial work. Please review and accept it so we can schedule the repair." : "Please contact us to arrange remedial work.",
              ]
            : [`${sev} defect ${d.reference} at ${site.name} (${client?.name ?? ""}) has been open for ${days} days.${d.quoteId ? " A quote has been raised." : " No quote has been raised yet."}`],
        details: [
          ["Premises", `${site.name}, ${siteAddress(site)}`],
          ["Defect", `${d.reference} - ${d.title}`],
          ["Severity", sev],
          ["System", disciplineLabel(d.discipline)],
          ["Recorded", fd(d.raisedAt)],
          ...(d.recommendedAction ? ([["Recommended action", d.recommendedAction]] as [string, string][]) : []),
        ],
        cta: to === "client" ? { label: "View defect", url: `${siteUrl()}/portal/defects/${d._id}` } : { label: "Open defect", url: app(`defects/${d._id}`) },
      };
    }
    case "quote_followup": {
      const q = r.quoteId ? await ctx.db.get(r.quoteId) : null;
      if (!q) return null;
      const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: q.currency || "GBP" }).format(q.total / 100);
      const sentDays = q.sentAt ? -daysUntil(q.sentAt, now) : 0;
      return {
        subject: to === "client" ? `Your quote ${q.quoteNumber} from ${org.name} is awaiting your response` : `Chase: quote ${q.quoteNumber} for ${client?.name ?? "client"} (${sentDays} days)`,
        preheader: `${q.title} - ${money}${q.validUntil ? `, valid until ${fd(q.validUntil)}` : ""}.`,
        statusLabel: "Awaiting response",
        tone: "info",
        heading: to === "client" ? `Your quote ${q.quoteNumber} is ready for review` : `Quote ${q.quoteNumber} awaiting response`,
        paragraphs:
          to === "client"
            ? [
                `We sent you a quote for "${q.title}"${site ? ` at ${site.name}` : ""} on ${fd(q.sentAt)}. You can review, accept or decline it online in a couple of minutes.`,
                ...(q.validUntil ? [`This quote is valid until ${fd(q.validUntil)}.`] : []),
              ]
            : [`Quote ${q.quoteNumber} (${money}) for ${client?.name ?? "the client"} was sent ${sentDays} days ago and has not been answered.`],
        details: [
          ["Quote", `${q.quoteNumber} - ${q.title}`],
          ...(site ? ([["Premises", site.name]] as [string, string][]) : []),
          ["Total (inc. VAT)", money],
          ["Sent", fd(q.sentAt)],
          ...(q.validUntil ? ([["Valid until", fd(q.validUntil)]] as [string, string][]) : []),
        ],
        cta:
          to === "client"
            ? { label: "Review quote", url: q.acceptanceToken ? `${siteUrl()}/quotes/${q.acceptanceToken}` : `${siteUrl()}/portal/quotes/${q._id}` }
            : { label: "Open quote", url: app(`quotes/${q._id}`) },
      };
    }
    case "qualification_expiry": {
      const ql = r.qualificationId ? await ctx.db.get(r.qualificationId) : null;
      if (!ql) return null;
      const user = await ctx.db.get(ql.userId);
      return {
        subject: `${overdue ? "Expired" : "Expiring"}: ${user?.name ?? "Engineer"} - ${ql.title} (${fd(r.dueAt)})`,
        preheader: `${ql.title} ${overdue ? "expired" : "expires"} ${fd(r.dueAt)}.`,
        statusLabel: overdue ? "Expired" : due.label.replace("Due", "Expires"),
        tone: due.tone,
        heading: `Engineer qualification ${overdue ? "has expired" : "expiring soon"}`,
        paragraphs: [
          `${user?.name ?? "An engineer"}'s ${ql.title} ${overdue ? "expired" : "expires"} on ${fd(r.dueAt)}. Engineers must hold current competency to sign ${disciplineLabel(ql.discipline).toLowerCase()} certificates under your accreditation scheme.`,
        ],
        details: [
          ["Engineer", user?.name ?? "-"],
          ["Qualification", ql.title],
          ...(ql.issuer ? ([["Issuer", ql.issuer]] as [string, string][]) : []),
          ...(ql.reference ? ([["Reference", ql.reference]] as [string, string][]) : []),
          ["Expiry date", fd(r.dueAt)],
        ],
        cta: { label: "View engineer", url: app(`team/${ql.userId}`) },
      };
    }
    case "invoice_overdue": {
      const inv = r.invoiceId ? await ctx.db.get(r.invoiceId) : null;
      if (!inv) return null;
      const bal = formatMoney(inv.total - inv.amountPaid, inv.currency);
      const days = Math.max(1, Math.floor((now - (inv.dueAt ?? now)) / DAY));
      const pdf = inv.pdfToken ? invoicePdfUrl(inv.pdfToken) : null;
      const b = org.bankDetails;
      const sort = b?.sortCode?.replace(/\D/g, "");
      const bank: [string, string][] = b
        ? ([
            ["Account name", b.accountName], ["Bank", b.bankName],
            ["Sort code", sort && sort.length === 6 ? `${sort.slice(0, 2)}-${sort.slice(2, 4)}-${sort.slice(4)}` : b.sortCode],
            ["Account number", b.accountNumber], ["IBAN", b.iban], ["BIC", b.bic],
          ].filter(([, x]) => !!x) as [string, string][])
        : [];
      const base: [string, string][] = [
        ["Invoice", inv.invoiceNumber],
        ...(site ? ([["Premises", site.name]] as [string, string][]) : []),
        ["Amount due", bal],
        ...(inv.amountPaid > 0 ? ([["Already paid", formatMoney(inv.amountPaid, inv.currency)]] as [string, string][]) : []),
        ["Due date", fd(inv.dueAt)],
        ["Days overdue", String(days)],
      ];
      if (to === "client") {
        return {
          subject: `Payment reminder: invoice ${inv.invoiceNumber} from ${org.name} is overdue`,
          preheader: `${bal} was due on ${fd(inv.dueAt)}.`,
          statusLabel: "Payment overdue",
          tone: "overdue",
          heading: `Invoice ${inv.invoiceNumber} is overdue`,
          paragraphs: [
            `Our records show that ${bal} on invoice ${inv.invoiceNumber} was due on ${fd(inv.dueAt)} and is still outstanding.`,
            b?.paymentInstructions || `Please pay at your earliest convenience, quoting ${inv.invoiceNumber} as the payment reference.`,
            "If you've already paid, thank you, and please ignore this reminder. If there's a problem with the invoice, just reply and let us know.",
          ],
          details: [...base, ...bank],
          cta: { label: "View invoice", url: `${siteUrl()}/portal/invoices/${inv._id}` },
          links: pdf ? [{ label: "Download PDF invoice", url: pdf }] : undefined,
        };
      }
      return {
        subject: `Chase: invoice ${inv.invoiceNumber} for ${client?.name ?? "client"} is ${days} day${days === 1 ? "" : "s"} overdue (${bal})`,
        preheader: `${bal} outstanding since ${fd(inv.dueAt)}.`,
        statusLabel: "Overdue",
        tone: "overdue",
        heading: `Invoice ${inv.invoiceNumber} overdue`,
        paragraphs: [
          `${client?.name ?? "The client"} hasn't paid ${bal} on invoice ${inv.invoiceNumber}, due ${fd(inv.dueAt)} (${days} day${days === 1 ? "" : "s"} ago).`,
          settingsFor(org).invoiceRemindClient ? "A payment reminder has also been sent to the client." : "Client reminders are turned off, so you may want to contact them directly.",
        ],
        details: base,
        cta: { label: "Open invoice", url: app(`invoices/${inv._id}`) },
        links: pdf ? [{ label: "Invoice PDF", url: pdf }] : undefined,
      };
    }
    case "jobs_auto_created": {
      const jobs = (await Promise.all((r.jobIds ?? []).map((id) => ctx.db.get(id)))).filter((j): j is Doc<"jobs"> => !!j && j.status !== "cancelled");
      if (!jobs.length) return null;
      const rows = await Promise.all(jobs.slice(0, 30).map(async (j): Promise<[string, string, string]> => {
        const sname = (await ctx.db.get(j.siteId))?.name ?? "";
        const eng = j.assignedEngineerIds.length ? (await ctx.db.get(j.assignedEngineerIds[0]))?.name ?? "assigned" : "unassigned";
        return [j.jobNumber, `${sname} - ${disciplineLabel(j.disciplines[0])} (${eng})`, `Due ${fd(j.scheduleDueAt)}`];
      }));
      const unassigned = jobs.filter((j) => !j.assignedEngineerIds.length).length;
      const overdueJobs = jobs.filter((j) => (j.scheduleDueAt ?? now) < now).length;
      return {
        subject: `${jobs.length} routine job${jobs.length === 1 ? "" : "s"} created from service schedules`,
        preheader: `${jobs.length} new unscheduled job${jobs.length === 1 ? "" : "s"}${overdueJobs ? `, ${overdueJobs} already overdue` : ""}.`,
        statusLabel: "Jobs to schedule",
        tone: overdueJobs ? "overdue" : "info",
        heading: "New routine jobs to schedule",
        paragraphs: [
          `These jobs were created automatically because the service is due within your lead window. They are unscheduled: pick a visit date${unassigned ? " and assign an engineer" : ""} to confirm them.`,
          ...(unassigned ? [`${unassigned} job${unassigned === 1 ? " has" : "s have"} no engineer yet.`] : []),
        ],
        details: [["Jobs created", String(jobs.length)], ["Unassigned", String(unassigned)], ["Already overdue", String(overdueJobs)]],
        sections: [{ title: "Jobs to schedule", rows, empty: "None." }],
        cta: { label: "Schedule jobs", url: app("jobs?status=draft") },
      };
    }
    case "custom": {
      if (r.stage === "weekly_digest") return await buildDigest(ctx, org, now);
      return {
        subject: r.title ?? `Message from ${org.name}`,
        preheader: r.message ?? "",
        statusLabel: r.stage === "test" ? "Test" : "Reminder",
        tone: "info",
        heading: r.title ?? "Reminder",
        paragraphs: [r.message ?? ""],
        details: [],
      };
    }
    default:
      return null;
  }
}

async function buildDigest(ctx: QueryCtx, org: Doc<"organizations">, now: number): Promise<Content> {
  const tz = org.timezone || "Europe/London";
  const fd = (ms: number | undefined) => formatDate(ms, tz);
  const name = async (id?: Id<"sites">) => (id ? ((await ctx.db.get(id))?.name ?? "") : "");
  const schedules = await ctx.db
    .query("serviceSchedules")
    .withIndex("by_org_and_next_due", (q) => q.eq("orgId", org._id).lte("nextDueAt", now + 30 * DAY))
    .take(200);
  const active = schedules.filter((s) => s.status === "active");
  const overdue = active.filter((s) => s.nextDueAt < now);
  const upcoming = active.filter((s) => s.nextDueAt >= now);
  const certs = (
    await ctx.db.query("certificates").withIndex("by_org_and_expiry", (q) => q.eq("orgId", org._id).lte("expiresAt", now + 30 * DAY)).take(200)
  ).filter((c) => c.status === "issued" && c.expiresAt !== undefined);
  const defects = [
    ...(await ctx.db.query("defects").withIndex("by_org_and_severity", (q) => q.eq("orgId", org._id).eq("severity", "critical")).take(100)),
    ...(await ctx.db.query("defects").withIndex("by_org_and_severity", (q) => q.eq("orgId", org._id).eq("severity", "major")).take(100)),
  ].filter((d) => (OPEN_DEFECT as readonly string[]).includes(d.status));
  const quotes = [
    ...(await ctx.db.query("quotes").withIndex("by_org_and_status", (q) => q.eq("orgId", org._id).eq("status", "sent")).take(100)),
    ...(await ctx.db.query("quotes").withIndex("by_org_and_status", (q) => q.eq("orgId", org._id).eq("status", "viewed")).take(100)),
  ];
  const row = async (s: Doc<"serviceSchedules">): Promise<[string, string, string]> => [await name(s.siteId), `${disciplineLabel(s.discipline)} - ${s.name}`, fd(s.nextDueAt)];
  const tone: EmailTone = overdue.length || defects.some((d) => d.severity === "critical") ? "overdue" : upcoming.length ? "soon" : "ok";
  return {
    subject: `Weekly compliance digest - ${overdue.length} overdue, ${upcoming.length} due in 30 days`,
    preheader: `${overdue.length} overdue services, ${certs.length} certificates expiring, ${defects.length} serious defects open.`,
    statusLabel: `Week of ${fd(now)}`,
    tone,
    heading: "Your week at a glance",
    paragraphs: ["Here is what needs attention across your clients' premises this week."],
    details: [
      ["Overdue services", String(overdue.length)],
      ["Services due in 30 days", String(upcoming.length)],
      ["Certificates expiring in 30 days", String(certs.length)],
      ["Open critical / major defects", String(defects.length)],
      ["Quotes awaiting response", String(quotes.length)],
    ],
    sections: [
      { title: "Overdue services", rows: await Promise.all(overdue.slice(0, 15).map(row)), empty: "Nothing overdue." },
      { title: "Due in the next 30 days", rows: await Promise.all(upcoming.slice(0, 15).map(row)), empty: "Nothing due." },
      {
        title: "Certificates expiring",
        rows: await Promise.all(certs.slice(0, 15).map(async (c): Promise<[string, string, string]> => [await name(c.siteId), c.certificateNumber, fd(c.expiresAt)])),
        empty: "None expiring.",
      },
      {
        title: "Serious open defects",
        rows: await Promise.all(defects.slice(0, 15).map(async (d): Promise<[string, string, string]> => [await name(d.siteId), `${d.severity.toUpperCase()} ${d.reference} - ${d.title}`, fd(d.raisedAt)])),
        empty: "No critical or major defects open.",
      },
    ],
    cta: { label: "Open dashboard", url: `${siteUrl()}/app` },
  };
}

async function isSuppressed(ctx: QueryCtx, orgId: Id<"organizations">, email: string) {
  return (await ctx.db.query("emailSuppressions").withIndex("by_org_and_email", (q) => q.eq("orgId", orgId).eq("email", email)).first()) !== null;
}

/** Render and queue emails for one reminder. Returns number of notifications created. */
async function dispatchOne(ctx: MutationCtx, r: Doc<"reminders">, now: number, overrideTo?: Recipient[]): Promise<number> {
  const org = await ctx.db.get(r.orgId);
  if (!org) return 0;
  const reason = await stillRelevant(ctx, r);
  if (reason) {
    await ctx.db.patch(r._id, { status: "cancelled", cancelReason: reason });
    return 0;
  }
  let recipients: Recipient[] = overrideTo ?? [];
  if (!overrideTo) {
    if (r.audience !== "client") recipients.push(...(await orgRecipients(ctx, org)));
    if (r.sourceType === "qualification_expiry" && r.qualificationId) {
      const q = await ctx.db.get(r.qualificationId);
      const u = q && (await ctx.db.get(q.userId));
      if (u?.email) recipients.push({ email: u.email, type: "org", userId: u._id, name: u.name });
    }
    if (r.audience !== "org" && r.clientId) recipients.push(...(await clientRecipients(ctx, r.clientId, r.siteId)));
  }
  recipients = dedupeRecipients(recipients);
  if (!recipients.length) {
    await ctx.db.patch(r._id, { status: "no_recipients", dispatchedAt: now });
    return 0;
  }
  const logoUrl = org.logoId ? await ctx.storage.getUrl(org.logoId) : null;
  const block = orgBlock(org, logoUrl);
  const cache: Partial<Record<"org" | "client", Content | null>> = {};
  let n = 0;
  for (const to of recipients) {
    if (!(to.type in cache)) cache[to.type] = await buildContent(ctx, r, org, to.type, now);
    const content = cache[to.type];
    if (!content) continue;
    const token = newPublicToken(24);
    const { subject, link, ...rest } = content;
    const { html, text } = renderEmail({
      ...rest,
      org: block,
      greeting: to.name ? `Dear ${to.name.split(" ")[0]},` : to.type === "client" ? "Dear Sir or Madam," : "Hello,",
      closing: to.type === "client" ? `Kind regards,\n${org.name}` : `- ${org.name} compliance reminders`,
      footerReason:
        to.type === "client"
          ? `You are receiving this because ${org.name} maintains fire and security systems at your premises.`
          : `You are receiving this because you are listed as a reminder contact for ${org.name}.`,
      unsubscribeUrl: unsubscribeUrl(token),
    });
    const suppressed = await isSuppressed(ctx, r.orgId, to.email);
    const id = await ctx.db.insert("notifications", {
      orgId: r.orgId,
      userId: to.userId,
      clientId: to.type === "client" ? r.clientId : undefined,
      recipientType: to.type,
      recipientEmail: to.email,
      channel: "email",
      reminderId: r._id,
      type: r.stage === "weekly_digest" ? "weekly_digest" : r.stage === "test" ? "test" : r.sourceType,
      title: subject,
      body: text,
      html,
      link: rest.cta?.url ?? link,
      status: suppressed ? "skipped_opt_out" : "queued",
      attempts: 0,
      unsubscribeToken: token,
      isTest: r.stage === "test" ? true : undefined,
      createdAt: now,
    });
    if (!suppressed) await ctx.scheduler.runAfter(n * 250, internal.emails.send, { notificationId: id });
    n++;
  }
  await ctx.db.patch(r._id, { status: "dispatched", dispatchedAt: now });
  return n;
}

/** Send all pending reminders whose send time has arrived for an org. */
export const dispatchForOrg = internalMutation({
  args: { orgId: v.id("organizations"), now: v.optional(v.number()) },
  handler: async (ctx, { orgId, now: nowArg }) => {
    const now = nowArg ?? Date.now();
    const due = await ctx.db
      .query("reminders")
      .withIndex("by_org_and_status_and_send_at", (q) => q.eq("orgId", orgId).eq("status", "pending").lte("sendAt", Math.max(now, Date.now())))
      .take(50);
    let notifications = 0;
    for (const r of due) notifications += await dispatchOne(ctx, r, now);
    if (due.length === 50) await ctx.scheduler.runAfter(1000, internal.reminders.dispatchForOrg, { orgId, now: nowArg });
    return { reminders: due.length, notifications };
  },
});

/* ================================================================== */
/* Email sending support (used by convex/emails.ts)                    */
/* ================================================================== */

export const getForSend = internalQuery({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.db.get(notificationId);
    if (!n) return null;
    const org = await ctx.db.get(n.orgId);
    return {
      status: n.status,
      attempts: n.attempts ?? 0,
      to: n.recipientEmail ?? null,
      subject: n.title,
      html: n.html ?? "",
      text: n.body ?? "",
      orgName: org?.name ?? "",
      replyTo: org?.email ?? null,
      unsubscribeUrl: n.unsubscribeToken ? unsubscribeUrl(n.unsubscribeToken) : null,
    };
  },
});

export const recordSendResult = internalMutation({
  args: {
    notificationId: v.id("notifications"),
    outcome: v.union(v.literal("sent"), v.literal("skipped_no_provider"), v.literal("retry"), v.literal("failed")),
    providerMessageId: v.optional(v.string()),
    error: v.optional(v.string()),
    retryInMs: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const n = await ctx.db.get(a.notificationId);
    if (!n) return;
    const attempts = (n.attempts ?? 0) + (a.outcome === "skipped_no_provider" ? 0 : 1);
    if (a.outcome === "retry") {
      const at = Date.now() + (a.retryInMs ?? 60_000);
      await ctx.db.patch(n._id, { status: "queued", attempts, error: a.error, nextAttemptAt: at });
      await ctx.scheduler.runAt(at, internal.emails.send, { notificationId: n._id });
      return;
    }
    await ctx.db.patch(n._id, {
      status: a.outcome,
      attempts,
      error: a.error,
      providerMessageId: a.providerMessageId,
      sentAt: a.outcome === "sent" ? Date.now() : undefined,
      nextAttemptAt: undefined,
    });
  },
});

/* ================================================================== */
/* Unsubscribe (used by the public HTTP route)                         */
/* ================================================================== */

export const unsubscribeInfo = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const n = await ctx.db.query("notifications").withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", token)).unique();
    if (!n?.recipientEmail) return null;
    const org = await ctx.db.get(n.orgId);
    return { orgName: org?.name ?? "", email: n.recipientEmail, already: await isSuppressed(ctx, n.orgId, n.recipientEmail) };
  },
});

export const unsubscribe = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const n = await ctx.db.query("notifications").withIndex("by_unsubscribe_token", (q) => q.eq("unsubscribeToken", token)).unique();
    if (!n?.recipientEmail) return null;
    const org = await ctx.db.get(n.orgId);
    if (!(await isSuppressed(ctx, n.orgId, n.recipientEmail))) {
      await ctx.db.insert("emailSuppressions", { orgId: n.orgId, email: n.recipientEmail, clientId: n.clientId, reason: "unsubscribed", createdAt: Date.now() });
      await ctx.db.insert("auditLog", { orgId: n.orgId, action: "email.unsubscribed", entityType: "emailSuppression", entityId: n.recipientEmail, at: Date.now() });
    }
    return { orgName: org?.name ?? "", email: n.recipientEmail };
  },
});

/* ================================================================== */
/* Staff functions                                                     */
/* ================================================================== */

const reminderStatus = v.union(v.literal("pending"), v.literal("dispatched"), v.literal("no_recipients"), v.literal("dismissed"), v.literal("cancelled"));

/** Reminders by status (default: pending = upcoming), soonest first; dispatched ones newest first. Office+ only. */
export const list = query({
  args: { orgId: v.id("organizations"), status: v.optional(reminderStatus), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, status, limit }) => {
    await requireMember(ctx, orgId, [...OFFICE]);
    const st = status ?? "pending";
    const q = ctx.db.query("reminders").withIndex("by_org_and_status_and_send_at", (q) => q.eq("orgId", orgId).eq("status", st));
    const rows = await (st === "pending" ? q.order("asc") : q.order("desc")).take(Math.min(limit ?? 100, 500));
    return rows.map((r) => ({
      _id: r._id, title: r.title ?? r.sourceType, sourceType: r.sourceType, stage: r.stage, audience: r.audience,
      dueAt: r.dueAt, sendAt: r.sendAt, status: r.status, dispatchedAt: r.dispatchedAt ?? null, snoozedUntil: r.snoozedUntil ?? null,
      siteId: r.siteId ?? null, clientId: r.clientId ?? null, cancelReason: r.cancelReason ?? null,
    }));
  },
});

/** Notification log (sent / dry-run / skipped / failed), newest first. Office+ only. */
export const listNotifications = query({
  args: { orgId: v.id("organizations"), limit: v.optional(v.number()) },
  handler: async (ctx, { orgId, limit }) => {
    await requireMember(ctx, orgId, [...OFFICE]);
    const rows = await ctx.db.query("notifications").withIndex("by_org_and_created", (q) => q.eq("orgId", orgId)).order("desc").take(Math.min(limit ?? 100, 500));
    return rows.map(({ html, body, unsubscribeToken, ...n }) => n);
  },
});

/** One notification including its rendered HTML / text (preview). Office+ only. */
export const getNotification = query({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, { notificationId }) => {
    const n = await ctx.db.get(notificationId);
    if (!n) throw new Error("Not found");
    await requireMember(ctx, n.orgId, [...OFFICE]);
    const { unsubscribeToken, ...rest } = n;
    return rest;
  },
});

/** Postpone a pending reminder by N days (sent at 07:00 UK time on that day). Office+ only. */
export const snooze = mutation({
  args: { reminderId: v.id("reminders"), days: v.number() },
  handler: async (ctx, { reminderId, days }) => {
    const r = await ctx.db.get(reminderId);
    if (!r) throw new Error("Reminder not found");
    const { user } = await requireMember(ctx, r.orgId, [...OFFICE]);
    if (r.status !== "pending") throw new Error("Only pending reminders can be snoozed");
    if (days < 1 || days > 90) throw new Error("Snooze between 1 and 90 days");
    const until = londonMorning(Date.now(), Math.round(days));
    await ctx.db.patch(reminderId, { sendAt: until, snoozedUntil: until });
    await ctx.db.insert("auditLog", { orgId: r.orgId, actorUserId: user._id, action: "reminder.snoozed", entityType: "reminder", entityId: reminderId, changes: { days }, at: Date.now() });
    return { sendAt: until };
  },
});

/** Dismiss a pending reminder; it will not be recreated for the same stage. Office+ only. */
export const dismiss = mutation({
  args: { reminderId: v.id("reminders"), reason: v.optional(v.string()) },
  handler: async (ctx, { reminderId, reason }) => {
    const r = await ctx.db.get(reminderId);
    if (!r) throw new Error("Reminder not found");
    const { user } = await requireMember(ctx, r.orgId, [...OFFICE]);
    if (r.status !== "pending") throw new Error("Only pending reminders can be dismissed");
    await ctx.db.patch(reminderId, { status: "dismissed", dismissedBy: user._id, cancelReason: reason });
    await ctx.db.insert("auditLog", { orgId: r.orgId, actorUserId: user._id, action: "reminder.dismissed", entityType: "reminder", entityId: reminderId, changes: { reason }, at: Date.now() });
  },
});

/** Send a test reminder email to yourself (or a given address). Dry-run when no provider is configured. */
export const sendTest = mutation({
  args: { orgId: v.id("organizations"), to: v.optional(v.string()) },
  handler: async (ctx, { orgId, to }) => {
    const { user } = await requireMember(ctx, orgId, [...OFFICE]);
    const email = (to ?? user.email ?? "").trim().toLowerCase();
    if (!email.includes("@")) throw new Error("No email address to send to");
    const now = Date.now();
    const id = await ctx.db.insert("reminders", {
      orgId, sourceType: "custom", stage: "test", dedupeKey: `test:${orgId}:${now}:${newPublicToken(6)}`, dueAt: now, sendAt: now,
      audience: "org", status: "pending", createdAt: now, title: "Test reminder - your email settings are working",
      message: "This is a test of automated compliance reminders. Real reminders will look like this, with the property, system and due date.",
    });
    const r = (await ctx.db.get(id))!;
    await dispatchOne(ctx, r, now, [{ email, type: "org", userId: user._id, name: user.name }]);
    return { reminderId: id, to: email, dryRun: !process.env.RESEND_API_KEY || !process.env.EMAIL_FROM };
  },
});

/** Run the planner + dispatcher for your company now instead of waiting for 07:00 (owner/admin). */
export const runNow = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, ["owner", "admin"]);
    await ctx.scheduler.runAfter(0, internal.reminders.planForOrg, { orgId });
  },
});

/** Whether real sending is configured (for a settings screen). */
export const providerStatus = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, [...OFFICE]);
    return { provider: "resend", configured: !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM, from: process.env.EMAIL_FROM ?? null };
  },
});
