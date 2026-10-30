import { v } from "convex/values";
import { mutation, query, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeClient, canSeeSite } from "./lib/auth";
import { audit, fail, str, optStr, loadForMember, requireFile, geoV, STAFF, ANY } from "./lib/util";

const entityType = v.union(v.literal("site"), v.literal("asset"), v.literal("job"), v.literal("visit"), v.literal("inspection"), v.literal("defect"), v.literal("certificate"), v.literal("quote"));
type EntityType = typeof entityType.type;
const TABLE: Record<EntityType, "sites" | "assets" | "jobs" | "visits" | "inspections" | "defects" | "certificates" | "quotes"> = {
  site: "sites", asset: "assets", job: "jobs", visit: "visits", inspection: "inspections", defect: "defects", certificate: "certificates", quote: "quotes",
};

/** Resolve the target record and check it belongs to the org; returns its site (if any) and client. */
async function resolveEntity(ctx: QueryCtx, orgId: Id<"organizations">, type: EntityType, entityId: string) {
  const id = ctx.db.normalizeId(TABLE[type], entityId);
  const doc = id ? ((await ctx.db.get(id)) as (Doc<typeof TABLE[EntityType]> & { siteId?: Id<"sites">; clientId?: Id<"clients"> }) | null) : null;
  if (!doc || doc.orgId !== orgId) fail(`${type} not found`);
  const siteId = type === "site" ? (doc._id as Id<"sites">) : doc.siteId;
  const site = siteId ? await ctx.db.get(siteId) : null;
  const clientId = doc.clientId ?? site?.clientId;
  return { doc, site, clientId, locked: type === "certificate" && (doc as Doc<"certificates">).status !== "draft" && (doc as Doc<"certificates">).status !== "pending_signature" };
}

export const generateUploadUrl = mutation({
  args: { orgId: v.id("organizations") },
  handler: async (ctx, { orgId }) => {
    await requireMember(ctx, orgId, STAFF);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Attach an uploaded file to any record (staff). Idempotent on clientGeneratedId. */
export const attach = mutation({
  args: {
    orgId: v.id("organizations"), entityType, entityId: v.string(), storageId: v.id("_storage"), fileName: v.string(),
    kind: v.optional(v.union(v.literal("photo"), v.literal("document"), v.literal("drawing"), v.literal("signature"), v.literal("other"))),
    caption: v.optional(v.string()), geo: v.optional(geoV), visibleToClient: v.optional(v.boolean()),
    clientGeneratedId: v.optional(v.string()), capturedAt: v.optional(v.number()), deviceId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { user } = await requireMember(ctx, a.orgId, STAFF);
    if (a.clientGeneratedId) {
      const d = (await ctx.db.query("attachments").withIndex("by_client_generated_id", (q) => q.eq("clientGeneratedId", a.clientGeneratedId)).take(5)).find((x) => x.orgId === a.orgId);
      if (d) return d._id;
    }
    const target = await resolveEntity(ctx, a.orgId, a.entityType, a.entityId);
    if (target.locked) fail("This certificate is issued; attachments can't be added");
    const meta = await requireFile(ctx, a.storageId, { maxBytes: 50 * 1024 * 1024, label: "File" });
    const mime = meta.contentType ?? "application/octet-stream";
    const kind = a.kind ?? (mime.startsWith("image/") ? "photo" : mime === "application/pdf" ? "document" : "other");
    if (a.geo && (Math.abs(a.geo.lat) > 90 || Math.abs(a.geo.lng) > 180)) fail("Invalid GPS position");
    const id = await ctx.db.insert("attachments", {
      orgId: a.orgId, storageId: a.storageId, fileName: str(a.fileName, "File name", 200), mimeType: mime, sizeBytes: meta.size, kind,
      entityType: a.entityType, entityId: target.doc._id, caption: optStr(a.caption, "Caption", 500), geo: a.geo,
      visibleToClient: a.visibleToClient ?? false, uploadedBy: user._id,
      clientGeneratedId: a.clientGeneratedId, capturedAt: a.capturedAt, deviceId: a.deviceId, syncedAt: Date.now(), createdAt: Date.now(),
    });
    await audit(ctx, a.orgId, user._id, "attachment.added", a.entityType, target.doc._id, { attachmentId: id, fileName: a.fileName });
    return id;
  },
});

/** Files attached to a record, with download URLs. Client users only see client-visible files. */
export const listForEntity = query({
  args: { orgId: v.id("organizations"), entityType, entityId: v.string() },
  handler: async (ctx, { orgId, entityType: type, entityId }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    const target = await resolveEntity(ctx, orgId, type, entityId);
    const isClient = membership.role === "client_user";
    if (isClient && (!target.clientId || !canSeeClient(membership, target.clientId) || (target.site && !(await canSeeSite(ctx, membership, target.site))))) fail(`${type} not found`);
    const rows = await ctx.db.query("attachments").withIndex("by_entity", (q) => q.eq("entityType", type).eq("entityId", target.doc._id)).take(500);
    const visible = isClient ? rows.filter((r) => r.visibleToClient) : rows;
    return Promise.all(visible.map(async (r) => ({ ...r, url: await ctx.storage.getUrl(r.storageId) })));
  },
});

export const update = mutation({
  args: { attachmentId: v.id("attachments"), caption: v.optional(v.string()), visibleToClient: v.optional(v.boolean()) },
  handler: async (ctx, { attachmentId, caption, visibleToClient }) => {
    const { doc, user } = await loadForMember(ctx, attachmentId, "Attachment", STAFF);
    await ctx.db.patch(attachmentId, { ...(caption !== undefined ? { caption: optStr(caption, "Caption", 500) } : {}), ...(visibleToClient !== undefined ? { visibleToClient } : {}) });
    await audit(ctx, doc.orgId, user._id, "attachment.updated", "attachment", attachmentId, { caption, visibleToClient });
  },
});

/** Delete an attachment and its file (uploader or office; not on issued certificates). */
export const remove = mutation({
  args: { attachmentId: v.id("attachments") },
  handler: async (ctx, { attachmentId }) => {
    const { doc, user, membership } = await loadForMember(ctx, attachmentId, "Attachment", STAFF);
    if (membership.role === "engineer" && doc.uploadedBy !== user._id) fail("Only the uploader or the office can delete this file");
    const target = await resolveEntity(ctx, doc.orgId, doc.entityType, doc.entityId).catch(() => null);
    if (target?.locked) fail("Files on an issued certificate can't be deleted");
    await ctx.db.delete(attachmentId);
    await ctx.storage.delete(doc.storageId);
    await audit(ctx, doc.orgId, user._id, "attachment.deleted", doc.entityType, doc.entityId, { attachmentId, fileName: doc.fileName });
  },
});

