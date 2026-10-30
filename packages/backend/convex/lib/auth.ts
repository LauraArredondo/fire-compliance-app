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
 * Site-level visibility: staff see all; client users must belong to the site's client and,
 * if their portal access is limited to specific sites, the site must be one of them.
 */
export async function canSeeSite(ctx: Ctx, membership: Doc<"memberships">, site: Doc<"sites">): Promise<boolean> {
  if (membership.role !== "client_user") return true;
  if (membership.clientId !== site.clientId) return false;
  const access = await ctx.db
    .query("portalAccess")
    .withIndex("by_user_and_client", (q) => q.eq("userId", membership.userId).eq("clientId", site.clientId))
    .unique();
  if (!access || access.status !== "active") return false;
  return !access.siteIds?.length || access.siteIds.includes(site._id);
}
