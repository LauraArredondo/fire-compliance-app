import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { requireMember, canSeeSite } from "./lib/auth";
import { discipline } from "./schema";
import { closeStaleAutoJobs, autoCreateJobsForOrg } from "./lib/autoJobs";
import { internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";
import { MutationCtx } from "./_generated/server";
import { audit, withNames, fail, str, optStr, defined, loadDoc, loadForMember, inOrg, cleanFrequency, frequencyV, addFrequency, int, DAY, STAFF, OFFICE, ANY, OFFICE_OR_CLIENT } from "./lib/util";

/** Active service schedules due within the next `days` days (incl. overdue). Office+ only. */
export const dueSoon = query({
  args: { orgId: v.id("organizations"), days: v.optional(v.number()) },
  handler: async (ctx, { orgId, days }) => {
    await requireMember(ctx, orgId, OFFICE);
    const horizon = Date.now() + (days ?? 30) * DAY;
    const rows = await ctx.db.query("serviceSchedules").withIndex("by_org_and_next_due", (q) => q.eq("orgId", orgId).lte("nextDueAt", horizon)).take(500);
    return rows.filter((s) => s.status === "active");
  },
});

/** Schedules ordered by next due date (office+), or for one site (office+ or that site's portal users). Engineers refused. Paginated. */
export const list = query({
  args: { orgId: v.id("organizations"), siteId: v.optional(v.id("sites")), status: v.optional(v.union(v.literal("active"), v.literal("paused"), v.literal("ended"))), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, siteId, status, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, OFFICE_OR_CLIENT);
    if (membership.role === "client_user" && !siteId) {
      const page = await ctx.db.query("serviceSchedules").withIndex("by_client", (q) => q.eq("clientId", membership.clientId!)).paginate(paginationOpts);
      const out = [];
      for (const s of page.page) {
        if (status && s.status !== status) continue;
        const site = await ctx.db.get(s.siteId);
        if (site && (await canSeeSite(ctx, membership, site))) out.push(s);
      }
      return { ...page, page: await withNames(ctx, out) };
    }
    if (siteId) {
      const site = await inOrg(ctx, siteId, orgId, "Site");
      if (!(await canSeeSite(ctx, membership, site))) fail("Site not found");
      const page = await ctx.db.query("serviceSchedules").withIndex("by_site", (q) => q.eq("siteId", siteId)).paginate(paginationOpts);
      return { ...page, page: await withNames(ctx, status ? page.page.filter((s) => s.status === status) : page.page) };
    }
    const page = await ctx.db.query("serviceSchedules").withIndex("by_org_and_next_due", (q) => q.eq("orgId", orgId)).paginate(paginationOpts);
    return { ...page, page: await withNames(ctx, status ? page.page.filter((s) => s.status === status) : page.page) };
  },
});

export const get = query({
  args: { scheduleId: v.id("serviceSchedules") },
  handler: async (ctx, { scheduleId }) => {
    const { doc, membership } = await loadForMember(ctx, scheduleId, "Schedule", OFFICE_OR_CLIENT);
    if (!(await canSeeSite(ctx, membership, await loadDoc(ctx, doc.siteId, "Site")))) fail("Schedule not found");
    return doc;
  },
});

function cleanOffsets(o?: number[]) {
  if (!o) return undefined;
  if (o.length > 8) fail("At most 8 reminder offsets");
  return [...new Set(o.map((d) => int(d, "Reminder offset (days)", 0, 365)))].sort((a, b) => b - a);
}

async function checkDefaultEngineer(ctx: MutationCtx, orgId: Id<"organizations">, id: Id<"users"> | null | undefined) {
  if (!id) return id;
  const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", id)).unique();
  if (!m || m.status !== "active" || m.role === "client_user") fail("The default engineer must be an active team member");
  return id;
}
const leadDays = (d?: number) => (d === undefined ? undefined : int(d, "Auto-job lead time (days)", 0, 365));

/**
 * Create a schedule. autoCreateJob now defaults to true: a routine job is created automatically
 * `autoJobLeadDays` (else the org's jobAutomation.leadDays, default 30) before each due date,
 * unless the org has turned automation off.
 */
export const create = mutation({
  args: {
    siteId: v.id("sites"), assetId: v.optional(v.id("assets")), discipline, name: v.string(), frequency: frequencyV,
    nextDueAt: v.optional(v.number()), lastCompletedAt: v.optional(v.number()), reminderOffsetsDays: v.optional(v.array(v.number())),
    notifyClient: v.optional(v.boolean()), notifyOrg: v.optional(v.boolean()), autoCreateJob: v.optional(v.boolean()), contractReference: v.optional(v.string()),
    autoJobLeadDays: v.optional(v.number()), defaultEngineerId: v.optional(v.id("users")),
  },
  handler: async (ctx, a) => {
    const { doc: site, user } = await loadForMember(ctx, a.siteId, "Site", OFFICE);
    if (site.status !== "active") fail("Site is archived");
    if (a.assetId) {
      const asset = await inOrg(ctx, a.assetId, site.orgId, "Asset");
      if (asset.siteId !== site._id) fail("Asset is not at this site");
    }
    const frequency = cleanFrequency(a.frequency);
    const nextDueAt = a.nextDueAt ?? (a.lastCompletedAt ? addFrequency(a.lastCompletedAt, frequency) : undefined);
    if (!nextDueAt) fail("Give the next due date or the last completed date");
    const id = await ctx.db.insert("serviceSchedules", {
      orgId: site.orgId, clientId: site.clientId, siteId: site._id, assetId: a.assetId, discipline: a.discipline, name: str(a.name, "Schedule name", 150),
      frequency, lastCompletedAt: a.lastCompletedAt, nextDueAt, reminderOffsetsDays: cleanOffsets(a.reminderOffsetsDays) ?? [30, 14, 7, 0],
      notifyClient: a.notifyClient ?? true, notifyOrg: a.notifyOrg ?? true, autoCreateJob: a.autoCreateJob ?? true,
      autoJobLeadDays: leadDays(a.autoJobLeadDays), defaultEngineerId: (await checkDefaultEngineer(ctx, site.orgId, a.defaultEngineerId)) ?? undefined,
      contractReference: optStr(a.contractReference, "Contract reference", 60), status: "active", createdAt: Date.now(),
    });
    await audit(ctx, site.orgId, user._id, "schedule.created", "serviceSchedule", id);
    return id;
  },
});

export const update = mutation({
  args: {
    scheduleId: v.id("serviceSchedules"), name: v.optional(v.string()), frequency: v.optional(frequencyV), nextDueAt: v.optional(v.number()),
    reminderOffsetsDays: v.optional(v.array(v.number())), notifyClient: v.optional(v.boolean()), notifyOrg: v.optional(v.boolean()),
    autoCreateJob: v.optional(v.boolean()), contractReference: v.optional(v.string()),
    /** null clears the override / default engineer. */
    autoJobLeadDays: v.optional(v.union(v.number(), v.null())), defaultEngineerId: v.optional(v.union(v.id("users"), v.null())),
  },
  handler: async (ctx, { scheduleId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, scheduleId, "Schedule", OFFICE);
    if (doc.status === "ended") fail("This schedule has ended");
    const frequency = a.frequency && cleanFrequency(a.frequency);
    const patch = defined({
      name: a.name === undefined ? undefined : str(a.name, "Schedule name", 150), frequency,
      nextDueAt: a.nextDueAt ?? (frequency && doc.lastCompletedAt ? addFrequency(doc.lastCompletedAt, frequency) : undefined),
      reminderOffsetsDays: cleanOffsets(a.reminderOffsetsDays), notifyClient: a.notifyClient, notifyOrg: a.notifyOrg, autoCreateJob: a.autoCreateJob,
      contractReference: optStr(a.contractReference, "Contract reference", 60),
    });
    const extra: { autoJobLeadDays?: number; defaultEngineerId?: Id<"users"> } = {};
    if (a.autoJobLeadDays !== undefined) extra.autoJobLeadDays = a.autoJobLeadDays === null ? undefined : leadDays(a.autoJobLeadDays);
    if (a.defaultEngineerId !== undefined) extra.defaultEngineerId = (await checkDefaultEngineer(ctx, doc.orgId, a.defaultEngineerId)) ?? undefined;
    await ctx.db.patch(scheduleId, { ...patch, ...extra });
    // Due date moved: open auto jobs for the old cycle now service the new date.
    let jobsMoved = 0;
    if (patch.nextDueAt !== undefined && patch.nextDueAt !== doc.nextDueAt) {
      for (const j of await ctx.db.query("jobs").withIndex("by_schedule", (q) => q.eq("scheduleId", scheduleId)).take(500)) {
        if (j.autoCreated && j.scheduleDueAt === doc.nextDueAt && ["draft", "scheduled", "in_progress", "on_hold"].includes(j.status)) {
          await ctx.db.patch(j._id, { scheduleDueAt: patch.nextDueAt, updatedAt: Date.now() });
          jobsMoved++;
        }
      }
    }
    await audit(ctx, doc.orgId, user._id, "schedule.updated", "serviceSchedule", scheduleId, { ...patch, ...("autoJobLeadDays" in extra || "defaultEngineerId" in extra ? { autoJobLeadDays: a.autoJobLeadDays, defaultEngineerId: a.defaultEngineerId } : {}), ...(jobsMoved ? { autoJobsMoved: jobsMoved } : {}) });
  },
});

/** Pause, resume or end a schedule. Paused/ended schedules send no reminders and get no new auto jobs. */
export const setStatus = mutation({
  args: { scheduleId: v.id("serviceSchedules"), status: v.union(v.literal("active"), v.literal("paused"), v.literal("ended")) },
  handler: async (ctx, { scheduleId, status }) => {
    const { doc, user } = await loadForMember(ctx, scheduleId, "Schedule", OFFICE);
    if (doc.status === "ended" && status !== "ended") fail("An ended schedule can't be restarted; create a new one");
    await ctx.db.patch(scheduleId, { status });
    // Ending a schedule cancels its unscheduled auto jobs; pausing leaves them (no new ones are created while paused).
    const cancelled = status === "ended" ? await closeStaleAutoJobs(ctx, doc, Number.MAX_SAFE_INTEGER, user._id, "schedule ended") : 0;
    await audit(ctx, doc.orgId, user._id, "schedule.status", "serviceSchedule", scheduleId, { from: doc.status, to: status, ...(cancelled ? { autoJobsCancelled: cancelled } : {}) });
  },
});

/** Office: run the daily auto-job step now (same rules and dedupe as the 07:00 UK run). */
export const runAutoJobsNow = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    const org = await loadDoc(ctx, orgId, "Organization");
    const r = await autoCreateJobsForOrg(ctx, org, Date.now());
    await audit(ctx, orgId, user._id, "schedule.auto_jobs_run", "organization", orgId, { created: r.created.length, skipped: r.skipped, disabled: r.disabled });
    if (r.created.length) await ctx.scheduler.runAfter(0, internal.reminders.dispatchForOrg, { orgId });
    return { created: r.created, skipped: r.skipped, disabled: r.disabled ?? false };
  },
});
