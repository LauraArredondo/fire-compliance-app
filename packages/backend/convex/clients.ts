import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query } from "./_generated/server";
import { Id } from "./_generated/dataModel";
import { requireMember, assignedSiteIds } from "./lib/auth";
import { audit, fail, str, optStr, emails, cleanAddress, cleanContact, addressV, contactV, defined, loadForMember, STAFF, OFFICE, ANY } from "./lib/util";

const clientType = v.union(v.literal("commercial"), v.literal("residential"), v.literal("public_sector"), v.literal("managing_agent"));

/**
 * Clients. Office+: full records, paginated newest first; `search` uses the name search index.
 * Engineers: only clients of their assigned jobs' sites, as `{ _id, name }` (single page).
 */
export const list = query({
  args: { orgId: v.id("organizations"), status: v.optional(v.union(v.literal("active"), v.literal("archived"))), search: v.optional(v.string()), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, status, search, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, STAFF);
    if (membership.role === "engineer") {
      if (paginationOpts.cursor) return { page: [], isDone: true, continueCursor: "end" };
      const term = search?.trim().toLowerCase();
      const seen = new Set<string>();
      const out: { _id: Id<"clients">; name: string }[] = [];
      for (const sid of await assignedSiteIds(ctx, orgId, membership.userId)) {
        const site = await ctx.db.get(sid);
        if (!site || seen.has(site.clientId)) continue;
        seen.add(site.clientId);
        const c = await ctx.db.get(site.clientId);
        if (!c || c.orgId !== orgId || c.status !== (status ?? "active") || (term && !c.name.toLowerCase().includes(term))) continue;
        out.push({ _id: c._id, name: c.name });
      }
      out.sort((a, b) => a.name.localeCompare(b.name));
      return { page: out, isDone: true, continueCursor: "end" };
    }
    if (search?.trim()) {
      return await ctx.db.query("clients").withSearchIndex("search_name", (q) => q.search("name", search.trim()).eq("orgId", orgId)).paginate(paginationOpts);
    }
    return await ctx.db.query("clients").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", status ?? "active")).order("desc").paginate(paginationOpts);
  },
});

/**
 * One client. Office+: full record. Engineers: `{ _id, name }` only, and only for clients of their
 * assigned jobs' sites. Portal users: their own client without notes / account number / accounting id.
 */
export const get = query({
  args: { clientId: v.id("clients") },
  handler: async (ctx, { clientId }) => {
    const { doc, membership } = await loadForMember(ctx, clientId, "Client", ANY);
    if (membership.role === "engineer") {
      const sites = await assignedSiteIds(ctx, doc.orgId, membership.userId);
      let ok = false;
      for (const sid of sites) if ((await ctx.db.get(sid))?.clientId === clientId) { ok = true; break; }
      if (!ok) fail("You're not assigned to a job for this client");
      return { _id: doc._id, name: doc.name };
    }
    if (membership.role === "client_user") {
      const { notes, externalAccountingId, accountNumber, ...visible } = doc;
      return visible;
    }
    return doc;
  },
});

const editable = {
  name: v.optional(v.string()),
  accountNumber: v.optional(v.string()),
  type: v.optional(clientType),
  billingAddress: v.optional(addressV),
  primaryContact: v.optional(contactV),
  contacts: v.optional(v.array(contactV)),
  reminderEmails: v.optional(v.array(v.string())),
  notes: v.optional(v.string()),
};

function clean(a: { name?: string; accountNumber?: string; type?: any; billingAddress?: any; primaryContact?: any; contacts?: any[]; reminderEmails?: string[]; notes?: string }) {
  if (a.contacts && a.contacts.length > 30) fail("At most 30 contacts");
  return defined({
    name: a.name === undefined ? undefined : str(a.name, "Client name", 160),
    accountNumber: optStr(a.accountNumber, "Account number", 40),
    type: a.type,
    billingAddress: a.billingAddress && cleanAddress(a.billingAddress),
    primaryContact: a.primaryContact && cleanContact(a.primaryContact),
    contacts: a.contacts?.map(cleanContact),
    reminderEmails: emails(a.reminderEmails, "Reminder emails"),
    notes: optStr(a.notes, "Notes", 5000),
  });
}

export const create = mutation({
  args: { orgId: v.id("organizations"), ...editable, name: v.string(), type: clientType },
  handler: async (ctx, { orgId, ...a }) => {
    const { user } = await requireMember(ctx, orgId, OFFICE);
    const c = clean(a);
    const id = await ctx.db.insert("clients", { orgId, ...c, name: c.name!, type: a.type, status: "active", createdAt: Date.now() });
    await audit(ctx, orgId, user._id, "client.created", "client", id);
    return id;
  },
});

export const update = mutation({
  args: { clientId: v.id("clients"), ...editable },
  handler: async (ctx, { clientId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, clientId, "Client", OFFICE);
    const patch = clean(a);
    await ctx.db.patch(clientId, patch);
    await audit(ctx, doc.orgId, user._id, "client.updated", "client", clientId, patch);
  },
});

/** Archive (hide) or restore a client. Clients are never hard-deleted (certificates reference them). */
export const setArchived = mutation({
  args: { clientId: v.id("clients"), archived: v.boolean() },
  handler: async (ctx, { clientId, archived }) => {
    const { doc, user } = await loadForMember(ctx, clientId, "Client", OFFICE);
    await ctx.db.patch(clientId, { status: archived ? "archived" : "active" });
    if (archived) {
      const schedules = await ctx.db.query("serviceSchedules").withIndex("by_client", (q) => q.eq("clientId", clientId)).take(500);
      for (const s of schedules) if (s.status === "active") await ctx.db.patch(s._id, { status: "paused" });
    }
    await audit(ctx, doc.orgId, user._id, archived ? "client.archived" : "client.restored", "client", clientId);
  },
});
