import { query } from "./_generated/server";
import { getCurrentUser } from "./lib/auth";

/** Current signed-in user plus their org memberships; null when signed out. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const memberships = await ctx.db
      .query("memberships")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .take(100);
    const withOrgs = await Promise.all(
      memberships.map(async (m) => {
        const org = await ctx.db.get(m.orgId);
        return {
          membershipId: m._id,
          orgId: m.orgId,
          orgName: org?.name ?? null,
          orgSlug: org?.slug ?? null,
          role: m.role,
          clientId: m.clientId ?? null,
          status: m.status,
        };
      }),
    );
    return {
      _id: user._id,
      name: user.name ?? null,
      email: user.email ?? null,
      phone: user.phone ?? null,
      image: user.image ?? null,
      defaultOrgId: user.defaultOrgId ?? null,
      memberships: withOrgs,
    };
  },
});
