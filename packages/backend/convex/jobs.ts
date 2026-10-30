import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeSite } from "./lib/auth";
import { discipline } from "./schema";
import { advanceSchedule } from "./lib/schedules";
import { assignmentWarnings } from "./lib/qualifications";
import { audit, fail, str, optStr, defined, loadDoc, loadForMember, inOrg, nextNumber, STAFF, OFFICE, ANY } from "./lib/util";

const jobType = v.union(v.literal("routine_service"), v.literal("inspection"), v.literal("installation"), v.literal("commissioning"), v.literal("remedial"), v.literal("callout"), v.literal("survey"));
const priority = v.union(v.literal("low"), v.literal("normal"), v.literal("high"), v.literal("emergency"));
const jobStatus = v.union(v.literal("draft"), v.literal("scheduled"), v.literal("in_progress"), v.literal("on_hold"), v.literal("completed"), v.literal("invoiced"), v.literal("cancelled"));
type Status = Doc<"jobs">["status"];

/** Allowed status changes. "invoiced" is set by invoices.createFromJob, not by hand. */
const TRANSITIONS: Record<Status, Status[]> = {
  draft: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["draft", "in_progress", "on_hold", "completed", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["scheduled", "in_progress", "cancelled"],
  completed: ["in_progress"],
  invoiced: [],
  cancelled: ["draft"],
};
export const LOCKED: Status[] = ["completed", "invoiced", "cancelled"];

/** Jobs by status (staff; client users see their own client's jobs). Paginated. */
export const list = query({
  args: { orgId: v.id("organizations"), status: v.optional(jobStatus), siteId: v.optional(v.id("sites")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, status, siteId, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    if (membership.role === "client_user") {
      const page = await ctx.db.query("jobs").withIndex("by_client", (q) => q.eq("clientId", membership.clientId!)).order("desc").paginate(paginationOpts);
      const out = [];
      for (const j of page.page) {
        if (status && j.status !== status) continue;
        if (siteId && j.siteId !== siteId) continue;
        const site = await ctx.db.get(j.siteId);
        if (site && (await canSeeSite(ctx, membership, site))) out.push(j);
      }
      return { ...page, page: out };
    }
    if (siteId) {
      const site = await inOrg(ctx, siteId, orgId, "Site");
      const page = await ctx.db.query("jobs").withIndex("by_site", (q) => q.eq("siteId", site._id)).order("desc").paginate(paginationOpts);
      return status ? { ...page, page: page.page.filter((j) => j.status === status) } : page;
    }
    if (status) return await ctx.db.query("jobs").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status)).order("desc").paginate(paginationOpts);
    return await ctx.db.query("jobs").withIndex("by_org_and_scheduled", (q) => q.eq("orgId", orgId)).order("desc").paginate(paginationOpts);
  },
});

/** The signed-in engineer's open jobs in a date window (defaults: last 7 days to next 30). */
export const myJobs = query({
  args: { orgId: v.id("organizations"), from: v.optional(v.number()), to: v.optional(v.number()) },
  handler: async (ctx, { orgId, from, to }) => {
    const { user } = await requireMember(ctx, orgId, STAFF);
    const now = Date.now();
    const lo = from ?? now - 7 * 864e5, hi = to ?? now + 30 * 864e5;
    const rows = await ctx.db.query("jobs").withIndex("by_org_and_scheduled", (q) => q.eq("orgId", orgId).gte("scheduledStart", lo).lte("scheduledStart", hi)).take(2000);
    const active = await ctx.db.query("jobs").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", "in_progress")).take(500);
    const map = new Map<Id<"jobs">, Doc<"jobs">>();
    for (const j of [...rows, ...active]) if (j.assignedEngineerIds.includes(user._id) && j.status !== "cancelled" && j.status !== "draft") map.set(j._id, j);
    const jobs = [...map.values()].sort((a, b) => (a.scheduledStart ?? 0) - (b.scheduledStart ?? 0));
    return Promise.all(jobs.map(async (j) => {
      const site = await ctx.db.get(j.siteId);
      return { ...j, siteName: site?.name ?? "", siteAddress: site?.address ?? null, siteGeo: site?.geo ?? null };
    }));
  },
});

export const get = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const { doc, membership } = await loadForMember(ctx, jobId, "Job", ANY);
    const site = await loadDoc(ctx, doc.siteId, "Site");
    if (!(await canSeeSite(ctx, membership, site))) fail("Job not found");
    const [client, visits, engineers] = await Promise.all([
      ctx.db.get(doc.clientId),
      ctx.db.query("visits").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(100),
      Promise.all(doc.assignedEngineerIds.map((id) => ctx.db.get(id))),
    ]);
    const isClient = membership.role === "client_user";
    const tz = (await ctx.db.get(doc.orgId))?.timezone;
    // Staff only: assigned engineers not qualified for the job's disciplines (at the visit date, or now). Warnings, not errors.
    const qualificationWarnings = isClient || LOCKED.includes(doc.status) ? [] : await assignmentWarnings(ctx, doc.orgId, doc.assignedEngineerIds, doc.disciplines, doc.scheduledStart ?? Date.now(), tz);
    return { ...doc, siteName: site.name, clientName: client?.name ?? "", visits, engineers: engineers.filter(Boolean).map((u) => ({ _id: u!._id, name: u!.name ?? u!.email ?? "" })), qualificationWarnings };
  },
});

async function checkEngineers(ctx: MutationCtx, orgId: Id<"organizations">, ids: Id<"users">[]) {
  if (ids.length > 20) fail("At most 20 engineers per job");
  for (const id of ids) {
    const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", id)).unique();
    if (!m || m.status !== "active" || m.role === "client_user") fail("Assigned engineers must be active team members");
  }
  return [...new Set(ids)];
}
function checkWindow(start?: number, end?: number) {
  if (start !== undefined && end !== undefined && end < start) fail("Scheduled end is before the start");
}

export const create = mutation({
  args: {
    siteId: v.id("sites"), type: jobType, disciplines: v.array(discipline), title: v.string(), description: v.optional(v.string()),
    priority: v.optional(priority), assignedEngineerIds: v.optional(v.array(v.id("users"))), scheduledStart: v.optional(v.number()), scheduledEnd: v.optional(v.number()),
    purchaseOrderNumber: v.optional(v.string()), scheduleId: v.optional(v.id("serviceSchedules")), quoteId: v.optional(v.id("quotes")),
  },
  handler: async (ctx, a) => {
    const { doc: site, user } = await loadForMember(ctx, a.siteId, "Site", OFFICE);
    if (site.status !== "active") fail("Site is archived");
    if (!a.disciplines.length) fail("Pick at least one discipline");
    checkWindow(a.scheduledStart, a.scheduledEnd);
    if (a.scheduleId) {
      const s = await inOrg(ctx, a.scheduleId, site.orgId, "Service schedule");
      if (s.siteId !== site._id) fail("That schedule belongs to another site");
    }
    if (a.quoteId) {
      const q = await inOrg(ctx, a.quoteId, site.orgId, "Quote");
      if (q.clientId !== site.clientId) fail("That quote belongs to another client");
    }
    const engineers = await checkEngineers(ctx, site.orgId, a.assignedEngineerIds ?? []);
    return await insertJob(ctx, site, user._id, { ...a, assignedEngineerIds: engineers, status: a.scheduledStart ? "scheduled" : "draft" });
  },
});

export async function insertJob(
  ctx: MutationCtx, site: Doc<"sites">, userId: Id<"users">,
  a: { type: Doc<"jobs">["type"]; disciplines: Doc<"jobs">["disciplines"]; title: string; description?: string; priority?: Doc<"jobs">["priority"]; assignedEngineerIds: Id<"users">[]; scheduledStart?: number; scheduledEnd?: number; purchaseOrderNumber?: string; scheduleId?: Id<"serviceSchedules">; quoteId?: Id<"quotes">; status: Status; autoCreated?: boolean; scheduleDueAt?: number },
  opts: { system?: boolean } = {},
) {
  const now = Date.now();
  const jobNumber = await nextNumber(ctx, site.orgId, "job", "JOB-");
  const id = await ctx.db.insert("jobs", {
    orgId: site.orgId, clientId: site.clientId, siteId: site._id, jobNumber, type: a.type, disciplines: [...new Set(a.disciplines)],
    title: str(a.title, "Job title", 200), description: optStr(a.description, "Description", 5000), priority: a.priority ?? "normal", status: a.status,
    scheduleId: a.scheduleId, quoteId: a.quoteId, assignedEngineerIds: a.assignedEngineerIds, scheduledStart: a.scheduledStart, scheduledEnd: a.scheduledEnd,
    purchaseOrderNumber: optStr(a.purchaseOrderNumber, "PO number", 60), createdBy: userId, createdAt: now, updatedAt: now,
    ...(a.autoCreated ? { autoCreated: true, scheduleDueAt: a.scheduleDueAt } : {}),
  });
  await audit(ctx, site.orgId, opts.system ? undefined : userId, "job.created", "job", id, { jobNumber, ...(opts.system ? { system: "service schedule automation" } : {}) });
  return id;
}

export const update = mutation({
  args: { jobId: v.id("jobs"), type: v.optional(jobType), disciplines: v.optional(v.array(discipline)), title: v.optional(v.string()), description: v.optional(v.string()), priority: v.optional(priority), scheduledStart: v.optional(v.number()), scheduledEnd: v.optional(v.number()), purchaseOrderNumber: v.optional(v.string()) },
  handler: async (ctx, { jobId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, jobId, "Job", OFFICE);
    if (LOCKED.includes(doc.status)) fail(`A ${doc.status} job can't be edited`);
    if (a.disciplines && !a.disciplines.length) fail("Pick at least one discipline");
    checkWindow(a.scheduledStart ?? doc.scheduledStart, a.scheduledEnd ?? doc.scheduledEnd);
    const patch = defined({
      type: a.type, disciplines: a.disciplines && [...new Set(a.disciplines)], title: a.title === undefined ? undefined : str(a.title, "Job title", 200),
      description: optStr(a.description, "Description", 5000), priority: a.priority, scheduledStart: a.scheduledStart, scheduledEnd: a.scheduledEnd,
      purchaseOrderNumber: optStr(a.purchaseOrderNumber, "PO number", 60),
      status: doc.status === "draft" && a.scheduledStart ? ("scheduled" as const) : undefined,
    });
    await ctx.db.patch(jobId, { ...patch, updatedAt: Date.now() });
    await audit(ctx, doc.orgId, user._id, "job.updated", "job", jobId, patch);
  },
});

export const assignEngineers = mutation({
  args: { jobId: v.id("jobs"), engineerIds: v.array(v.id("users")) },
  handler: async (ctx, { jobId, engineerIds }) => {
    const { doc, user } = await loadForMember(ctx, jobId, "Job", OFFICE);
    if (LOCKED.includes(doc.status)) fail(`A ${doc.status} job can't be reassigned`);
    const ids = await checkEngineers(ctx, doc.orgId, engineerIds);
    const tz = (await ctx.db.get(doc.orgId))?.timezone;
    const warnings = await assignmentWarnings(ctx, doc.orgId, ids, doc.disciplines, doc.scheduledStart ?? Date.now(), tz);
    await ctx.db.patch(jobId, { assignedEngineerIds: ids, updatedAt: Date.now() });
    await audit(ctx, doc.orgId, user._id, "job.assigned", "job", jobId, { from: doc.assignedEngineerIds, to: ids, ...(warnings.length ? { qualificationWarnings: warnings.map((w) => w.message) } : {}) });
    /** Assignment always succeeds; `warnings` lists engineers not qualified for the job's disciplines. */
    return { warnings };
  },
});

/**
 * Office: preview qualification warnings before assigning (e.g. while picking engineers in the job form).
 * `at` = planned visit date (defaults to now). Returns [] when everyone is qualified.
 */
export const checkAssignment = query({
  args: { orgId: v.id("organizations"), engineerIds: v.array(v.id("users")), disciplines: v.array(discipline), at: v.optional(v.number()) },
  handler: async (ctx, { orgId, engineerIds, disciplines, at }) => {
    await requireMember(ctx, orgId, OFFICE);
    if (engineerIds.length > 20) fail("At most 20 engineers per job");
    const tz = (await ctx.db.get(orgId))?.timezone;
    const ids: Id<"users">[] = [];
    for (const id of new Set(engineerIds)) {
      const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", id)).unique();
      if (m && m.status === "active" && m.role !== "client_user") ids.push(id);
    }
    return { warnings: await assignmentWarnings(ctx, orgId, ids, disciplines, at ?? Date.now(), tz) };
  },
});

/**
 * Change status. Office can make any allowed change; an assigned engineer can start, hold and complete.
 * Completing a job advances its linked service schedule (next due = completion date + frequency).
 */
export const setStatus = mutation({
  args: { jobId: v.id("jobs"), status: jobStatus, completedAt: v.optional(v.number()), reason: v.optional(v.string()) },
  handler: async (ctx, { jobId, status, completedAt, reason }) => {
    const { doc, user, membership } = await loadForMember(ctx, jobId, "Job", STAFF);
    await applyStatus(ctx, doc, status, user._id, membership.role, { completedAt, reason });
  },
});

export async function applyStatus(ctx: MutationCtx, doc: Doc<"jobs">, status: Status, userId: Id<"users">, role: Doc<"memberships">["role"], opts: { completedAt?: number; reason?: string } = {}) {
  if (doc.status === status) return;
  if (!TRANSITIONS[doc.status].includes(status)) fail(`Can't change a job from ${doc.status} to ${status}`);
  if (role === "engineer") {
    if (!doc.assignedEngineerIds.includes(userId)) fail("You're not assigned to this job");
    if (!["in_progress", "on_hold", "completed"].includes(status)) fail("Engineers can only start, pause or complete jobs");
  }
  const now = Date.now();
  const completedAt = status === "completed" ? Math.min(opts.completedAt ?? now, now) : undefined;
  await ctx.db.patch(doc._id, { status, completedAt: status === "completed" ? completedAt : status === "in_progress" ? undefined : doc.completedAt, updatedAt: now });
  await audit(ctx, doc.orgId, userId, "job.status", "job", doc._id, { from: doc.status, to: status, reason: optStr(opts.reason, "Reason", 500) });
  if (status === "completed") {
    if (doc.scheduleId) {
      const s = await ctx.db.get(doc.scheduleId);
      if (s) await advanceSchedule(ctx, s, completedAt!, userId, `job ${doc.jobNumber} completed`);
    }
    // Remedial job done: move linked defects to resolved.
    if (doc.type === "remedial" && doc.quoteId) {
      const q = await ctx.db.get(doc.quoteId);
      for (const did of q?.defectIds ?? []) {
        const d = await ctx.db.get(did);
        if (d && ["open", "quoted", "scheduled", "in_progress"].includes(d.status)) await ctx.db.patch(did, { status: "resolved", resolvedAt: completedAt, resolvedBy: userId, remedialJobId: doc._id });
      }
    }
  }
}
