import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { addFrequency, audit, DAY } from "./util";
import { closeStaleAutoJobs } from "./autoJobs";

/**
 * Roll a service schedule forward after the work was done on `completedAt`:
 * nextDueAt = completedAt + frequency. Computed from the completion date (not the old due date),
 * so calling it twice for the same visit (job completed + certificate issued) is harmless.
 */
export async function advanceSchedule(
  ctx: MutationCtx,
  s: Doc<"serviceSchedules">,
  completedAt: number,
  actor: Id<"users"> | undefined,
  reason: string,
  nextDueAt?: number,
) {
  if (s.status === "ended") return false;
  if (s.lastCompletedAt !== undefined && completedAt < s.lastCompletedAt) return false;
  const next = nextDueAt ?? addFrequency(completedAt, s.frequency);
  if (s.lastCompletedAt === completedAt && s.nextDueAt === next) return false;
  await ctx.db.patch(s._id, { lastCompletedAt: completedAt, nextDueAt: next });
  await audit(ctx, s.orgId, actor, "schedule.advanced", "serviceSchedule", s._id, { reason, from: s.nextDueAt, to: next });
  await closeStaleAutoJobs(ctx, s, next, actor, `schedule advanced: ${reason}`);
  return true;
}

/**
 * After a certificate is issued, advance active schedules for the same site + discipline that
 * were due around the inspection (due within 90 days after, or overdue), plus the job's own schedule.
 */
export async function advanceSchedulesForCertificate(ctx: MutationCtx, cert: Doc<"certificates">, actor: Id<"users">) {
  const job = cert.jobId ? await ctx.db.get(cert.jobId) : null;
  const schedules = await ctx.db.query("serviceSchedules").withIndex("by_site", (q) => q.eq("siteId", cert.siteId)).take(200);
  let n = 0;
  for (const s of schedules) {
    const linked = job?.scheduleId === s._id;
    const matches = s.status === "active" && s.discipline === cert.discipline && (!s.assetId || cert.assetIds.includes(s.assetId));
    if (!linked && !(matches && s.nextDueAt <= cert.inspectionDate + 90 * DAY)) continue;
    if (await advanceSchedule(ctx, s, cert.inspectionDate, actor, `certificate ${cert.certificateNumber} issued`)) n++;
  }
  return n;
}
