import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireMember, requireUser } from "./lib/auth";
import { newPublicToken } from "./lib/tokens";
import { queueEmail, appUrl } from "./lib/notify";
import { audit, fail, email as cleanEmail, optStr, loadDoc, loadForMember, sha256Hex, DAY, OFFICE } from "./lib/util";

const INVITE_DAYS = 14;

async function checkSites(ctx: MutationCtx, clientId: Id<"clients">, siteIds?: Id<"sites">[]) {
  if (!siteIds?.length) return undefined;
  if (siteIds.length > 500) fail("At most 500 sites");
  for (const id of siteIds) {
    const s = await ctx.db.get(id);
    if (!s || s.clientId !== clientId) fail("Site not found for this client");
  }
  return [...new Set(siteIds)];
}

/**
 * Invite a client contact to the read-only portal (office). Returns the invite link once;
 * only a hash of the token is stored. An email is queued (dry run until email is configured).
 */
export const createInvitation = mutation({
  args: { clientId: v.id("clients"), email: v.string(), name: v.optional(v.string()), siteIds: v.optional(v.array(v.id("sites"))) },
  handler: async (ctx, a) => {
    const { doc: client, user } = await loadForMember(ctx, a.clientId, "Client", OFFICE);
    if (client.status !== "active") fail("Client is archived");
    const e = cleanEmail(a.email);
    const siteIds = await checkSites(ctx, client._id, a.siteIds);
    const pending = await ctx.db.query("portalInvitations").withIndex("by_org_and_email", (q) => q.eq("orgId", client.orgId).eq("email", e)).take(50);
    for (const p of pending) if (p.status === "pending" && p.clientId === client._id) await ctx.db.patch(p._id, { status: "revoked" });
    const token = newPublicToken(32);
    const now = Date.now();
    const id = await ctx.db.insert("portalInvitations", {
      orgId: client.orgId, clientId: client._id, email: e, name: optStr(a.name, "Name", 120), tokenHash: await sha256Hex(token), siteIds,
      status: "pending", invitedBy: user._id, expiresAt: now + INVITE_DAYS * DAY, createdAt: now,
    });
    const org = await loadDoc(ctx, client.orgId, "Organization");
    const link = appUrl(`invite/portal/${token}`);
    await queueEmail(ctx, org, {
      to: e, type: "portal_invite", recipientType: "client", clientId: client._id, greetingName: a.name,
      subject: `${org.name} has given you access to your compliance portal`,
      heading: "Your compliance portal",
      paragraphs: [
        `${org.name} has invited you to view certificates, asset registers, defects and upcoming services for ${client.name}.`,
        `The link is valid for ${INVITE_DAYS} days. Sign in or create an account with this email address (${e}) to accept.`,
      ],
      cta: { label: "Open the portal", url: link }, statusLabel: "Portal invitation",
    });
    await audit(ctx, client.orgId, user._id, "portal.invited", "portalInvitation", id, { email: e, clientId: client._id });
    return { invitationId: id, inviteUrl: link, token };
  },
});

/** Pending invitations for the org or one client (office). Paginated. */
export const listInvitations = query({
  args: { orgId: v.id("organizations"), clientId: v.optional(v.id("clients")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, clientId, paginationOpts }) => {
    await requireMember(ctx, orgId, OFFICE);
    const page = clientId
      ? await ctx.db.query("portalInvitations").withIndex("by_client", (q) => q.eq("clientId", clientId)).order("desc").paginate(paginationOpts)
      : await ctx.db.query("portalInvitations").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", "pending")).order("desc").paginate(paginationOpts);
    return { ...page, page: page.page.filter((i) => i.orgId === orgId).map(({ tokenHash, ...i }) => ({ ...i, expired: i.expiresAt < Date.now() })) };
  },
});

export const revokeInvitation = mutation({
  args: { invitationId: v.id("portalInvitations") },
  handler: async (ctx, { invitationId }) => {
    const { doc, user } = await loadForMember(ctx, invitationId, "Invitation", OFFICE);
    if (doc.status !== "pending") fail("Invitation is no longer pending");
    await ctx.db.patch(invitationId, { status: "revoked" });
    await audit(ctx, doc.orgId, user._id, "portal.invite_revoked", "portalInvitation", invitationId);
  },
});

/**
 * Signed-in user accepts a portal invitation: creates a client_user membership for the client
 * and a portalAccess grant (limited to the invited sites, if any).
 */
export const acceptInvitation = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const user = await requireUser(ctx);
    const hash = await sha256Hex(token.trim());
    const inv = await ctx.db.query("portalInvitations").withIndex("by_token_hash", (q) => q.eq("tokenHash", hash)).unique();
    if (!inv || inv.status !== "pending") fail("This invitation is not valid");
    if (inv.expiresAt < Date.now()) {
      await ctx.db.patch(inv._id, { status: "expired" });
      fail("This invitation has expired; ask for a new one");
    }
    if ((user.email ?? "").toLowerCase() !== inv.email) fail(`This invitation was sent to ${inv.email}. Sign in with that email address.`);
    const now = Date.now();
    const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", inv.orgId).eq("userId", user._id)).unique();
    if (m && m.role !== "client_user" && m.status === "active") fail("You're already a staff member of this company");
    if (m && m.role === "client_user" && m.clientId && m.clientId !== inv.clientId && m.status === "active") fail("This account already has portal access for another client of this company");
    if (m) await ctx.db.patch(m._id, { role: "client_user", clientId: inv.clientId, status: "active" });
    else await ctx.db.insert("memberships", { orgId: inv.orgId, userId: user._id, role: "client_user", clientId: inv.clientId, status: "active", createdAt: now });
    const access = await ctx.db.query("portalAccess").withIndex("by_user_and_client", (q) => q.eq("userId", user._id).eq("clientId", inv.clientId)).unique();
    if (access) await ctx.db.patch(access._id, { status: "active", siteIds: inv.siteIds });
    else await ctx.db.insert("portalAccess", { orgId: inv.orgId, clientId: inv.clientId, userId: user._id, siteIds: inv.siteIds, canAcceptQuotes: false, status: "active", createdAt: now });
    await ctx.db.patch(inv._id, { status: "accepted", acceptedAt: now, acceptedUserId: user._id });
    if (!user.name && inv.name) await ctx.db.patch(user._id, { name: inv.name });
    if (!user.defaultOrgId) await ctx.db.patch(user._id, { defaultOrgId: inv.orgId });
    await audit(ctx, inv.orgId, user._id, "portal.invite_accepted", "portalAccess", user._id, { clientId: inv.clientId });
    return { orgId: inv.orgId, clientId: inv.clientId };
  },
});

/** Portal users for a client, with their access (office). */
export const listAccess = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    await loadForMember(ctx, clientId, "Client", OFFICE);
    const rows = await ctx.db.query("portalAccess").withIndex("by_client", (q) => q.eq("clientId", clientId)).take(500);
    return Promise.all(rows.map(async (r) => {
      const u = await ctx.db.get(r.userId);
      return { ...r, name: u?.name ?? null, email: u?.email ?? null };
    }));
  },
});

/** Change a portal user's site scope or quote-acceptance right (office). */
export const updateAccess = mutation({
  args: { accessId: v.id("portalAccess"), siteIds: v.optional(v.array(v.id("sites"))), canAcceptQuotes: v.optional(v.boolean()) },
  handler: async (ctx, { accessId, siteIds, canAcceptQuotes }) => {
    const { doc, user } = await loadForMember(ctx, accessId, "Portal access", OFFICE);
    const patch = { ...(siteIds !== undefined ? { siteIds: await checkSites(ctx, doc.clientId, siteIds) } : {}), ...(canAcceptQuotes !== undefined ? { canAcceptQuotes } : {}) };
    await ctx.db.patch(accessId, patch);
    await audit(ctx, doc.orgId, user._id, "portal.access_updated", "portalAccess", accessId, patch);
  },
});

/** Remove a portal user's access (office). Their client_user membership is disabled. */
export const revokeAccess = mutation({
  args: { accessId: v.id("portalAccess") },
  handler: async (ctx, { accessId }) => {
    const { doc, user } = await loadForMember(ctx, accessId, "Portal access", OFFICE);
    await ctx.db.patch(accessId, { status: "revoked" });
    const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", doc.orgId).eq("userId", doc.userId)).unique();
    if (m?.role === "client_user" && m.clientId === doc.clientId) await ctx.db.patch(m._id, { status: "disabled" });
    await audit(ctx, doc.orgId, user._id, "portal.access_revoked", "portalAccess", accessId);
  },
});
