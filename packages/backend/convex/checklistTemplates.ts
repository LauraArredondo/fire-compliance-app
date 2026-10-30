import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireMember } from "./lib/auth";
import { discipline } from "./schema";
import { audit, fail, str, optStr, defined, loadDoc, STAFF, OFFICE } from "./lib/util";

const itemV = v.object({
  key: v.string(),
  label: v.string(),
  section: v.optional(v.string()),
  responseType: v.union(v.literal("pass_fail"), v.literal("yes_no_na"), v.literal("number"), v.literal("text"), v.literal("photo"), v.literal("signature")),
  unit: v.optional(v.string()),
  required: v.boolean(),
  guidance: v.optional(v.string()),
});
type Item = typeof itemV.type;

function cleanItems(items: Item[]): Item[] {
  if (!items.length) fail("A checklist needs at least one item");
  if (items.length > 300) fail("At most 300 checklist items");
  const keys = new Set<string>();
  return items.map((i) => {
    const key = str(i.key, "Item key", 60);
    if (keys.has(key)) fail(`Duplicate item key "${key}"`);
    keys.add(key);
    return defined({ key, label: str(i.label, "Item label", 300), section: optStr(i.section, "Section", 100), responseType: i.responseType, unit: optStr(i.unit, "Unit", 20), required: i.required, guidance: optStr(i.guidance, "Guidance", 2000) }) as Item;
  });
}

/** Org templates plus built-in ones (any staff; engineers need them in the field). */
export const list = query({
  args: { orgId: v.id("organizations"), discipline: v.optional(discipline), includeInactive: v.optional(v.boolean()) },
  handler: async (ctx, { orgId, discipline: d, includeInactive }) => {
    await requireMember(ctx, orgId, STAFF);
    const fetch = (org: typeof orgId | undefined) =>
      d
        ? ctx.db.query("checklistTemplates").withIndex("by_org_and_discipline", (q) => q.eq("orgId", org).eq("discipline", d)).take(500)
        : ctx.db.query("checklistTemplates").withIndex("by_org", (q) => q.eq("orgId", org)).take(500);
    const rows = [...(await fetch(orgId)).map((t) => ({ ...t, builtIn: false })), ...(await fetch(undefined)).map((t) => ({ ...t, builtIn: true }))];
    return includeInactive ? rows : rows.filter((t) => t.isActive);
  },
});

export const get = query({
  args: { templateId: v.id("checklistTemplates") },
  handler: async (ctx, { templateId }) => {
    const t = await loadDoc(ctx, templateId, "Checklist template");
    if (t.orgId) await requireMember(ctx, t.orgId, STAFF);
    return t;
  },
});

export const create = mutation({
  args: { orgId: v.id("organizations"), discipline, name: v.string(), standard: v.optional(v.string()), scope: v.union(v.literal("system"), v.literal("asset")), items: v.array(itemV) },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    const id = await ctx.db.insert("checklistTemplates", { orgId, discipline: a.discipline, name: str(a.name, "Template name", 150), standard: optStr(a.standard, "Standard", 80), version: 1, scope: a.scope, items: cleanItems(a.items), isActive: true });
    await audit(ctx, orgId, user._id, "checklist.created", "checklistTemplate", id);
    return id;
  },
});

/** Edit a template. Changing the items bumps `version` (inspections keep the version they used). */
export const update = mutation({
  args: { templateId: v.id("checklistTemplates"), name: v.optional(v.string()), standard: v.optional(v.string()), items: v.optional(v.array(itemV)), isActive: v.optional(v.boolean()) },
  handler: async (ctx, { templateId, ...a }) => {
    const t = await loadDoc(ctx, templateId, "Checklist template");
    if (!t.orgId) fail("Built-in templates can't be edited; create your own copy");
    const { user } = await requireMember(ctx, t.orgId, OFFICE);
    const patch = defined({ name: a.name === undefined ? undefined : str(a.name, "Template name", 150), standard: optStr(a.standard, "Standard", 80), items: a.items && cleanItems(a.items), isActive: a.isActive, version: a.items ? t.version + 1 : undefined });
    await ctx.db.patch(templateId, patch);
    await audit(ctx, t.orgId, user._id, "checklist.updated", "checklistTemplate", templateId, { version: patch.version, isActive: a.isActive });
  },
});
