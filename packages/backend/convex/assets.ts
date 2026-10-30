import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeSite, requireSiteScope } from "./lib/auth";
import { newPublicToken } from "./lib/tokens";
import { discipline } from "./schema";
import { audit, fail, str, optStr, defined, loadDoc, loadForMember, inOrg, requireFile, IMAGE, addMonths, STAFF, ANY } from "./lib/util";

const customV = v.optional(v.record(v.string(), v.union(v.string(), v.number(), v.boolean())));
const editable = {
  assetTypeId: v.optional(v.id("assetTypes")),
  locationId: v.optional(v.id("locations")),
  reference: v.optional(v.string()),
  description: v.optional(v.string()),
  manufacturer: v.optional(v.string()),
  model: v.optional(v.string()),
  serialNumber: v.optional(v.string()),
  parentAssetId: v.optional(v.id("assets")),
  installedAt: v.optional(v.number()),
  manufacturedAt: v.optional(v.number()),
  warrantyExpiresAt: v.optional(v.number()),
  replaceBy: v.optional(v.number()),
  photoIds: v.optional(v.array(v.id("_storage"))),
  customFields: customV,
};
type Editable = { [K in keyof typeof editable]?: (typeof editable)[K]["type"] };

/** Device register for a site, optionally by discipline (kept for the register screen). */
export const registerForSite = query({
  args: { orgId: v.id("organizations"), siteId: v.id("sites"), discipline: v.optional(discipline) },
  handler: async (ctx, args) => {
    const { membership } = await requireMember(ctx, args.orgId, ANY);
    const site = await ctx.db.get(args.siteId);
    if (!site || site.orgId !== args.orgId || !(await canSeeSite(ctx, membership, site))) fail("Site not found");
    const d = args.discipline;
    const q = d
      ? ctx.db.query("assets").withIndex("by_site_and_discipline", (q) => q.eq("siteId", args.siteId).eq("discipline", d))
      : ctx.db.query("assets").withIndex("by_site", (q) => q.eq("siteId", args.siteId));
    return await q.take(2000);
  },
});

/** Paginated assets at a site (any member who can see the site). */
export const list = query({
  args: { siteId: v.id("sites"), discipline: v.optional(discipline), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { siteId, discipline: d, paginationOpts }) => {
    const { doc: site, membership } = await loadForMember(ctx, siteId, "Site", ANY);
    if (!(await canSeeSite(ctx, membership, site))) fail("Site not found");
    return d
      ? await ctx.db.query("assets").withIndex("by_site_and_discipline", (q) => q.eq("siteId", siteId).eq("discipline", d)).paginate(paginationOpts)
      : await ctx.db.query("assets").withIndex("by_site", (q) => q.eq("siteId", siteId)).paginate(paginationOpts);
  },
});

export const get = query({
  args: { assetId: v.id("assets") },
  handler: async (ctx, { assetId }) => {
    const { doc, membership } = await loadForMember(ctx, assetId, "Asset", ANY);
    const site = await loadDoc(ctx, doc.siteId, "Site");
    if (!(await canSeeSite(ctx, membership, site))) fail("Asset not found");
    const [type, location] = await Promise.all([ctx.db.get(doc.assetTypeId), doc.locationId ? ctx.db.get(doc.locationId) : null]);
    const photoUrls = await Promise.all((doc.photoIds ?? []).map((id) => ctx.storage.getUrl(id)));
    return { ...doc, assetTypeName: type?.name ?? null, locationName: location?.name ?? null, siteName: site.name, photoUrls };
  },
});

async function checkType(ctx: MutationCtx, orgId: Id<"organizations">, assetTypeId: Id<"assetTypes">) {
  const t = await loadDoc(ctx, assetTypeId, "Asset type");
  if (t.orgId && t.orgId !== orgId) fail("Asset type not found");
  return t;
}
async function checkLocation(ctx: MutationCtx, siteId: Id<"sites">, locationId?: Id<"locations">) {
  if (!locationId) return;
  const l = await ctx.db.get(locationId);
  if (!l || l.siteId !== siteId) fail("Location not found at this site");
}

async function cleanFields(ctx: MutationCtx, orgId: Id<"organizations">, siteId: Id<"sites">, a: Editable, self?: Id<"assets">) {
  await checkLocation(ctx, siteId, a.locationId);
  if (a.parentAssetId) {
    if (a.parentAssetId === self) fail("An asset can't be its own parent");
    const p = await ctx.db.get(a.parentAssetId);
    if (!p || p.siteId !== siteId) fail("Parent asset not found at this site");
  }
  if (a.photoIds) {
    if (a.photoIds.length > 20) fail("At most 20 photos per asset");
    for (const id of a.photoIds) await requireFile(ctx, id, { types: IMAGE, maxBytes: 15 * 1024 * 1024, label: "Photo" });
  }
  if (a.customFields && Object.keys(a.customFields).length > 50) fail("At most 50 custom fields");
  void orgId;
  return defined({
    locationId: a.locationId,
    reference: a.reference === undefined ? undefined : str(a.reference, "Asset reference", 60),
    description: optStr(a.description, "Description", 500),
    manufacturer: optStr(a.manufacturer, "Manufacturer", 100),
    model: optStr(a.model, "Model", 100),
    serialNumber: optStr(a.serialNumber, "Serial number", 100),
    parentAssetId: a.parentAssetId,
    installedAt: a.installedAt,
    manufacturedAt: a.manufacturedAt,
    warrantyExpiresAt: a.warrantyExpiresAt,
    replaceBy: a.replaceBy,
    photoIds: a.photoIds,
    customFields: a.customFields,
  });
}

async function insertAsset(ctx: MutationCtx, site: Doc<"sites">, a: Editable & { assetTypeId: Id<"assetTypes">; reference: string; clientGeneratedId?: string; capturedAt?: number; deviceId?: string }) {
  const type = await checkType(ctx, site.orgId, a.assetTypeId);
  const f = await cleanFields(ctx, site.orgId, site._id, a);
  const now = Date.now();
  const replaceBy = f.replaceBy ?? (type.expectedLifeYears && (f.installedAt ?? f.manufacturedAt) ? addMonths((f.installedAt ?? f.manufacturedAt)!, type.expectedLifeYears * 12) : undefined);
  return await ctx.db.insert("assets", {
    ...f, reference: f.reference!, replaceBy,
    orgId: site.orgId, clientId: site.clientId, siteId: site._id, assetTypeId: a.assetTypeId, discipline: type.discipline,
    status: "in_service", tagCode: newPublicToken(10),
    clientGeneratedId: a.clientGeneratedId, capturedAt: a.capturedAt, deviceId: a.deviceId, syncedAt: a.clientGeneratedId ? now : undefined,
    createdAt: now, updatedAt: now,
  });
}

async function byClientId(ctx: MutationCtx, orgId: Id<"organizations">, cgid?: string) {
  if (!cgid) return null;
  const rows = await ctx.db.query("assets").withIndex("by_client_generated_id", (q) => q.eq("clientGeneratedId", cgid)).take(5);
  return rows.find((r) => r.orgId === orgId) ?? null;
}

/** Add one asset (staff). Idempotent on clientGeneratedId for offline capture. */
export const create = mutation({
  args: { siteId: v.id("sites"), ...editable, assetTypeId: v.id("assetTypes"), reference: v.string(), clientGeneratedId: v.optional(v.string()), capturedAt: v.optional(v.number()), deviceId: v.optional(v.string()) },
  handler: async (ctx, { siteId, ...a }) => {
    const { doc: site, user } = await loadForMember(ctx, siteId, "Site", STAFF);
    if (site.status !== "active") fail("Site is archived");
    const existing = await byClientId(ctx, site.orgId, a.clientGeneratedId);
    if (existing) return existing._id;
    const id = await insertAsset(ctx, site, a);
    await audit(ctx, site.orgId, user._id, "asset.created", "asset", id);
    return id;
  },
});

/**
 * Bulk import a device list (e.g. from a spreadsheet) into a site. Up to 500 rows per call.
 * Rows whose reference already exists at the site are skipped (or updated if `updateExisting`).
 * `locationName` creates/uses a top-level "area" location with that name.
 */
export const bulkImport = mutation({
  args: {
    siteId: v.id("sites"),
    updateExisting: v.optional(v.boolean()),
    rows: v.array(v.object({ ...editable, assetTypeId: v.id("assetTypes"), reference: v.string(), locationName: v.optional(v.string()), clientGeneratedId: v.optional(v.string()) })),
  },
  handler: async (ctx, { siteId, rows, updateExisting }) => {
    const { doc: site, user } = await loadForMember(ctx, siteId, "Site", STAFF);
    if (site.status !== "active") fail("Site is archived");
    if (rows.length === 0) fail("Nothing to import");
    if (rows.length > 500) fail("Import at most 500 rows at a time");
    const existing = new Map<string, Doc<"assets">>();
    for await (const a of ctx.db.query("assets").withIndex("by_site", (q) => q.eq("siteId", siteId))) existing.set(a.reference.toLowerCase(), a);
    const locations = new Map<string, Id<"locations">>();
    for (const l of await ctx.db.query("locations").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(2000)) locations.set(l.name.toLowerCase(), l._id);
    const result = { created: 0, updated: 0, skipped: 0, errors: [] as { row: number; reference: string; error: string }[], ids: [] as Id<"assets">[] };
    const seen = new Set<string>();
    for (const [i, row] of rows.entries()) {
      const { locationName, ...r } = row;
      const ref = r.reference.trim();
      try {
        if (seen.has(ref.toLowerCase())) throw new Error("Duplicate reference in this import");
        seen.add(ref.toLowerCase());
        if (!r.locationId && locationName?.trim()) {
          const key = locationName.trim().toLowerCase();
          let lid = locations.get(key);
          if (!lid) {
            lid = await ctx.db.insert("locations", { orgId: site.orgId, siteId, kind: "area", name: str(locationName, "Location name", 120) });
            locations.set(key, lid);
          }
          r.locationId = lid;
        }
        const dupe = existing.get(ref.toLowerCase()) ?? (await byClientId(ctx, site.orgId, r.clientGeneratedId));
        if (dupe) {
          if (updateExisting) {
            const { assetTypeId, clientGeneratedId, ...rest } = r;
            void clientGeneratedId;
            const patch = await cleanFields(ctx, site.orgId, siteId, rest, dupe._id);
            if (assetTypeId !== dupe.assetTypeId) {
              const t = await checkType(ctx, site.orgId, assetTypeId);
              Object.assign(patch, { assetTypeId, discipline: t.discipline });
            }
            await ctx.db.patch(dupe._id, { ...patch, updatedAt: Date.now() });
            result.updated++;
          } else result.skipped++;
          result.ids.push(dupe._id);
          continue;
        }
        const id = await insertAsset(ctx, site, { ...r, reference: ref });
        result.created++;
        result.ids.push(id);
      } catch (e) {
        const msg = e instanceof Error ? ((e as { data?: unknown }).data as string) ?? e.message : String(e);
        result.errors.push({ row: i + 1, reference: ref, error: msg });
      }
    }
    if (result.errors.length && result.created + result.updated === 0) fail(`Import failed: ${result.errors[0].error} (row ${result.errors[0].row})`);
    await audit(ctx, site.orgId, user._id, "asset.bulk_imported", "site", siteId, { created: result.created, updated: result.updated, skipped: result.skipped, errors: result.errors.length });
    return result;
  },
});

export const update = mutation({
  args: { assetId: v.id("assets"), ...editable },
  handler: async (ctx, { assetId, assetTypeId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, assetId, "Asset", STAFF);
    if (doc.status === "removed" || doc.status === "replaced") fail("This asset has been decommissioned and can't be edited");
    const patch: Record<string, unknown> = await cleanFields(ctx, doc.orgId, doc.siteId, a, assetId);
    if (assetTypeId && assetTypeId !== doc.assetTypeId) {
      const t = await checkType(ctx, doc.orgId, assetTypeId);
      Object.assign(patch, { assetTypeId, discipline: t.discipline });
    }
    await ctx.db.patch(assetId, { ...patch, updatedAt: Date.now() });
    await audit(ctx, doc.orgId, user._id, "asset.updated", "asset", assetId, patch);
  },
});

/** Set the operational status (in service / defective / out of service). */
export const setStatus = mutation({
  args: { assetId: v.id("assets"), status: v.union(v.literal("in_service"), v.literal("defective"), v.literal("out_of_service")) },
  handler: async (ctx, { assetId, status }) => {
    const { doc, user } = await loadForMember(ctx, assetId, "Asset", STAFF);
    if (doc.status === "removed" || doc.status === "replaced") fail("This asset has been decommissioned");
    await ctx.db.patch(assetId, { status, updatedAt: Date.now() });
    await audit(ctx, doc.orgId, user._id, "asset.status", "asset", assetId, { from: doc.status, to: status });
  },
});

/** Move an asset to another location at the same site, or to another site of the same client. */
export const move = mutation({
  args: { assetId: v.id("assets"), siteId: v.optional(v.id("sites")), locationId: v.optional(v.union(v.id("locations"), v.null())) },
  handler: async (ctx, { assetId, siteId, locationId }) => {
    const { doc, user, membership } = await loadForMember(ctx, assetId, "Asset", STAFF);
    if (doc.status === "removed" || doc.status === "replaced") fail("This asset has been decommissioned");
    const targetSite = siteId ? await inOrg(ctx, siteId, doc.orgId, "Site") : await loadDoc(ctx, doc.siteId, "Site");
    await requireSiteScope(ctx, membership, targetSite._id);
    if (targetSite.clientId !== doc.clientId) fail("Assets can only be moved between sites of the same client");
    if (targetSite.status !== "active") fail("Target site is archived");
    await checkLocation(ctx, targetSite._id, locationId ?? undefined);
    const changingSite = targetSite._id !== doc.siteId;
    if (changingSite) {
      const children = await ctx.db.query("assets").withIndex("by_site", (q) => q.eq("siteId", doc.siteId)).collect();
      if (children.some((c) => c.parentAssetId === assetId)) fail("Move or detach this asset's child devices first");
    }
    const patch = {
      siteId: targetSite._id,
      locationId: locationId === undefined ? (changingSite ? undefined : doc.locationId) : (locationId ?? undefined),
      parentAssetId: changingSite ? undefined : doc.parentAssetId,
      updatedAt: Date.now(),
    };
    await ctx.db.patch(assetId, patch);
    await audit(ctx, doc.orgId, user._id, "asset.moved", "asset", assetId, { fromSite: doc.siteId, toSite: patch.siteId, fromLocation: doc.locationId, toLocation: patch.locationId });
  },
});

/** Decommission: mark removed, or replaced (optionally linking the replacement asset). */
export const decommission = mutation({
  args: { assetId: v.id("assets"), status: v.union(v.literal("removed"), v.literal("replaced")), reason: v.string(), replacementAssetId: v.optional(v.id("assets")) },
  handler: async (ctx, { assetId, status, reason, replacementAssetId }) => {
    const { doc, user, membership } = await loadForMember(ctx, assetId, "Asset", STAFF);
    if (doc.status === "removed" || doc.status === "replaced") fail("Asset is already decommissioned");
    if (replacementAssetId) {
      const r = await inOrg(ctx, replacementAssetId, doc.orgId, "Replacement asset");
      await requireSiteScope(ctx, membership, r.siteId);
      if (r._id === assetId) fail("An asset can't replace itself");
    }
    const why = str(reason, "Reason", 500);
    await ctx.db.patch(assetId, {
      status, nextDueAt: undefined, updatedAt: Date.now(),
      customFields: { ...(doc.customFields ?? {}), decommissionReason: why, decommissionedAt: Date.now(), ...(replacementAssetId ? { replacedBy: replacementAssetId } : {}) },
    });
    const schedules = await ctx.db.query("serviceSchedules").withIndex("by_site", (q) => q.eq("siteId", doc.siteId)).take(500);
    for (const s of schedules) if (s.assetId === assetId && s.status !== "ended") await ctx.db.patch(s._id, { status: "ended" });
    await audit(ctx, doc.orgId, user._id, "asset.decommissioned", "asset", assetId, { status, reason: why, replacementAssetId });
  },
});
