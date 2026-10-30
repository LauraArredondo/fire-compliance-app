import { v } from "convex/values";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { canSeeSite, requireJobScope } from "./lib/auth";
import { discipline } from "./schema";
import { audit, fail, optStr, loadDoc, loadForMember, inOrg, requireFile, STAFF, ANY } from "./lib/util";

const responseV = v.object({
  itemKey: v.string(),
  value: v.optional(v.union(v.string(), v.number(), v.boolean(), v.null())),
  result: v.optional(v.union(v.literal("pass"), v.literal("fail"), v.literal("na"))),
  comment: v.optional(v.string()),
  photoIds: v.optional(v.array(v.id("_storage"))),
});
const resultV = v.union(v.literal("pass"), v.literal("fail"), v.literal("advisory"), v.literal("not_tested"));
const readingInV = v.object({
  key: v.string(),
  label: v.optional(v.string()),
  value: v.union(v.number(), v.boolean(), v.string()),
  unit: v.optional(v.string()),
  recordedAt: v.optional(v.number()),
  clientGeneratedId: v.optional(v.string()),
});
type ReadingIn = typeof readingInV.type;
type Response = typeof responseV.type;

/** True when an issued certificate covers this inspection (then it's locked). */
async function isLocked(ctx: MutationCtx, insp: Doc<"inspections">) {
  const certs = insp.jobId
    ? await ctx.db.query("certificates").withIndex("by_job", (q) => q.eq("jobId", insp.jobId)).take(50)
    : await ctx.db.query("certificates").withIndex("by_site", (q) => q.eq("siteId", insp.siteId)).take(500);
  return certs.some((c) => c.status === "issued" && c.inspectionIds.includes(insp._id));
}

async function cleanResponses(ctx: MutationCtx, responses: Response[], template: Doc<"checklistTemplates"> | null) {
  if (responses.length > 500) fail("At most 500 responses per inspection");
  const keys = template ? new Set(template.items.map((i) => i.key)) : null;
  for (const r of responses) {
    if (keys && !keys.has(r.itemKey)) fail(`Unknown checklist item "${r.itemKey}"`);
    if (r.comment && r.comment.length > 2000) fail("Comments must be 2000 characters or fewer");
    if (typeof r.value === "string" && r.value.length > 5000) fail("Response text too long");
    for (const p of r.photoIds ?? []) await requireFile(ctx, p, { maxBytes: 15 * 1024 * 1024, label: "Photo" });
  }
  if (template) {
    const answered = new Set(responses.map((r) => r.itemKey));
    const missing = template.items.filter((i) => i.required && !answered.has(i.key));
    if (missing.length) fail(`Missing required checklist items: ${missing.slice(0, 5).map((i) => i.label).join(", ")}`);
  }
  return responses;
}

/** Tolerance check against the asset type's reading definitions. */
function tolerance(def: { valueType: string; min?: number; max?: number } | undefined, value: number | boolean | string) {
  if (!def || typeof value !== "number") return undefined;
  if (def.min === undefined && def.max === undefined) return undefined;
  return (def.min === undefined || value >= def.min) && (def.max === undefined || value <= def.max);
}

async function insertReadings(
  ctx: MutationCtx, asset: Doc<"assets">, readings: ReadingIn[], userId: Id<"users">,
  link: { inspectionId?: Id<"inspections">; visitId?: Id<"visits"> }, deviceId?: string,
) {
  const type = await ctx.db.get(asset.assetTypeId);
  const defs = new Map((type?.readingDefinitions ?? []).map((d) => [d.key, d]));
  const now = Date.now();
  const ids: Id<"readings">[] = [];
  for (const r of readings) {
    if (r.clientGeneratedId) {
      const d = (await ctx.db.query("readings").withIndex("by_client_generated_id", (q) => q.eq("clientGeneratedId", r.clientGeneratedId)).take(5)).find((x) => x.orgId === asset.orgId);
      if (d) { ids.push(d._id); continue; }
    }
    const key = r.key.trim();
    if (!key || key.length > 40) fail("Reading key is required (max 40 characters)");
    if (typeof r.value === "number" && !Number.isFinite(r.value)) fail(`Reading "${key}" is not a number`);
    if (typeof r.value === "string" && r.value.length > 500) fail(`Reading "${key}" is too long`);
    const def = defs.get(key);
    if (def && def.valueType !== typeof r.value && !(def.valueType === "text" && typeof r.value === "string")) fail(`Reading "${key}" should be a ${def.valueType}`);
    ids.push(await ctx.db.insert("readings", {
      orgId: asset.orgId, siteId: asset.siteId, assetId: asset._id, inspectionId: link.inspectionId, visitId: link.visitId,
      key, label: optStr(r.label, "Label", 80) ?? def?.label, value: r.value, unit: optStr(r.unit, "Unit", 20) ?? def?.unit,
      withinTolerance: tolerance(def, r.value), source: "manual", recordedBy: userId, recordedAt: Math.min(r.recordedAt ?? now, now),
      clientGeneratedId: r.clientGeneratedId, capturedAt: r.recordedAt, syncedAt: now, deviceId,
    }));
  }
  return ids;
}

/**
 * Bulk-record inspections from the field (one per asset or one system-level). Each item is
 * idempotent on clientGeneratedId, so a device can safely re-send its whole offline queue.
 * Nested readings are stored against the asset. Updates the asset's last inspected/result.
 */
export const record = mutation({
  args: {
    visitId: v.id("visits"),
    deviceId: v.optional(v.string()),
    inspections: v.array(v.object({
      clientGeneratedId: v.optional(v.string()),
      assetId: v.optional(v.id("assets")),
      templateId: v.optional(v.id("checklistTemplates")),
      discipline: v.optional(discipline),
      responses: v.array(responseV),
      overallResult: resultV,
      performedAt: v.optional(v.number()),
      readings: v.optional(v.array(readingInV)),
    })),
  },
  handler: async (ctx, { visitId, deviceId, inspections }) => {
    const { doc: visit, user, membership } = await loadForMember(ctx, visitId, "Visit", STAFF);
    if (membership.role === "engineer" && visit.engineerId !== user._id) fail("Only the visiting engineer can record on this visit");
    if (visit.status === "aborted") fail("This visit was aborted");
    if (inspections.length > 200) fail("Send at most 200 inspections at a time");
    const job = await loadDoc(ctx, visit.jobId, "Job");
    const out: { clientGeneratedId?: string; inspectionId: Id<"inspections">; duplicate: boolean }[] = [];
    const now = Date.now();
    for (const i of inspections) {
      if (i.clientGeneratedId) {
        const d = (await ctx.db.query("inspections").withIndex("by_client_generated_id", (q) => q.eq("clientGeneratedId", i.clientGeneratedId)).take(5)).find((x) => x.orgId === visit.orgId);
        if (d) { out.push({ clientGeneratedId: i.clientGeneratedId, inspectionId: d._id, duplicate: true }); continue; }
      }
      const asset = i.assetId ? await inOrg(ctx, i.assetId, visit.orgId, "Asset") : null;
      if (asset && asset.siteId !== visit.siteId) fail(`Asset ${asset.reference} is not at this site`);
      const template = i.templateId ? await loadDoc(ctx, i.templateId, "Checklist template") : null;
      if (template?.orgId && template.orgId !== visit.orgId) fail("Checklist template not found");
      const disc = asset?.discipline ?? i.discipline ?? template?.discipline ?? job.disciplines[0];
      if (!disc) fail("Discipline is required for a system inspection");
      const responses = await cleanResponses(ctx, i.responses, template);
      const performedAt = Math.min(i.performedAt ?? now, now);
      const id = await ctx.db.insert("inspections", {
        orgId: visit.orgId, siteId: visit.siteId, jobId: visit.jobId, visitId, assetId: asset?._id, templateId: template?._id, templateVersion: template?.version,
        discipline: disc, engineerId: visit.engineerId, responses, overallResult: i.overallResult, performedAt,
        clientGeneratedId: i.clientGeneratedId, capturedAt: i.performedAt, syncedAt: now, deviceId,
      });
      if (asset) {
        if (i.readings?.length) await insertReadings(ctx, asset, i.readings, user._id, { inspectionId: id, visitId }, deviceId);
        if (!asset.lastInspectedAt || performedAt >= asset.lastInspectedAt) {
          await ctx.db.patch(asset._id, { lastInspectedAt: performedAt, lastResult: i.overallResult, updatedAt: now, ...(i.overallResult === "fail" && asset.status === "in_service" ? { status: "defective" as const } : {}) });
        }
      } else if (i.readings?.length) fail("Readings need an asset");
      out.push({ clientGeneratedId: i.clientGeneratedId, inspectionId: id, duplicate: false });
    }
    const created = out.filter((o) => !o.duplicate).length;
    if (created) await audit(ctx, visit.orgId, user._id, "inspection.recorded", "visit", visitId, { created, duplicates: out.length - created });
    return out;
  },
});

/** Bulk readings for assets (e.g. battery voltages / lux levels), idempotent on clientGeneratedId. */
export const recordReadings = mutation({
  args: { visitId: v.id("visits"), deviceId: v.optional(v.string()), readings: v.array(v.object({ assetId: v.id("assets"), ...readingInV.fields })) },
  handler: async (ctx, { visitId, deviceId, readings }) => {
    const { doc: visit, user, membership } = await loadForMember(ctx, visitId, "Visit", STAFF);
    if (membership.role === "engineer" && visit.engineerId !== user._id) fail("Only the visiting engineer can record on this visit");
    if (readings.length > 1000) fail("Send at most 1000 readings at a time");
    const byAsset = new Map<Id<"assets">, ReadingIn[]>();
    for (const { assetId, ...r } of readings) byAsset.set(assetId, [...(byAsset.get(assetId) ?? []), r]);
    const ids: Id<"readings">[] = [];
    for (const [assetId, rs] of byAsset) {
      const asset = await inOrg(ctx, assetId, visit.orgId, "Asset");
      if (asset.siteId !== visit.siteId) fail(`Asset ${asset.reference} is not at this site`);
      ids.push(...(await insertReadings(ctx, asset, rs, user._id, { visitId }, deviceId)));
    }
    return ids;
  },
});

/** Correct an inspection. Locked once an issued certificate covers it (reissue the certificate instead). */
export const update = mutation({
  args: { inspectionId: v.id("inspections"), responses: v.optional(v.array(responseV)), overallResult: v.optional(resultV) },
  handler: async (ctx, { inspectionId, responses, overallResult }) => {
    const { doc, user, membership } = await loadForMember(ctx, inspectionId, "Inspection", STAFF);
    if (membership.role === "engineer" && doc.engineerId !== user._id) fail("Only the inspecting engineer or the office can edit this");
    if (await isLocked(ctx, doc)) fail("This inspection is on an issued certificate and can't be edited");
    const template = doc.templateId ? await ctx.db.get(doc.templateId) : null;
    const patch = { ...(responses ? { responses: await cleanResponses(ctx, responses, template) } : {}), ...(overallResult ? { overallResult } : {}) };
    await ctx.db.patch(inspectionId, patch);
    await audit(ctx, doc.orgId, user._id, "inspection.updated", "inspection", inspectionId, { overallResult });
  },
});

export const listForVisit = query({
  args: { visitId: v.id("visits") },
  handler: async (ctx, { visitId }) => {
    const { doc: visit, membership } = await loadForMember(ctx, visitId, "Visit", STAFF);
    // Engineers: must be assigned to the visit's job.
    if (membership.role === "engineer") requireJobScope(membership, await loadDoc(ctx, visit.jobId, "Job"));
    return await ctx.db.query("inspections").withIndex("by_visit", (q) => q.eq("visitId", visit._id)).take(2000);
  },
});

export const listForAsset = query({
  args: { assetId: v.id("assets"), limit: v.optional(v.number()) },
  handler: async (ctx, { assetId, limit }) => {
    const { doc: asset, membership } = await loadForMember(ctx, assetId, "Asset", ANY);
    if (!(await canSeeSite(ctx, membership, await loadDoc(ctx, asset.siteId, "Site")))) fail("Asset not found");
    const rows = await ctx.db.query("inspections").withIndex("by_asset", (q) => q.eq("assetId", assetId)).order("desc").take(Math.min(limit ?? 50, 200));
    return membership.role === "client_user" ? rows.map(({ responses, ...r }) => ({ ...r, responses: responses.map(({ photoIds, ...x }) => x) })) : rows;
  },
});

/** Reading history for one asset and key (newest first), e.g. battery voltage over time. */
export const readingsForAsset = query({
  args: { assetId: v.id("assets"), key: v.string(), limit: v.optional(v.number()) },
  handler: async (ctx, { assetId, key, limit }) => {
    const { doc: asset, membership } = await loadForMember(ctx, assetId, "Asset", ANY);
    if (!(await canSeeSite(ctx, membership, await loadDoc(ctx, asset.siteId, "Site")))) fail("Asset not found");
    return await ctx.db.query("readings").withIndex("by_asset_and_key", (q) => q.eq("assetId", assetId).eq("key", key)).order("desc").take(Math.min(limit ?? 100, 1000));
  },
});
