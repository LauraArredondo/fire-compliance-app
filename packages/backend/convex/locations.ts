import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { canSeeSite } from "./lib/auth";
import { Doc, Id } from "./_generated/dataModel";
import { audit, fail, str, optStr, defined, loadForMember, requireFile, STAFF, ANY } from "./lib/util";

const kind = v.union(v.literal("building"), v.literal("floor"), v.literal("zone"), v.literal("room"), v.literal("area"));

/** All locations (building > floor > zone > room) at a site, flat; build the tree with parentId. */
export const listBySite = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const { doc, membership } = await loadForMember(ctx, siteId, "Site", ANY);
    if (!(await canSeeSite(ctx, membership, doc))) fail("Site not found");
    const rows = await ctx.db.query("locations").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(2000);
    return rows.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name));
  },
});

async function checkParent(ctx: QueryCtx, siteId: Id<"sites">, parentId: Id<"locations"> | undefined, self?: Id<"locations">) {
  if (!parentId) return;
  let cur: Id<"locations"> | undefined = parentId;
  for (let depth = 0; cur; depth++) {
    if (cur === self) fail("A location can't be inside itself");
    if (depth > 10) fail("Locations can be nested at most 10 levels deep");
    const p: Doc<"locations"> | null = await ctx.db.get(cur);
    if (!p || p.siteId !== siteId) fail("Parent location not found at this site");
    cur = p.parentId;
  }
}

export const create = mutation({
  args: { siteId: v.id("sites"), parentId: v.optional(v.id("locations")), kind, name: v.string(), code: v.optional(v.string()), sortOrder: v.optional(v.number()), floorPlanId: v.optional(v.id("_storage")) },
  handler: async (ctx, { siteId, ...a }) => {
    const { doc: site, user } = await loadForMember(ctx, siteId, "Site", STAFF);
    await checkParent(ctx, siteId, a.parentId);
    if (a.floorPlanId) await requireFile(ctx, a.floorPlanId, { maxBytes: 20 * 1024 * 1024, label: "Floor plan" });
    const id = await ctx.db.insert("locations", { orgId: site.orgId, siteId, parentId: a.parentId, kind: a.kind, name: str(a.name, "Location name", 120), code: optStr(a.code, "Code", 30), sortOrder: a.sortOrder, floorPlanId: a.floorPlanId });
    await audit(ctx, site.orgId, user._id, "location.created", "location", id);
    return id;
  },
});

export const update = mutation({
  args: { locationId: v.id("locations"), parentId: v.optional(v.union(v.id("locations"), v.null())), kind: v.optional(kind), name: v.optional(v.string()), code: v.optional(v.string()), sortOrder: v.optional(v.number()), floorPlanId: v.optional(v.id("_storage")) },
  handler: async (ctx, { locationId, parentId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, locationId, "Location", STAFF);
    if (parentId) await checkParent(ctx, doc.siteId, parentId, locationId);
    if (a.floorPlanId) await requireFile(ctx, a.floorPlanId, { maxBytes: 20 * 1024 * 1024, label: "Floor plan" });
    const patch = { ...defined({ kind: a.kind, name: a.name === undefined ? undefined : str(a.name, "Location name", 120), code: optStr(a.code, "Code", 30), sortOrder: a.sortOrder, floorPlanId: a.floorPlanId }), ...(parentId === undefined ? {} : { parentId: parentId ?? undefined }) };
    await ctx.db.patch(locationId, patch);
    await audit(ctx, doc.orgId, user._id, "location.updated", "location", locationId, patch);
  },
});

/** Delete an empty location (no sub-locations and no assets). */
export const remove = mutation({
  args: { locationId: v.id("locations") },
  handler: async (ctx, { locationId }) => {
    const { doc, user } = await loadForMember(ctx, locationId, "Location", STAFF);
    if (await ctx.db.query("locations").withIndex("by_parent", (q) => q.eq("parentId", locationId)).first()) fail("Remove or move the sub-locations first");
    if (await ctx.db.query("assets").withIndex("by_location", (q) => q.eq("locationId", locationId)).first()) fail("Move the assets in this location first");
    await ctx.db.delete(locationId);
    await audit(ctx, doc.orgId, user._id, "location.deleted", "location", locationId, { name: doc.name });
  },
});
