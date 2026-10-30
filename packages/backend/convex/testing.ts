// Internal test-data cleanup for smoke scripts (DEV only).
// Runs only when the deployment env var ALLOW_TEST_CLEANUP=1 (set on dev, never on prod) and only for
// temporary orgs named "Smoke Roles …" whose members are all @smoke.test users.
import { v, ConvexError } from "convex/values";
import { internalMutation } from "./_generated/server";

const ORG_TABLES = ["memberships", "teamInvitations", "engineerQualifications", "clients", "sites", "locations", "assetTypes", "assets", "checklistTemplates", "jobs", "jobAssignments", "visits", "inspections", "readings", "defects", "attachments", "certificateTypes", "numberSequences", "certificates", "serviceSchedules", "reminders", "notifications", "emailSuppressions", "portalInvitations", "portalAccess", "quotes", "quoteLineItems", "invoices", "accountingIntegrations", "auditLog"] as const;
const PROTECTED = ["Smoke Fire uf098y", "Role Probe rolemvvdd0mt"];

export const cleanupSmokeOrg = internalMutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    if (process.env.ALLOW_TEST_CLEANUP !== "1") throw new ConvexError("Test cleanup is disabled on this deployment");
    const org = await ctx.db.get(orgId);
    if (!org) return { deleted: {} };
    if (!org.name.startsWith("Smoke Roles ") || PROTECTED.includes(org.name)) throw new ConvexError("Refusing: not a smoke-roles org");
    const mems = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).collect();
    const users = [];
    for (const m of mems) {
      const u = await ctx.db.get(m.userId);
      if (!u || typeof u.email !== "string" || !u.email.endsWith("@smoke.test")) throw new ConvexError("Refusing: org has a non-test member");
      users.push(u);
    }
    const deleted: Record<string, number> = {};
    const count = (t: string) => { deleted[t] = (deleted[t] ?? 0) + 1; };
    const files = new Set<string>();
    for (const t of ORG_TABLES) {
      const rows = await ctx.db.query(t as any).collect();
      for (const d of rows) {
        if ((d as any).orgId !== orgId) continue;
        for (const m of JSON.stringify(d).match(/"[a-z0-9]{32}"/g) ?? []) files.add(m.slice(1, -1));
        if (t === "certificates") for (const s of await ctx.db.query("verificationScans").collect()) if ((s as any).certificateId === d._id) { await ctx.db.delete(s._id); count("verificationScans"); }
        await ctx.db.delete(d._id); count(t);
      }
    }
    if (org.logoId) files.add(org.logoId);
    await ctx.db.delete(orgId); count("organizations");
    // Users: only if they belong to no other org.
    for (const u of users) {
      const other = await ctx.db.query("memberships").withIndex("by_user", (q) => q.eq("userId", u._id)).first();
      if (other) continue;
      for (const a of await ctx.db.query("authAccounts").collect()) if ((a as any).userId === u._id) {
        for (const c of await ctx.db.query("authVerificationCodes").collect()) if ((c as any).accountId === a._id) { await ctx.db.delete(c._id); count("authVerificationCodes"); }
        await ctx.db.delete(a._id); count("authAccounts");
      }
      for (const s of await ctx.db.query("authSessions").collect()) if ((s as any).userId === u._id) {
        for (const r of await ctx.db.query("authRefreshTokens").collect()) if ((r as any).sessionId === s._id) { await ctx.db.delete(r._id); count("authRefreshTokens"); }
        for (const r of await ctx.db.query("authVerifiers").collect()) if ((r as any).sessionId === s._id) { await ctx.db.delete(r._id); count("authVerifiers"); }
        await ctx.db.delete(s._id); count("authSessions");
      }
      for (const r of await ctx.db.query("authRateLimits").collect()) if ((r as any).identifier === u.email) { await ctx.db.delete(r._id); count("authRateLimits"); }
      await ctx.db.delete(u._id); count("users");
    }
    // Files referenced by this org's rows (uploads are per-org).
    for (const f of await ctx.db.system.query("_storage").collect()) {
      if (!files.has(f._id)) continue;
      await ctx.storage.delete(f._id); count("_storage");
    }
    return { deleted };
  },
});
