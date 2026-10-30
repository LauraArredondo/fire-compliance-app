import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { discipline } from "./schema";
import { audit, fail, str, optStr, defined, loadDoc, inOrg, cleanFrequency, frequencyV, num, STAFF, OFFICE } from "./lib/util";

const readingDefV = v.object({
  key: v.string(),
  label: v.string(),
  unit: v.optional(v.string()),
  valueType: v.union(v.literal("number"), v.literal("boolean"), v.literal("text")),
  min: v.optional(v.number()),
  max: v.optional(v.number()),
});

function cleanDefs(defs: { key: string; label: string; unit?: string; valueType: "number" | "boolean" | "text"; min?: number; max?: number }[] | undefined) {
  if (!defs) return undefined;
  if (defs.length > 40) fail("At most 40 readings per asset type");
  const keys = new Set<string>();
  return defs.map((d) => {
    const key = str(d.key, "Reading key", 40);
    if (!/^[a-z][a-z0-9_]*$/.test(key)) fail(`Reading key "${key}" must be lower_snake_case`);
    if (keys.has(key)) fail(`Duplicate reading key "${key}"`);
    keys.add(key);
    if (d.min !== undefined && d.max !== undefined && d.min > d.max) fail(`Reading "${key}": min is above max`);
    return defined({ key, label: str(d.label, "Reading label", 80), unit: optStr(d.unit, "Unit", 20), valueType: d.valueType, min: d.min, max: d.max }) as typeof d;
  });
}

/** Asset types available to the org: its own plus built-in (global) ones. */
export const list = query({
  args: { orgId: v.id("organizations"), discipline: v.optional(discipline) },
  handler: async (ctx, { orgId, discipline: d }) => {
    await requireMember(ctx, orgId, STAFF);
    const own = d
      ? await ctx.db.query("assetTypes").withIndex("by_org_and_discipline", (q) => q.eq("orgId", orgId).eq("discipline", d)).take(500)
      : await ctx.db.query("assetTypes").withIndex("by_org", (q) => q.eq("orgId", orgId)).take(500);
    const global = d
      ? await ctx.db.query("assetTypes").withIndex("by_org_and_discipline", (q) => q.eq("orgId", undefined).eq("discipline", d)).take(500)
      : await ctx.db.query("assetTypes").withIndex("by_org", (q) => q.eq("orgId", undefined)).take(500);
    return [...own.map((t) => ({ ...t, builtIn: false })), ...global.map((t) => ({ ...t, builtIn: true }))];
  },
});

const fields = {
  discipline,
  name: v.string(),
  readingDefinitions: v.optional(v.array(readingDefV)),
  defaultServiceFrequency: v.optional(frequencyV),
  expectedLifeYears: v.optional(v.number()),
  checklistTemplateId: v.optional(v.id("checklistTemplates")),
};

export const create = mutation({
  args: { orgId: v.id("organizations"), ...fields },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    if (a.checklistTemplateId) {
      const t = await loadDoc(ctx, a.checklistTemplateId, "Checklist template");
      if (t.orgId && t.orgId !== orgId) fail("Checklist template not found");
    }
    const id = await ctx.db.insert("assetTypes", {
      orgId, discipline: a.discipline, name: str(a.name, "Asset type name", 100), readingDefinitions: cleanDefs(a.readingDefinitions),
      defaultServiceFrequency: a.defaultServiceFrequency && cleanFrequency(a.defaultServiceFrequency),
      expectedLifeYears: a.expectedLifeYears === undefined ? undefined : num(a.expectedLifeYears, "Expected life (years)", 0, 100),
      checklistTemplateId: a.checklistTemplateId,
    });
    await audit(ctx, orgId, user._id, "assetType.created", "assetType", id);
    return id;
  },
});

export const update = mutation({
  args: {
    assetTypeId: v.id("assetTypes"),
    name: v.optional(v.string()),
    readingDefinitions: v.optional(v.array(readingDefV)),
    defaultServiceFrequency: v.optional(frequencyV),
    expectedLifeYears: v.optional(v.number()),
    checklistTemplateId: v.optional(v.id("checklistTemplates")),
  },
  handler: async (ctx, { assetTypeId, ...a }) => {
    const t = await loadDoc(ctx, assetTypeId, "Asset type");
    if (!t.orgId) fail("Built-in asset types can't be edited; create your own copy");
    const { user } = await requireMember(ctx, t.orgId, OFFICE);
    if (a.checklistTemplateId) await inOrg(ctx, a.checklistTemplateId, t.orgId, "Checklist template");
    const patch = defined({
      name: a.name === undefined ? undefined : str(a.name, "Asset type name", 100), readingDefinitions: cleanDefs(a.readingDefinitions),
      defaultServiceFrequency: a.defaultServiceFrequency && cleanFrequency(a.defaultServiceFrequency),
      expectedLifeYears: a.expectedLifeYears === undefined ? undefined : num(a.expectedLifeYears, "Expected life (years)", 0, 100),
      checklistTemplateId: a.checklistTemplateId,
    });
    await ctx.db.patch(assetTypeId, patch);
    await audit(ctx, t.orgId, user._id, "assetType.updated", "assetType", assetTypeId, patch);
  },
});

/** Delete an unused asset type (no assets of this type in the org). */
export const remove = mutation({
  args: { assetTypeId: v.id("assetTypes") },
  handler: async (ctx, { assetTypeId }) => {
    const t = await loadDoc(ctx, assetTypeId, "Asset type");
    if (!t.orgId) fail("Built-in asset types can't be deleted");
    const orgId = t.orgId;
    const { user } = await requireMember(ctx, orgId, OFFICE);
    for await (const a of ctx.db.query("assets").withIndex("by_org", (q) => q.eq("orgId", orgId))) {
      if (a.assetTypeId === assetTypeId) fail("This type is used by assets; it can't be deleted");
    }
    await ctx.db.delete(assetTypeId);
    await audit(ctx, orgId, user._id, "assetType.deleted", "assetType", assetTypeId, { name: t.name });
  },
});
