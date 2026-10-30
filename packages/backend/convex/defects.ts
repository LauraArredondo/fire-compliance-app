import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { requireMember, canSeeClient, canSeeSite, requireSiteScope, assignedSiteIds } from "./lib/auth";
import { discipline } from "./schema";
import { audit, withNames, fail, str, optStr, defined, loadDoc, loadForMember, inOrg, nextNumber, requireFile, IMAGE, STAFF, OFFICE, ANY } from "./lib/util";

const severity = v.union(v.literal("critical"), v.literal("major"), v.literal("minor"), v.literal("advisory"));
const status = v.union(v.literal("open"), v.literal("quoted"), v.literal("scheduled"), v.literal("in_progress"), v.literal("resolved"), v.literal("verified"), v.literal("closed_no_action"));
type Status = Doc<"defects">["status"];
const OPEN: Status[] = ["open", "quoted", "scheduled", "in_progress"];

/** Open (unresolved) defects for a site. Client users only see client-visible defects. */
export const openForSite = query({
  args: { orgId: v.id("organizations"), siteId: v.id("sites") },
  handler: async (ctx, { orgId, siteId }) => {
    const { membership } = await requireMember(ctx, orgId);
    const site = await ctx.db.get(siteId);
    if (!site || site.orgId !== orgId || !canSeeClient(membership, site.clientId) || !(await canSeeSite(ctx, membership, site))) fail("Site not found");
    const results = await Promise.all(OPEN.map((s) => ctx.db.query("defects").withIndex("by_site_and_status", (q) => q.eq("siteId", siteId).eq("status", s)).take(500)));
    const all = results.flat();
    return membership.role === "client_user" ? all.filter((d) => d.visibleToClient) : all;
  },
});

/** Defects by status: org-wide (office+), sites of assigned jobs (engineers), or the client user's client. Paginated. */
export const list = query({
  /** status: omitted = "open" (unchanged default); "all" = every status, newest first. */
  args: { orgId: v.id("organizations"), status: v.optional(v.union(status, v.literal("all"))), siteId: v.optional(v.id("sites")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, status: st, siteId, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    const all = st === "all";
    const s = st === "all" || st === undefined ? "open" : st;
    if (membership.role === "client_user") {
      const page = await ctx.db.query("defects").withIndex("by_client_and_status", (q) => (all ? q.eq("clientId", membership.clientId!) : q.eq("clientId", membership.clientId!).eq("status", s))).order("desc").paginate(paginationOpts);
      const out = [];
      for (const d of page.page) {
        if (!d.visibleToClient || (siteId && d.siteId !== siteId)) continue;
        const site = await ctx.db.get(d.siteId);
        if (site && (await canSeeSite(ctx, membership, site))) out.push(d);
      }
      return { ...page, page: await withNames(ctx, out) };
    }
    if (siteId) {
      await inOrg(ctx, siteId, orgId, "Site");
      await requireSiteScope(ctx, membership, siteId);
      const page = await ctx.db.query("defects").withIndex("by_site_and_status", (q) => (all ? q.eq("siteId", siteId) : q.eq("siteId", siteId).eq("status", s))).order("desc").paginate(paginationOpts);
      return { ...page, page: await withNames(ctx, page.page) };
    }
    const page = all
      ? await ctx.db.query("defects").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").paginate(paginationOpts)
      : await ctx.db.query("defects").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", s)).order("desc").paginate(paginationOpts);
    if (membership.role === "engineer") {
      // Engineers: only defects on sites of their assigned jobs (pages may be shorter than numItems).
      const allowed = new Set<string>(await assignedSiteIds(ctx, orgId, membership.userId));
      return { ...page, page: await withNames(ctx, page.page.filter((d) => allowed.has(d.siteId))) };
    }
    return { ...page, page: await withNames(ctx, page.page) };
  },
});

export const get = query({
  args: { defectId: v.id("defects") },
  handler: async (ctx, { defectId }) => {
    const { doc, membership } = await loadForMember(ctx, defectId, "Defect", ANY);
    if (membership.role === "client_user" && (!doc.visibleToClient || !(await canSeeSite(ctx, membership, await loadDoc(ctx, doc.siteId, "Site"))))) fail("Defect not found");
    const photoUrls = await Promise.all((doc.photoIds ?? []).map((id) => ctx.storage.getUrl(id)));
    return { ...doc, photoUrls };
  },
});

async function checkPhotos(ctx: Parameters<typeof requireFile>[0], ids?: Doc<"defects">["photoIds"]) {
  if (!ids) return;
  if (ids.length > 20) fail("At most 20 photos per defect");
  for (const id of ids) await requireFile(ctx, id, { types: IMAGE, maxBytes: 15 * 1024 * 1024, label: "Photo" });
}

/** Raise a defect (staff, e.g. from the field). Idempotent on clientGeneratedId. */
export const raise = mutation({
  args: {
    siteId: v.id("sites"), assetId: v.optional(v.id("assets")), locationId: v.optional(v.id("locations")), inspectionId: v.optional(v.id("inspections")), visitId: v.optional(v.id("visits")),
    discipline: v.optional(discipline), title: v.string(), description: v.optional(v.string()), severity, recommendedAction: v.optional(v.string()),
    photoIds: v.optional(v.array(v.id("_storage"))), targetResolutionAt: v.optional(v.number()), visibleToClient: v.optional(v.boolean()),
    clientGeneratedId: v.optional(v.string()), capturedAt: v.optional(v.number()), deviceId: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const { doc: site, user } = await loadForMember(ctx, a.siteId, "Site", STAFF);
    if (a.clientGeneratedId) {
      const d = (await ctx.db.query("defects").withIndex("by_client_generated_id", (q) => q.eq("clientGeneratedId", a.clientGeneratedId)).take(5)).find((x) => x.orgId === site.orgId);
      if (d) return d._id;
    }
    const asset = a.assetId ? await inOrg(ctx, a.assetId, site.orgId, "Asset") : null;
    if (asset && asset.siteId !== site._id) fail("Asset is not at this site");
    if (a.locationId) { const l = await ctx.db.get(a.locationId); if (!l || l.siteId !== site._id) fail("Location not found at this site"); }
    if (a.inspectionId) { const i = await inOrg(ctx, a.inspectionId, site.orgId, "Inspection"); if (i.siteId !== site._id) fail("Inspection is from another site"); }
    if (a.visitId) { const vi = await inOrg(ctx, a.visitId, site.orgId, "Visit"); if (vi.siteId !== site._id) fail("Visit is from another site"); }
    const disc = asset?.discipline ?? a.discipline;
    if (!disc) fail("Discipline is required when no asset is given");
    await checkPhotos(ctx, a.photoIds);
    const now = Date.now();
    const reference = await nextNumber(ctx, site.orgId, "defect", "DEF-");
    const id = await ctx.db.insert("defects", {
      orgId: site.orgId, clientId: site.clientId, siteId: site._id, assetId: asset?._id, locationId: a.locationId ?? asset?.locationId, inspectionId: a.inspectionId, visitId: a.visitId,
      discipline: disc, reference, title: str(a.title, "Defect title", 200), description: optStr(a.description, "Description", 5000), severity: a.severity, status: "open",
      recommendedAction: optStr(a.recommendedAction, "Recommended action", 2000), photoIds: a.photoIds, raisedBy: user._id, raisedAt: Math.min(a.capturedAt ?? now, now),
      targetResolutionAt: a.targetResolutionAt, visibleToClient: a.visibleToClient ?? true,
      clientGeneratedId: a.clientGeneratedId, capturedAt: a.capturedAt, deviceId: a.deviceId, syncedAt: now,
    });
    if (asset && (a.severity === "critical" || a.severity === "major") && asset.status === "in_service") await ctx.db.patch(asset._id, { status: "defective", updatedAt: now });
    await audit(ctx, site.orgId, user._id, "defect.raised", "defect", id, { reference, severity: a.severity });
    return id;
  },
});

export const update = mutation({
  args: { defectId: v.id("defects"), title: v.optional(v.string()), description: v.optional(v.string()), severity: v.optional(severity), recommendedAction: v.optional(v.string()), photoIds: v.optional(v.array(v.id("_storage"))), targetResolutionAt: v.optional(v.number()), visibleToClient: v.optional(v.boolean()) },
  handler: async (ctx, { defectId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, defectId, "Defect", STAFF);
    if (doc.status === "verified" || doc.status === "closed_no_action") fail("A closed defect can't be edited");
    await checkPhotos(ctx, a.photoIds);
    const patch = defined({ title: a.title === undefined ? undefined : str(a.title, "Defect title", 200), description: optStr(a.description, "Description", 5000), severity: a.severity, recommendedAction: optStr(a.recommendedAction, "Recommended action", 2000), photoIds: a.photoIds, targetResolutionAt: a.targetResolutionAt, visibleToClient: a.visibleToClient });
    await ctx.db.patch(defectId, patch);
    await audit(ctx, doc.orgId, user._id, "defect.updated", "defect", defectId, patch);
  },
});

/** Move a defect through its life cycle. Resolving records who/when; verifying or closing needs the office. */
export const setStatus = mutation({
  args: { defectId: v.id("defects"), status, resolutionNotes: v.optional(v.string()) },
  handler: async (ctx, { defectId, status: to, resolutionNotes }) => {
    const { doc, user, membership } = await loadForMember(ctx, defectId, "Defect", STAFF);
    if (doc.status === to) return;
    if ((to === "verified" || to === "closed_no_action") && membership.role === "engineer") fail("Only the office can verify or close defects");
    if (to === "verified" && doc.status !== "resolved") fail("Only resolved defects can be verified");
    if (doc.status === "verified" && to !== "open") fail("A verified defect can only be reopened");
    const notes = optStr(resolutionNotes, "Resolution notes", 2000);
    if (to === "closed_no_action" && !notes && !doc.resolutionNotes) fail("Give a reason for closing without action");
    const now = Date.now();
    const resolving = to === "resolved" || to === "closed_no_action";
    await ctx.db.patch(defectId, {
      status: to,
      resolutionNotes: notes ?? doc.resolutionNotes,
      resolvedAt: resolving ? now : OPEN.includes(to) ? undefined : doc.resolvedAt,
      resolvedBy: resolving ? user._id : OPEN.includes(to) ? undefined : doc.resolvedBy,
    });
    if (resolving && doc.assetId) {
      const others = await ctx.db.query("defects").withIndex("by_asset", (q) => q.eq("assetId", doc.assetId)).take(200);
      const asset = await ctx.db.get(doc.assetId);
      if (asset?.status === "defective" && !others.some((d) => d._id !== defectId && OPEN.includes(d.status) && (d.severity === "critical" || d.severity === "major"))) await ctx.db.patch(asset._id, { status: "in_service", updatedAt: now });
    }
    await audit(ctx, doc.orgId, user._id, "defect.status", "defect", defectId, { from: doc.status, to, notes });
  },
});

/** Link a defect to a quote (marks it "quoted") or clear the link. */
export const linkQuote = mutation({
  args: { defectId: v.id("defects"), quoteId: v.union(v.id("quotes"), v.null()) },
  handler: async (ctx, { defectId, quoteId }) => {
    const { doc, user } = await loadForMember(ctx, defectId, "Defect", OFFICE);
    if (quoteId) {
      const q = await inOrg(ctx, quoteId, doc.orgId, "Quote");
      if (q.clientId !== doc.clientId) fail("That quote is for another client");
      if (!(q.defectIds ?? []).includes(defectId)) await ctx.db.patch(q._id, { defectIds: [...(q.defectIds ?? []), defectId], updatedAt: Date.now() });
    } else if (doc.quoteId) {
      const q = await ctx.db.get(doc.quoteId);
      if (q) await ctx.db.patch(q._id, { defectIds: (q.defectIds ?? []).filter((d) => d !== defectId), updatedAt: Date.now() });
    }
    await ctx.db.patch(defectId, { quoteId: quoteId ?? undefined, status: quoteId && doc.status === "open" ? "quoted" : !quoteId && doc.status === "quoted" ? "open" : doc.status });
    await audit(ctx, doc.orgId, user._id, "defect.linked_quote", "defect", defectId, { quoteId });
  },
});

/** Link a defect to a remedial job (marks it "scheduled") or clear the link. */
export const linkJob = mutation({
  args: { defectId: v.id("defects"), jobId: v.union(v.id("jobs"), v.null()) },
  handler: async (ctx, { defectId, jobId }) => {
    const { doc, user } = await loadForMember(ctx, defectId, "Defect", OFFICE);
    if (jobId) {
      const j = await inOrg(ctx, jobId, doc.orgId, "Job");
      if (j.siteId !== doc.siteId) fail("That job is at another site");
    }
    await ctx.db.patch(defectId, { remedialJobId: jobId ?? undefined, status: jobId && (doc.status === "open" || doc.status === "quoted") ? "scheduled" : !jobId && doc.status === "scheduled" ? (doc.quoteId ? "quoted" : "open") : doc.status });
    await audit(ctx, doc.orgId, user._id, "defect.linked_job", "defect", defectId, { jobId });
  },
});
