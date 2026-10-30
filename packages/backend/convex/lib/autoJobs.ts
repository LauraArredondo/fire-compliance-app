import { MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { insertJob } from "../jobs";
import { assignmentWarnings } from "./qualifications";
import { disciplineLabel, formatDate } from "./labels";
import { audit, DAY } from "./util";

export const JOB_AUTOMATION_DEFAULTS = { enabled: true, leadDays: 30, notifyOffice: true };
export type JobAutomationSettings = typeof JOB_AUTOMATION_DEFAULTS;

export function jobAutomationFor(org: Doc<"organizations">): JobAutomationSettings {
  const s = org.jobAutomation ?? {};
  return { enabled: s.enabled ?? true, leadDays: s.leadDays ?? 30, notifyOffice: s.notifyOffice ?? true };
}

const OPEN: Doc<"jobs">["status"][] = ["draft", "scheduled", "in_progress", "on_hold"];

export type AutoJobResult = { created: Id<"jobs">[]; skipped: Record<string, number>; disabled?: boolean };

/**
 * Daily: create one routine job (status "draft" = unscheduled) per active schedule with autoCreateJob on,
 * whose next due date is within the lead window. Deduped per schedule + due cycle (`jobs.scheduleDueAt`):
 * a job for the same cycle in any status (incl. cancelled) or an open manual job linked to the schedule blocks it.
 * When the job is completed (or a certificate is issued) the schedule advances and the next cycle gets a new job.
 */
export async function autoCreateJobsForOrg(ctx: MutationCtx, org: Doc<"organizations">, now: number): Promise<AutoJobResult> {
  const cfg = jobAutomationFor(org);
  const skipped: Record<string, number> = { already_has_job: 0, manual_job_open: 0, site_archived: 0, outside_window: 0 };
  if (!cfg.enabled) return { created: [], skipped, disabled: true };
  const owner = (await ctx.db.query("memberships").withIndex("by_org_and_role", (q) => q.eq("orgId", org._id).eq("role", "owner")).take(10)).find((m) => m.status === "active");
  if (!owner) return { created: [], skipped };
  const tz = org.timezone || "Europe/London";
  const schedules = await ctx.db.query("serviceSchedules").withIndex("by_org_and_next_due", (q) => q.eq("orgId", org._id).lte("nextDueAt", now + 366 * DAY)).take(2000);
  const created: Id<"jobs">[] = [];
  for (const s of schedules) {
    if (s.status !== "active" || !s.autoCreateJob) continue;
    const lead = s.autoJobLeadDays ?? cfg.leadDays;
    if (s.nextDueAt > now + lead * DAY) { skipped.outside_window++; continue; }
    const linked = await ctx.db.query("jobs").withIndex("by_schedule", (q) => q.eq("scheduleId", s._id)).take(500);
    if (linked.some((j) => j.scheduleDueAt === s.nextDueAt)) { skipped.already_has_job++; continue; }
    if (linked.some((j) => j.scheduleDueAt === undefined && OPEN.includes(j.status))) { skipped.manual_job_open++; continue; }
    const site = await ctx.db.get(s.siteId);
    if (!site || site.status !== "active") { skipped.site_archived++; continue; }

    let engineers: Id<"users">[] = [];
    if (s.defaultEngineerId) {
      const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", org._id).eq("userId", s.defaultEngineerId!)).unique();
      if (m && m.status === "active" && m.role !== "client_user") engineers = [s.defaultEngineerId];
    }
    const overdue = s.nextDueAt < now;
    const disc = disciplineLabel(s.discipline);
    const id = await insertJob(ctx, site, owner.userId, {
      type: "routine_service", disciplines: [s.discipline], title: `${s.name} - ${site.name}`.slice(0, 200),
      description: [
        `Routine ${disc} service ${overdue ? "was due" : "due"} ${formatDate(s.nextDueAt, tz)} (every ${s.frequency.interval} ${s.frequency.unit}${s.frequency.interval === 1 ? "" : "s"}).`,
        s.contractReference ? `Contract ref: ${s.contractReference}.` : "",
        "Created automatically from the service schedule; schedule a visit date to confirm.",
      ].filter(Boolean).join(" "),
      priority: overdue ? "high" : "normal", assignedEngineerIds: engineers, scheduleId: s._id, status: "draft",
      autoCreated: true, scheduleDueAt: s.nextDueAt,
    }, { system: true });
    const warnings = engineers.length ? await assignmentWarnings(ctx, org._id, engineers, [s.discipline], s.nextDueAt, tz) : [];
    await audit(ctx, org._id, undefined, "job.auto_created", "job", id, {
      scheduleId: s._id, scheduleDueAt: s.nextDueAt, leadDays: lead, engineerIds: engineers,
      defaultEngineerSkipped: s.defaultEngineerId && !engineers.length ? "not an active team member" : undefined,
      qualificationWarnings: warnings.length ? warnings.map((w) => w.message) : undefined,
    });
    created.push(id);
  }
  if (created.length && cfg.notifyOffice) {
    await ctx.db.insert("reminders", {
      orgId: org._id, sourceType: "jobs_auto_created", jobIds: created, dedupeKey: `autojobs:${org._id}:${now}`, stage: "summary",
      title: `${created.length} routine job${created.length === 1 ? "" : "s"} created automatically`, dueAt: now, sendAt: now, audience: "org", status: "pending", createdAt: now,
    });
  }
  return { created, skipped };
}

/**
 * The schedule moved on to a new cycle (job completed, certificate issued, or due date edited).
 * Unscheduled (draft) auto jobs for older cycles are no longer needed and are cancelled;
 * scheduled / in-progress ones are left for the office to decide.
 */
export async function closeStaleAutoJobs(ctx: MutationCtx, s: Doc<"serviceSchedules">, newDueAt: number, actor: Id<"users"> | undefined, reason: string) {
  const linked = await ctx.db.query("jobs").withIndex("by_schedule", (q) => q.eq("scheduleId", s._id)).take(500);
  let n = 0;
  for (const j of linked) {
    if (!j.autoCreated || j.status !== "draft" || j.scheduleDueAt === undefined || j.scheduleDueAt >= newDueAt) continue;
    await ctx.db.patch(j._id, { status: "cancelled", updatedAt: Date.now() });
    await audit(ctx, j.orgId, actor, "job.auto_cancelled", "job", j._id, { reason, scheduleDueAt: j.scheduleDueAt, newDueAt });
    n++;
  }
  return n;
}
