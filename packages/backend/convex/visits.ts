import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeSite } from "./lib/auth";
import { applyStatus } from "./jobs";
import { audit, fail, optStr, loadDoc, loadForMember, makeSignature, signatureInputV, geoV, STAFF, ANY } from "./lib/util";

/** Visits for a job (with signature image URLs). */
export const listByJob = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, { jobId }) => {
    const { doc: job, membership } = await loadForMember(ctx, jobId, "Job", ANY);
    const site = await loadDoc(ctx, job.siteId, "Site");
    if (!(await canSeeSite(ctx, membership, site))) fail("Job not found");
    const visits = await ctx.db.query("visits").withIndex("by_job", (q) => q.eq("jobId", jobId)).take(100);
    return Promise.all(visits.map(async (vi) => ({
      ...vi,
      engineerSignatureUrl: vi.engineerSignature?.signatureImageId ? await ctx.storage.getUrl(vi.engineerSignature.signatureImageId) : null,
      customerSignatureUrl: vi.customerSignature?.signatureImageId ? await ctx.storage.getUrl(vi.customerSignature.signatureImageId) : null,
    })));
  },
});

/** Upload URL for a signature image or photo captured during a visit (staff). */
export const generateUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, STAFF);
    return await ctx.storage.generateUploadUrl();
  },
});

function checkGeo(g?: { lat: number; lng: number }) {
  if (g && (Math.abs(g.lat) > 90 || Math.abs(g.lng) > 180)) fail("Invalid GPS position");
}
async function requireOnJob(ctx: MutationCtx, job: Doc<"jobs">, userId: Id<"users">, role: Doc<"memberships">["role"]) {
  if (role === "engineer" && !job.assignedEngineerIds.includes(userId)) fail("You're not assigned to this job");
}

/**
 * Engineer arrives on site. Idempotent on clientGeneratedId (offline). Moves the job to in_progress.
 * Office staff may start a visit on behalf of an assigned engineer via `engineerId`.
 */
export const start = mutation({
  args: { jobId: v.id("jobs"), geo: v.optional(geoV), arrivedAt: v.optional(v.number()), engineerId: v.optional(v.id("users")), clientGeneratedId: v.optional(v.string()), deviceId: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { doc: job, user, membership } = await loadForMember(ctx, a.jobId, "Job", STAFF);
    if (a.clientGeneratedId) {
      const dupes = await ctx.db.query("visits").withIndex("by_client_generated_id", (q) => q.eq("clientGeneratedId", a.clientGeneratedId)).take(5);
      const d = dupes.find((x) => x.jobId === a.jobId);
      if (d) return d._id;
    }
    if (["completed", "invoiced", "cancelled", "draft"].includes(job.status)) fail(`Can't start a visit on a ${job.status} job`);
    await requireOnJob(ctx, job, user._id, membership.role);
    const engineerId = membership.role === "engineer" ? user._id : (a.engineerId ?? user._id);
    if (!job.assignedEngineerIds.includes(engineerId) && membership.role === "engineer") fail("You're not assigned to this job");
    checkGeo(a.geo);
    const now = Date.now();
    const open = await ctx.db.query("visits").withIndex("by_engineer_and_status", (q) => q.eq("engineerId", engineerId).eq("status", "on_site")).take(20);
    if (open.some((x) => x.jobId === a.jobId)) fail("There's already an open visit for this job; finish it first");
    const id = await ctx.db.insert("visits", {
      orgId: job.orgId, jobId: job._id, siteId: job.siteId, engineerId, status: "on_site", arrivedAt: Math.min(a.arrivedAt ?? now, now), arrivalGeo: a.geo,
      clientGeneratedId: a.clientGeneratedId, deviceId: a.deviceId, capturedAt: a.arrivedAt, syncedAt: now,
    });
    if (job.status === "scheduled" || job.status === "on_hold") await applyStatus(ctx, job, "in_progress", user._id, membership.role);
    await audit(ctx, job.orgId, user._id, "visit.started", "visit", id, { geo: a.geo });
    return id;
  },
});

/** Engineer leaves site: notes plus engineer/customer signatures. Optionally completes the job. */
export const finish = mutation({
  args: {
    visitId: v.id("visits"), notes: v.optional(v.string()), departedAt: v.optional(v.number()), geo: v.optional(geoV),
    engineerSignature: v.optional(signatureInputV), customerSignature: v.optional(signatureInputV), completeJob: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const { doc: visit, user, membership } = await loadForMember(ctx, a.visitId, "Visit", STAFF);
    if (visit.status === "completed") return visit._id; // replayed offline sync
    if (visit.status === "aborted") fail("This visit was aborted");
    if (membership.role === "engineer" && visit.engineerId !== user._id) fail("Only the visiting engineer can finish this visit");
    checkGeo(a.geo);
    const now = Date.now();
    const departedAt = Math.min(a.departedAt ?? now, now);
    if (visit.arrivedAt && departedAt < visit.arrivedAt) fail("Departure is before arrival");
    await ctx.db.patch(visit._id, {
      status: "completed", departedAt, notes: optStr(a.notes, "Notes", 10000) ?? visit.notes,
      engineerSignature: a.engineerSignature ? await makeSignature(ctx, a.engineerSignature, user._id) : visit.engineerSignature,
      customerSignature: a.customerSignature ? await makeSignature(ctx, a.customerSignature) : visit.customerSignature,
    });
    await audit(ctx, visit.orgId, user._id, "visit.finished", "visit", visit._id, { departGeo: a.geo, signed: { engineer: !!a.engineerSignature, customer: !!a.customerSignature } });
    if (a.completeJob) {
      const job = await loadDoc(ctx, visit.jobId, "Job");
      await applyStatus(ctx, job, "completed", user._id, membership.role, { completedAt: departedAt });
    }
    return visit._id;
  },
});

/** Abort a visit (no access, unsafe, etc.). */
export const abort = mutation({
  args: { visitId: v.id("visits"), reason: v.string() },
  handler: async (ctx, { visitId, reason }) => {
    const { doc: visit, user, membership } = await loadForMember(ctx, visitId, "Visit", STAFF);
    if (visit.status === "completed" || visit.status === "aborted") fail(`Visit is already ${visit.status}`);
    if (membership.role === "engineer" && visit.engineerId !== user._id) fail("Only the visiting engineer can abort this visit");
    const why = optStr(reason, "Reason", 1000);
    if (!why) fail("Reason is required");
    await ctx.db.patch(visitId, { status: "aborted", departedAt: Date.now(), notes: [visit.notes, `Aborted: ${why}`].filter(Boolean).join("\n") });
    await audit(ctx, visit.orgId, user._id, "visit.aborted", "visit", visitId, { reason: why });
  },
});


