import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import { QueryCtx, MutationCtx } from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";

type Ctx = QueryCtx | MutationCtx;
type Role = Doc<"memberships">["role"];

/** The signed-in user (via Convex Auth), or null. */
export async function getCurrentUser(ctx: Ctx): Promise<Doc<"users"> | null> {
  const userId = await getAuthUserId(ctx);
  if (userId === null) return null;
  return await ctx.db.get(userId);
}

/** Resolve the signed-in user, or throw. */
export async function requireUser(ctx: Ctx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new ConvexError("Not authenticated");
  return user;
}

/** Ensure the signed-in user is an active member of the org (optionally with one of `roles`). */
export async function requireMember(
  ctx: Ctx,
  orgId: Id<"organizations">,
  roles?: Role[],
): Promise<{ user: Doc<"users">; membership: Doc<"memberships"> }> {
  const user = await requireUser(ctx);
  const membership = await ctx.db
    .query("memberships")
    .withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", user._id))
    .unique();
  if (!membership || membership.status !== "active") throw new ConvexError("Not a member of this organization");
  if (roles && !roles.includes(membership.role)) throw new ConvexError("Insufficient permissions");
  return { user, membership };
}

/** Staff can see everything in the org; client users only their own client's records. */
export function canSeeClient(membership: Doc<"memberships">, clientId: Id<"clients">): boolean {
  if (membership.role !== "client_user") return true;
  return membership.clientId === clientId;
}

/**
 * Site-level visibility: office+ see all; engineers only sites of their assigned jobs; client users must belong to the site's client and,
 * if their portal access is limited to specific sites, the site must be one of them.
 */
export async function canSeeSite(ctx: Ctx, membership: Doc<"memberships">, site: Doc<"sites">): Promise<boolean> {
  if (membership.role === "engineer") return await engineerHasSite(ctx, membership.orgId, membership.userId, site._id);
  if (membership.role !== "client_user") return true;
  if (membership.clientId !== site.clientId) return false;
  const access = await ctx.db
    .query("portalAccess")
    .withIndex("by_user_and_client", (q) => q.eq("userId", membership.userId).eq("clientId", site.clientId))
    .unique();
  if (!access || access.status !== "active") return false;
  return !access.siteIds?.length || access.siteIds.includes(site._id);
}

/* ---------------- role scoping (engineers) ---------------- */
/*
 * owner/admin/office: everything in their org.
 * engineer: only jobs they're assigned to, and the sites of those jobs (and records on those sites).
 * client_user: portal rules (canSeeClient / canSeeSite) as before.
 */

export const OFFICE_ROLES: Role[] = ["owner", "admin", "office"];
export const NOT_ASSIGNED_JOB = "You're not assigned to this job";
export const NOT_ASSIGNED_SITE = "You're not assigned to a job at this site";

export function isOfficeOrAbove(membership: Doc<"memberships">): boolean {
  return OFFICE_ROLES.includes(membership.role);
}

/** Require an active owner/admin/office membership. Throws "Insufficient permissions" otherwise. */
export async function requireOfficeOrAbove(ctx: Ctx, orgId: Id<"organizations">) {
  return await requireMember(ctx, orgId, OFFICE_ROLES);
}

/** Engineer has at least one job (any status) at the site. */
export async function engineerHasSite(ctx: Ctx, orgId: Id<"organizations">, userId: Id<"users">, siteId: Id<"sites">): Promise<boolean> {
  const row = await ctx.db
    .query("jobAssignments")
    .withIndex("by_org_and_user_and_site", (q) => q.eq("orgId", orgId).eq("userId", userId).eq("siteId", siteId))
    .first();
  return row !== null;
}

/** Can this membership see this site? Office+ all, engineer assigned-job sites, client_user portal rules. */
export async function canSeeSiteAs(ctx: Ctx, membership: Doc<"memberships">, site: Doc<"sites">): Promise<boolean> {
  if (site.orgId !== membership.orgId) return false;
  return await canSeeSite(ctx, membership, site);
}

/** Throw unless an engineer is assigned to a job at the site (no-op for other roles). */
export async function requireSiteScope(ctx: Ctx, membership: Doc<"memberships">, siteId: Id<"sites">) {
  if (membership.role === "engineer" && !(await engineerHasSite(ctx, membership.orgId, membership.userId, siteId))) throw new ConvexError(NOT_ASSIGNED_SITE);
}

/** Throw unless an engineer is assigned to the job (no-op for other roles). */
export function requireJobScope(membership: Doc<"memberships">, job: Doc<"jobs">) {
  if (membership.role === "engineer" && !job.assignedEngineerIds.includes(membership.userId)) throw new ConvexError(NOT_ASSIGNED_JOB);
}

/** Signed-in user's access to a site (false if not a member or out of scope). */
export async function canAccessSite(ctx: Ctx, siteId: Id<"sites">): Promise<boolean> {
  const site = await ctx.db.get(siteId);
  if (!site) return false;
  const user = await getCurrentUser(ctx);
  if (!user) return false;
  const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", site.orgId).eq("userId", user._id)).unique();
  if (!m || m.status !== "active") return false;
  return await canSeeSiteAs(ctx, m, site);
}

/** Load a job the signed-in user may see: engineers must be assigned, client users per portal rules. */
export async function requireJobAccess(ctx: Ctx, jobId: Id<"jobs">) {
  const job = await ctx.db.get(jobId);
  if (!job) throw new ConvexError("Job not found");
  const { user, membership } = await requireMember(ctx, job.orgId);
  requireJobScope(membership, job);
  if (membership.role === "client_user") {
    const site = await ctx.db.get(job.siteId);
    if (!canSeeClient(membership, job.clientId) || !site || !(await canSeeSite(ctx, membership, site))) throw new ConvexError("Job not found");
  }
  return { job, user, membership };
}

/** Distinct site ids of the engineer's assigned jobs (signed-in user unless userId given). */
export async function assignedSiteIds(ctx: Ctx, orgId: Id<"organizations">, userId?: Id<"users">): Promise<Id<"sites">[]> {
  const uid = userId ?? (await requireUser(ctx))._id;
  const rows = await ctx.db.query("jobAssignments").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", uid)).take(5000);
  return [...new Set(rows.map((r) => r.siteId))];
}

/** Keep jobAssignments in sync with a job's assignedEngineerIds. Call after insert/patch. */
export async function syncJobAssignments(ctx: MutationCtx, job: Pick<Doc<"jobs">, "_id" | "orgId" | "siteId">, engineerIds: Id<"users">[]) {
  const existing = await ctx.db.query("jobAssignments").withIndex("by_job", (q) => q.eq("jobId", job._id)).take(100);
  const want = new Set<string>(engineerIds);
  for (const r of existing) if (!want.has(r.userId)) await ctx.db.delete(r._id);
  const have = new Set<string>(existing.map((r) => r.userId));
  for (const uid of new Set(engineerIds)) if (!have.has(uid)) await ctx.db.insert("jobAssignments", { orgId: job.orgId, userId: uid, jobId: job._id, siteId: job.siteId });
}
