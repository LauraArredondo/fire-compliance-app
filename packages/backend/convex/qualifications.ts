import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { discipline } from "./schema";
import { audit, fail, str, optStr, loadForMember, defined, requireFile, OFFICE, STAFF } from "./lib/util";

/** Qualifications for the org (office) or for one engineer (office, or the engineer themself). */
export const list = query({
  args: { orgId: v.id("organizations"), userId: v.optional(v.id("users")) },
  handler: async (ctx, { orgId, userId }) => {
    const { user, membership } = await requireMember(ctx, orgId, STAFF);
    const target = userId ?? (membership.role === "engineer" ? user._id : undefined);
    if (membership.role === "engineer" && target !== user._id) fail("Engineers can only view their own qualifications");
    const rows = target
      ? await ctx.db.query("engineerQualifications").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", target)).take(200)
      : await ctx.db.query("engineerQualifications").withIndex("by_org_and_expiry", (q) => q.eq("orgId", orgId)).take(1000);
    return Promise.all(rows.map(async (r) => ({ ...r, documentUrl: r.documentId ? await ctx.storage.getUrl(r.documentId) : null })));
  },
});

const fields = {
  discipline,
  title: v.string(),
  issuer: v.optional(v.string()),
  reference: v.optional(v.string()),
  issuedAt: v.optional(v.number()),
  expiresAt: v.optional(v.number()),
  documentId: v.optional(v.id("_storage")),
};

export const create = mutation({
  args: { orgId: v.id("organizations"), userId: v.id("users"), ...fields },
  handler: async (ctx, { orgId, userId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (q) => q.eq("orgId", orgId).eq("userId", userId)).unique();
    if (!m || m.role === "client_user") fail("That person is not a member of your team");
    if (a.documentId) await requireFile(ctx, a.documentId, { maxBytes: 10 * 1024 * 1024, label: "Certificate document" });
    if (a.issuedAt && a.expiresAt && a.expiresAt < a.issuedAt) fail("Expiry date is before the issue date");
    const id = await ctx.db.insert("engineerQualifications", {
      orgId, userId, discipline: a.discipline, title: str(a.title, "Qualification", 150), issuer: optStr(a.issuer, "Issuer", 120),
      reference: optStr(a.reference, "Reference", 60), issuedAt: a.issuedAt, expiresAt: a.expiresAt, documentId: a.documentId,
    });
    await audit(ctx, orgId, user._id, "qualification.created", "engineerQualification", id);
    return id;
  },
});

export const update = mutation({
  args: {
    qualificationId: v.id("engineerQualifications"),
    discipline: v.optional(discipline),
    title: v.optional(v.string()),
    issuer: v.optional(v.string()),
    reference: v.optional(v.string()),
    issuedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    documentId: v.optional(v.id("_storage")),
  },
  handler: async (ctx, { qualificationId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, qualificationId, "Qualification", OFFICE);
    if (a.documentId) await requireFile(ctx, a.documentId, { maxBytes: 10 * 1024 * 1024, label: "Certificate document" });
    const patch = defined({
      discipline: a.discipline, title: a.title === undefined ? undefined : str(a.title, "Qualification", 150),
      issuer: optStr(a.issuer, "Issuer", 120), reference: optStr(a.reference, "Reference", 60),
      issuedAt: a.issuedAt, expiresAt: a.expiresAt, documentId: a.documentId,
    });
    const issued = patch.issuedAt ?? doc.issuedAt, exp = patch.expiresAt ?? doc.expiresAt;
    if (issued && exp && exp < issued) fail("Expiry date is before the issue date");
    await ctx.db.patch(qualificationId, patch);
    await audit(ctx, doc.orgId, user._id, "qualification.updated", "engineerQualification", qualificationId, patch);
  },
});

export const remove = mutation({
  args: { qualificationId: v.id("engineerQualifications") },
  handler: async (ctx, { qualificationId }) => {
    const { doc, user } = await loadForMember(ctx, qualificationId, "Qualification", OFFICE);
    await ctx.db.delete(qualificationId);
    await audit(ctx, doc.orgId, user._id, "qualification.deleted", "engineerQualification", qualificationId, { title: doc.title });
  },
});
