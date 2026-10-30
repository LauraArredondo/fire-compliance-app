import { v } from "convex/values";
import { Id } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { requireMember, canSeeSite, assignedSiteIds } from "./lib/auth";
import { newPublicToken } from "./lib/tokens";
import { audit, fail, str, optStr, cleanAddress, cleanContact, addressV, contactV, geoV, defined, loadForMember, inOrg, STAFF, OFFICE, ANY } from "./lib/util";

/** Sites for a client (staff or that client's portal users), or all org sites (office+). Engineers: only sites of their assigned jobs (one page). Paginated. */
export const list = query({
  args: { orgId: v.id("organizations"), clientId: v.optional(v.id("clients")), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, clientId, search, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    const isClient = membership.role === "client_user";
    if (membership.role === "engineer") {
      // Engineers: only sites of jobs assigned to them (single page; an engineer's site list is small).
      if (paginationOpts.cursor) return { page: [], isDone: true, continueCursor: "end" };
      const term = search?.trim().toLowerCase();
      const out = [];
      for (const id of await assignedSiteIds(ctx, orgId, membership.userId)) {
        const s = await ctx.db.get(id);
        if (!s || s.orgId !== orgId || (clientId && s.clientId !== clientId) || (term && !s.name.toLowerCase().includes(term))) continue;
        out.push({ ...s, clientName: (await ctx.db.get(s.clientId))?.name ?? "" });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return { page: out, isDone: true, continueCursor: "end" };
    }
    const cid = isClient ? membership.clientId : clientId;
    if (isClient && clientId && clientId !== cid) fail("Client not found");
    const page = search?.trim()
      ? await ctx.db.query("sites").withSearchIndex("search_name", (q) => {
          const s = q.search("name", search.trim()).eq("orgId", orgId);
          return cid ? s.eq("clientId", cid) : s;
        }).paginate(paginationOpts)
      : cid
        ? await ctx.db.query("sites").withIndex("by_client", (q) => q.eq("clientId", cid)).paginate(paginationOpts)
        : await ctx.db.query("sites").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").paginate(paginationOpts);
    const names = new Map<string, string>();
    const named = async <T extends { clientId: Id<"clients"> }>(rows: T[]) => {
      const out: (T & { clientName: string })[] = [];
      for (const r of rows) {
        if (!names.has(r.clientId)) names.set(r.clientId, (await ctx.db.get(r.clientId))?.name ?? "");
        out.push({ ...r, clientName: names.get(r.clientId)! });
      }
      return out;
    };
    if (!isClient) return { ...page, page: await named(page.page) };
    const visible = [];
    for (const s of page.page) if (s.orgId === orgId && (await canSeeSite(ctx, membership, s))) visible.push(s);
    return { ...page, page: await named(visible.map(({ accessNotes, ...s }) => s)) };
  },
});

export const get = query({
  args: { siteId: v.id("sites") },
  handler: async (ctx, { siteId }) => {
    const { doc, membership } = await loadForMember(ctx, siteId, "Site", ANY);
    if (!(await canSeeSite(ctx, membership, doc))) fail("Site not found");
    const client = await ctx.db.get(doc.clientId);
    const locations = await ctx.db.query("locations").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(1000);
    return { ...doc, clientName: client?.name ?? null, locations };
  },
});

const editable = {
  name: v.optional(v.string()),
  reference: v.optional(v.string()),
  address: v.optional(addressV),
  geo: v.optional(geoV),
  siteContact: v.optional(contactV),
  responsiblePerson: v.optional(contactV),
  accessNotes: v.optional(v.string()),
  hazards: v.optional(v.array(v.string())),
};

function clean(a: { name?: string; reference?: string; address?: any; geo?: { lat: number; lng: number }; siteContact?: any; responsiblePerson?: any; accessNotes?: string; hazards?: string[] }) {
  if (a.geo && (Math.abs(a.geo.lat) > 90 || Math.abs(a.geo.lng) > 180)) fail("Invalid GPS position");
  if (a.hazards && a.hazards.length > 30) fail("At most 30 hazards");
  return defined({
    name: a.name === undefined ? undefined : str(a.name, "Site name", 160),
    reference: optStr(a.reference, "Site reference", 40),
    address: a.address && cleanAddress(a.address),
    geo: a.geo,
    siteContact: a.siteContact && cleanContact(a.siteContact),
    responsiblePerson: a.responsiblePerson && cleanContact(a.responsiblePerson),
    accessNotes: optStr(a.accessNotes, "Access notes", 3000),
    hazards: a.hazards?.map((h) => str(h, "Hazard", 200)),
  });
}

export const create = mutation({
  args: { orgId: v.id("organizations"), clientId: v.id("clients"), ...editable, name: v.string(), address: addressV },
  handler: async (ctx, { orgId, clientId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    const client = await inOrg(ctx, clientId, orgId, "Client");
    if (client.status !== "active") fail("Client is archived");
    const c = clean(a);
    const id = await ctx.db.insert("sites", { orgId, clientId, ...c, name: c.name!, address: c.address!, qrToken: newPublicToken(), status: "active", createdAt: Date.now() });
    await audit(ctx, orgId, user._id, "site.created", "site", id);
    return id;
  },
});

/** Edit site details. Engineers may update access notes, hazards, contacts and GPS from the field. */
export const update = mutation({
  args: { siteId: v.id("sites"), ...editable },
  handler: async (ctx, { siteId, ...a }) => {
    const { doc, user, membership } = await loadForMember(ctx, siteId, "Site", STAFF);
    if (membership.role === "engineer" && (a.name !== undefined || a.reference !== undefined || a.address !== undefined)) fail("Engineers can't change a site's name, reference or address");
    const patch = clean(a);
    await ctx.db.patch(siteId, patch);
    await audit(ctx, doc.orgId, user._id, "site.updated", "site", siteId, patch);
  },
});

export const setArchived = mutation({
  args: { siteId: v.id("sites"), archived: v.boolean() },
  handler: async (ctx, { siteId, archived }) => {
    const { doc, user } = await loadForMember(ctx, siteId, "Site", OFFICE);
    await ctx.db.patch(siteId, { status: archived ? "archived" : "active" });
    if (archived) {
      const schedules = await ctx.db.query("serviceSchedules").withIndex("by_site", (q) => q.eq("siteId", siteId)).take(500);
      for (const s of schedules) if (s.status === "active") await ctx.db.patch(s._id, { status: "paused" });
    }
    await audit(ctx, doc.orgId, user._id, archived ? "site.archived" : "site.restored", "site", siteId);
  },
});
