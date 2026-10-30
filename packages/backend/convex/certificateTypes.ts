import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { discipline } from "./schema";
import { audit, fail, str, optStr, defined, loadDoc, int, STAFF, OFFICE } from "./lib/util";

/** Certificate types available to the org (own + built-in). */
export const list = query({
  args: { orgId: v.id("organizations"), discipline: v.optional(discipline), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, discipline: d, includeInactive }) => {
    await requireMember(ctx, orgId, STAFF);
    const fetch = (org: typeof orgId | undefined) =>
      d
        ? ctx.db.query("certificateTypes").withIndex("by_org_and_discipline", (q) => q.eq("orgId", org).eq("discipline", d)).take(500)
        : ctx.db.query("certificateTypes").withIndex("by_org", (q) => q.eq("orgId", org)).take(500);
    const rows = [...(await fetch(orgId)).map((t) => ({ ...t, builtIn: false })), ...(await fetch(undefined)).map((t) => ({ ...t, builtIn: true }))];
    return includeInactive ? rows : rows.filter((t) => t.isActive);
  },
});

function cleanPrefix(p: string) {
  const x = str(p, "Number prefix", 12).toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9/-]*$/.test(x)) fail("Number prefix may only contain letters, digits, - and /");
  return x;
}

export const create = mutation({
  args: { orgId: v.id("organizations"), discipline, name: v.string(), code: v.string(), standard: v.optional(v.string()), numberPrefix: v.string(), validityMonths: v.optional(v.number()), requiresClientSignature: v.boolean(), templateKey: v.optional(v.string()) },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    const id = await ctx.db.insert("certificateTypes", {
      orgId, discipline: a.discipline, name: str(a.name, "Certificate name", 150), code: str(a.code, "Code", 20).toUpperCase(), standard: optStr(a.standard, "Standard", 80),
      numberPrefix: cleanPrefix(a.numberPrefix), validityMonths: a.validityMonths === undefined ? undefined : int(a.validityMonths, "Validity (months)", 1, 120),
      requiresClientSignature: a.requiresClientSignature, templateKey: optStr(a.templateKey, "Template", 40), isActive: true,
    });
    await audit(ctx, orgId, user._id, "certificateType.created", "certificateType", id);
    return id;
  },
});

/** Edit a type. Existing certificates keep their numbers; changes apply to new ones. */
export const update = mutation({
  args: { certificateTypeId: v.id("certificateTypes"), name: v.optional(v.string()), standard: v.optional(v.string()), numberPrefix: v.optional(v.string()), validityMonths: v.optional(v.number()), requiresClientSignature: v.optional(v.boolean()), templateKey: v.optional(v.string()), isActive: v.optional(v.boolean()) },
  handler: async (ctx, { certificateTypeId, ...a }) => {
    const t = await loadDoc(ctx, certificateTypeId, "Certificate type");
    if (!t.orgId) fail("Built-in certificate types can't be edited");
    const { user } = await requireMember(ctx, t.orgId, OFFICE);
    const patch = defined({
      name: a.name === undefined ? undefined : str(a.name, "Certificate name", 150), standard: optStr(a.standard, "Standard", 80),
      numberPrefix: a.numberPrefix === undefined ? undefined : cleanPrefix(a.numberPrefix),
      validityMonths: a.validityMonths === undefined ? undefined : int(a.validityMonths, "Validity (months)", 1, 120),
      requiresClientSignature: a.requiresClientSignature, templateKey: optStr(a.templateKey, "Template", 40), isActive: a.isActive,
    });
    await ctx.db.patch(certificateTypeId, patch);
    await audit(ctx, t.orgId, user._id, "certificateType.updated", "certificateType", certificateTypeId, patch);
  },
});
