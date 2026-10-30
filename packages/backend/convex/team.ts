import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, QueryCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireMember, requireUser } from "./lib/auth";
import { audit, fail, email as cleanEmail, optStr, sha256Hex, DAY, MANAGERS, OFFICE, loadDoc } from "./lib/util";
import { newPublicToken } from "./lib/tokens";
import { queueEmail, appUrl } from "./lib/notify";

const staffRole = v.union(v.literal("owner"), v.literal("admin"), v.literal("office"), v.literal("engineer"));
const INVITE_DAYS = 14;

/** Team members with name/email (owner/admin/office). Client portal users are listed under portal. */
export const list = query({
  args: { orgId: v.id("organizations"), includeDisabled: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, includeDisabled }) => {
    await requireMember(ctx, orgId, OFFICE);
    const ms = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(500);
    const rows = [];
    for (const m of ms) {
      if (m.role === "client_user" || (!includeDisabled && m.status === "disabled")) continue;
      const u = await ctx.db.get(m.userId);
      rows.push({ membershipId: m._id, userId: m.userId, name: u?.name ?? null, email: u?.email ?? null, role: m.role, status: m.status, createdAt: m.createdAt });
    }
    return rows;
  },
});

/** Active engineers (for job assignment pickers). Any staff member. */
export const listEngineers = query({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, ["owner", "admin", "office", "engineer"]);
    const ms = await ctx.db.query("memberships").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(500);
    const out = [];
    for (const m of ms) {
      if (m.status !== "active" || m.role === "client_user") continue;
      const u = await ctx.db.get(m.userId);
      out.push({ userId: m.userId, name: u?.name ?? u?.email ?? "", role: m.role });
    }
    return out;
  },
});

/**
 * Owner/admin: invite a staff member by email. Returns the invite link (shown once);
 * an invite email is also queued (dry run until email sending is configured).
 */
export const invite = mutation({
  args: { orgId: v.id("organizations"), email: v.string(), name: v.optional(v.string()), role: staffRole },
  handler: async (ctx, { orgId, email, name, role }) => {
    const { user, membership } = await requireMember(ctx, orgId, MANAGERS);
    if (role === "owner" && membership.role !== "owner") fail("Only an owner can invite another owner");
    const e = cleanEmail(email);
    const existingUser = await ctx.db.query("users").withIndex("email", (q) => q.eq("email", e)).first();
    if (existingUser) {
      const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", existingUser._id)).unique();
      if (m && m.status === "active") fail("This person is already a member");
    }
    const pending = await ctx.db.query("teamInvitations").withIndex("by_org_and_email", (q) => q.eq("orgId", orgId).eq("email", e)).take(20);
    for (const p of pending) if (p.status === "pending") await ctx.db.patch(p._id, { status: "revoked" });
    const token = newPublicToken(32);
    const now = Date.now();
    const id = await ctx.db.insert("teamInvitations", {
      orgId, email: e, name: optStr(name, "Name", 120), role, tokenHash: await sha256Hex(token), status: "pending", invitedBy: user._id, expiresAt: now + INVITE_DAYS * DAY, createdAt: now,
    });
    const org = (await ctx.db.get(orgId))!;
    const link = appUrl(`invite/team/${token}`);
    await queueEmail(ctx, org, {
      to: e, type: "team_invite", recipientType: "org", greetingName: name,
      subject: `${user.name ?? "A colleague"} invited you to join ${org.name}`,
      heading: `Join ${org.name}`,
      statusLabel: "Invitation",
      paragraphs: [`You have been invited to join ${org.name} as ${{ owner: "an owner", admin: "an administrator", office: "office staff", engineer: "an engineer" }[role]}.`, `This invitation expires in ${INVITE_DAYS} days.`],
      cta: { label: "Accept invitation", url: link },
    });
    await audit(ctx, orgId, user._id, "team.invited", "teamInvitation", id, { email: e, role });
    return { invitationId: id, inviteUrl: link, token };
  },
});

export const listInvitations = query({
  args: { orgId: v.id("organizations"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, paginationOpts }) => {
    await requireMember(ctx, orgId, MANAGERS);
    const page = await ctx.db.query("teamInvitations").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", "pending")).order("desc").paginate(paginationOpts);
    return { ...page, page: page.page.map(({ tokenHash, ...i }) => ({ ...i, expired: i.expiresAt < Date.now() })) };
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("teamInvitations") },
  handler: async (ctx, { invitationId }) => {
    const inv = await loadDoc(ctx, invitationId, "Invitation");
    const { user } = await requireMember(ctx, inv.orgId, MANAGERS);
    if (inv.status !== "pending") fail("Invitation is no longer pending");
    await ctx.db.patch(invitationId, { status: "revoked" });
    await audit(ctx, inv.orgId, user._id, "team.invite_revoked", "teamInvitation", invitationId);
  },
});

/** Signed-in user accepts a staff invitation (their account email must match the invite). */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    const hash = await sha256Hex(token.trim());
    const invite = await ctx.db.query("teamInvitations").withIndex("by_token_hash", (q) => q.eq("tokenHash", hash)).unique();
    if (!invite || invite.status !== "pending") fail("This invitation is not valid");
    if (invite.expiresAt < Date.now()) {
      await ctx.db.patch(invite._id, { status: "expired" });
      fail("This invitation has expired; ask for a new one");
    }
    if ((user.email ?? "").toLowerCase() !== invite.email) fail(`This invitation was sent to ${invite.email}. Sign in with that email address.`);
    const now = Date.now();
    const existing = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", invite.orgId).eq("userId", user._id)).unique();
    if (existing?.role === "client_user" && existing.status === "active") fail("This account is a client portal user for this company; use a different email for staff access");
    if (existing) await ctx.db.patch(existing._id, { role: invite.role, status: "active", clientId: undefined });
    else await ctx.db.insert("memberships", { orgId: invite.orgId, userId: user._id, role: invite.role, status: "active", createdAt: now });
    await ctx.db.patch(invite._id, { status: "accepted", acceptedAt: now, acceptedUserId: user._id });
    if (!user.name && invite.name) await ctx.db.patch(user._id, { name: invite.name });
    if (!user.defaultOrgId) await ctx.db.patch(user._id, { defaultOrgId: invite.orgId });
    await audit(ctx, invite.orgId, user._id, "team.invite_accepted", "membership", user._id, { role: invite.role });
    return { orgId: invite.orgId, role: invite.role };
  },
});

async function activeOwners(ctx: QueryCtx, orgId: Id<"organizations">): Promise<number> {
  const owners = await ctx.db.query("memberships").withIndex("by_org_and_role", (q) => q.eq("orgId", orgId).eq("role", "owner")).take(50);
  return owners.filter((m) => m.status === "active").length;
}

/** Owner/admin: change a staff member's role. Only owners can grant/remove owner; the last owner can't be demoted. */
export const updateRole = mutation({
  args: { membershipId: v.id("memberships"), role: staffRole },
  handler: async (ctx, { membershipId, role }) => {
    const target = await loadDoc(ctx, membershipId, "Member");
    const { user, membership } = await requireMember(ctx, target.orgId, MANAGERS);
    if (target.role === "client_user") fail("Client portal users are managed from the portal section");
    if (target.userId === user._id) fail("You can't change your own role");
    if ((role === "owner" || target.role === "owner") && membership.role !== "owner") fail("Only an owner can change owner roles");
    if (target.role === "owner" && role !== "owner" && (await activeOwners(ctx, target.orgId)) <= 1) fail("The company must keep at least one owner");
    await ctx.db.patch(membershipId, { role });
    await audit(ctx, target.orgId, user._id, "team.role_changed", "membership", membershipId, { from: target.role, to: role });
  },
});

/** Owner/admin: deactivate (or reactivate) a staff member. Deactivated users lose access immediately. */
export const setActive = mutation({
  args: { membershipId: v.id("memberships"), active: v.boolean() },
  handler: async (ctx, { membershipId, active }) => {
    const target = await loadDoc(ctx, membershipId, "Member");
    const { user, membership } = await requireMember(ctx, target.orgId, MANAGERS);
    if (target.userId === user._id) fail("You can't deactivate yourself");
    if (target.role === "owner" && membership.role !== "owner") fail("Only an owner can deactivate an owner");
    if (!active && target.role === "owner" && (await activeOwners(ctx, target.orgId)) <= 1) fail("The company must keep at least one owner");
    await ctx.db.patch(membershipId, { status: active ? "active" : "disabled" });
    await audit(ctx, target.orgId, user._id, active ? "team.reactivated" : "team.deactivated", "membership", membershipId);
  },
});
