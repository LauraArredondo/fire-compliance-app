import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, MutationCtx, QueryCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeSite } from "./lib/auth";
import { newPublicToken } from "./lib/tokens";
import { queueEmail, appUrl } from "./lib/notify";
import { quoteTotals, formatMoney } from "./lib/money";
import { insertJob } from "./jobs";
import { requestQuotePdf, quotePdfUrl } from "./lib/docPdf";
import { audit, withNames, fail, str, optStr, defined, loadDoc, loadForMember, inOrg, nextNumber, email as cleanEmail, validateLine, lineNet, requireFile, IMAGE, DAY, OFFICE, ANY } from "./lib/util";

const status = v.union(v.literal("draft"), v.literal("sent"), v.literal("viewed"), v.literal("accepted"), v.literal("declined"), v.literal("expired"), v.literal("superseded"));
const kind = v.union(v.literal("labour"), v.literal("material"), v.literal("equipment"), v.literal("service"), v.literal("other"));
const lineFields = {
  kind: v.optional(kind), description: v.string(), productCode: v.optional(v.string()), quantity: v.number(), unitPrice: v.number(),
  discountPercent: v.optional(v.number()), taxRate: v.optional(v.number()), defectId: v.optional(v.id("defects")), optional: v.optional(v.boolean()),
};
type LineArgs = { kind?: Doc<"quoteLineItems">["kind"]; description: string; productCode?: string; quantity: number; unitPrice: number; discountPercent?: number; taxRate?: number; defectId?: Id<"defects">; optional?: boolean };

const linesOf = (ctx: QueryCtx, quoteId: Id<"quotes">) => ctx.db.query("quoteLineItems").withIndex("by_quote", (q) => q.eq("quoteId", quoteId)).take(500);

async function recompute(ctx: MutationCtx, quoteId: Id<"quotes">) {
  const t = quoteTotals(await linesOf(ctx, quoteId));
  await ctx.db.patch(quoteId, { ...t, updatedAt: Date.now() });
  return t;
}
function requireDraft(q: Doc<"quotes">) {
  if (q.status !== "draft") fail(`This quote is ${q.status}; create a revision to change it`);
}
async function insertLine(ctx: MutationCtx, q: Doc<"quotes">, l: LineArgs, sortOrder: number, defaultTax: number) {
  const line = { quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent, taxRate: l.taxRate ?? defaultTax };
  validateLine(line);
  if (l.defectId) {
    const d = await inOrg(ctx, l.defectId, q.orgId, "Defect");
    if (d.clientId !== q.clientId) fail("That defect is for another client");
  }
  return await ctx.db.insert("quoteLineItems", {
    orgId: q.orgId, quoteId: q._id, sortOrder, kind: l.kind ?? "other", description: str(l.description, "Line description", 1000), productCode: optStr(l.productCode, "Product code", 60),
    ...line, lineTotal: lineNet(line), defectId: l.defectId, optional: l.optional ?? false, selected: true,
  });
}

/* ---------------- staff / portal reads ---------------- */

/** Quotes by status (staff) or the client user's quotes (sent onwards). Paginated, newest first. */
export const list = query({
  /** status: omitted = "draft" for staff (unchanged default); "all" = every status, newest first. */
  args: { orgId: v.id("organizations"), status: v.optional(v.union(status, v.literal("all"))), clientId: v.optional(v.id("clients")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, status: stIn, clientId, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    const st = stIn === "all" ? undefined : stIn;
    if (membership.role === "client_user") {
      const page = await ctx.db.query("quotes").withIndex("by_client", (q) => q.eq("clientId", membership.clientId!)).order("desc").paginate(paginationOpts);
      const out = [];
      for (const q of page.page) {
        if (q.status === "draft" || q.status === "superseded" || (st && q.status !== st)) continue;
        const site = q.siteId ? await ctx.db.get(q.siteId) : null;
        if (!site || (await canSeeSite(ctx, membership, site))) out.push(strip(q));
      }
      return { ...page, page: await withNames(ctx, out) };
    }
    if (clientId) {
      const page = await ctx.db.query("quotes").withIndex("by_client", (q) => q.eq("clientId", clientId)).order("desc").paginate(paginationOpts);
      return { ...page, page: await withNames(ctx, page.page.filter((q) => q.orgId === orgId && (!st || q.status === st))) };
    }
    const page = stIn === "all"
      ? await ctx.db.query("quotes").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").paginate(paginationOpts)
      : await ctx.db.query("quotes").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", st ?? "draft")).order("desc").paginate(paginationOpts);
    return { ...page, page: await withNames(ctx, page.page) };
  },
});
const strip = ({ acceptanceToken, externalAccountingId, ...q }: Doc<"quotes">) => q;

export const get = query({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const { doc, membership } = await loadForMember(ctx, quoteId, "Quote", ANY);
    if (membership.role === "client_user") {
      if (doc.status === "draft" || doc.status === "superseded") fail("Quote not found");
      if (doc.siteId && !(await canSeeSite(ctx, membership, await loadDoc(ctx, doc.siteId, "Site")))) fail("Quote not found");
    }
    const lines = await linesOf(ctx, quoteId);
    const base = membership.role === "client_user" ? strip(doc) : { ...doc, acceptUrl: doc.acceptanceToken ? appUrl(`quotes/${doc.acceptanceToken}`) : null };
    return { ...base, lines };
  },
});

/* ---------------- drafting ---------------- */

export const create = mutation({
  args: {
    clientId: v.id("clients"), siteId: v.optional(v.id("sites")), title: v.string(), introduction: v.optional(v.string()), terms: v.optional(v.string()),
    defectIds: v.optional(v.array(v.id("defects"))), validUntil: v.optional(v.number()), lines: v.optional(v.array(v.object(lineFields))),
  },
  handler: async (ctx, a) => {
    const { doc: client, user } = await loadForMember(ctx, a.clientId, "Client", OFFICE);
    if (client.status !== "active") fail("Client is archived");
    if (a.siteId) { const s = await inOrg(ctx, a.siteId, client.orgId, "Site"); if (s.clientId !== client._id) fail("Site belongs to another client"); }
    for (const d of a.defectIds ?? []) { const x = await inOrg(ctx, d, client.orgId, "Defect"); if (x.clientId !== client._id) fail("Defect belongs to another client"); }
    if ((a.lines?.length ?? 0) > 200) fail("At most 200 lines");
    const org = await loadDoc(ctx, client.orgId, "Organization");
    const now = Date.now();
    const quoteNumber = await nextNumber(ctx, org._id, "quote", "Q-");
    const id = await ctx.db.insert("quotes", {
      orgId: org._id, clientId: client._id, siteId: a.siteId, quoteNumber, revision: 0, title: str(a.title, "Quote title", 200),
      introduction: optStr(a.introduction, "Introduction", 5000), terms: optStr(a.terms, "Terms", 10000), defectIds: a.defectIds && [...new Set(a.defectIds)],
      currency: org.currency || "GBP", subtotal: 0, discountTotal: 0, taxTotal: 0, total: 0, status: "draft", validUntil: a.validUntil,
      createdBy: user._id, createdAt: now, updatedAt: now,
    });
    const q = (await ctx.db.get(id))!;
    for (const [i, l] of (a.lines ?? []).entries()) await insertLine(ctx, q, l, i + 1, org.defaultTaxRate ?? 20);
    for (const d of a.defectIds ?? []) { const x = (await ctx.db.get(d))!; if (x.status === "open") await ctx.db.patch(d, { status: "quoted", quoteId: id }); else await ctx.db.patch(d, { quoteId: id }); }
    await recompute(ctx, id);
    await audit(ctx, org._id, user._id, "quote.created", "quote", id, { quoteNumber });
    return id;
  },
});

export const update = mutation({
  args: { quoteId: v.id("quotes"), title: v.optional(v.string()), introduction: v.optional(v.string()), terms: v.optional(v.string()), validUntil: v.optional(v.number()), siteId: v.optional(v.id("sites")), defectIds: v.optional(v.array(v.id("defects"))) },
  handler: async (ctx, { quoteId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    requireDraft(doc);
    if (a.siteId) { const s = await inOrg(ctx, a.siteId, doc.orgId, "Site"); if (s.clientId !== doc.clientId) fail("Site belongs to another client"); }
    for (const d of a.defectIds ?? []) { const x = await inOrg(ctx, d, doc.orgId, "Defect"); if (x.clientId !== doc.clientId) fail("Defect belongs to another client"); }
    const patch = defined({ title: a.title === undefined ? undefined : str(a.title, "Quote title", 200), introduction: optStr(a.introduction, "Introduction", 5000), terms: optStr(a.terms, "Terms", 10000), validUntil: a.validUntil, siteId: a.siteId, defectIds: a.defectIds && [...new Set(a.defectIds)] });
    await ctx.db.patch(quoteId, { ...patch, updatedAt: Date.now() });
    await audit(ctx, doc.orgId, user._id, "quote.updated", "quote", quoteId, patch);
  },
});

export const addLine = mutation({
  args: { quoteId: v.id("quotes"), ...lineFields },
  handler: async (ctx, { quoteId, ...l }) => {
    const { doc, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    requireDraft(doc);
    const lines = await linesOf(ctx, quoteId);
    if (lines.length >= 200) fail("At most 200 lines");
    const org = await loadDoc(ctx, doc.orgId, "Organization");
    const id = await insertLine(ctx, doc, l, (lines[lines.length - 1]?.sortOrder ?? 0) + 1, org.defaultTaxRate ?? 20);
    const totals = await recompute(ctx, quoteId);
    await audit(ctx, doc.orgId, user._id, "quote.line_added", "quote", quoteId, { lineId: id });
    return { lineId: id, totals };
  },
});

export const updateLine = mutation({
  args: { lineId: v.id("quoteLineItems"), kind: v.optional(kind), description: v.optional(v.string()), productCode: v.optional(v.string()), quantity: v.optional(v.number()), unitPrice: v.optional(v.number()), discountPercent: v.optional(v.number()), taxRate: v.optional(v.number()), optional: v.optional(v.boolean()), sortOrder: v.optional(v.number()) },
  handler: async (ctx, { lineId, ...a }) => {
    const line = await loadDoc(ctx, lineId, "Line");
    const { doc, user } = await loadForMember(ctx, line.quoteId, "Quote", OFFICE);
    requireDraft(doc);
    const merged = { quantity: a.quantity ?? line.quantity, unitPrice: a.unitPrice ?? line.unitPrice, discountPercent: a.discountPercent ?? line.discountPercent, taxRate: a.taxRate ?? line.taxRate };
    validateLine(merged);
    const patch = { ...defined({ kind: a.kind, description: a.description === undefined ? undefined : str(a.description, "Line description", 1000), productCode: optStr(a.productCode, "Product code", 60), optional: a.optional, sortOrder: a.sortOrder }), ...merged, lineTotal: lineNet(merged) };
    await ctx.db.patch(lineId, patch);
    const totals = await recompute(ctx, doc._id);
    await audit(ctx, doc.orgId, user._id, "quote.line_updated", "quote", doc._id, { lineId });
    return totals;
  },
});

export const removeLine = mutation({
  args: { lineId: v.id("quoteLineItems") },
  handler: async (ctx, { lineId }) => {
    const line = await loadDoc(ctx, lineId, "Line");
    const { doc, user } = await loadForMember(ctx, line.quoteId, "Quote", OFFICE);
    requireDraft(doc);
    await ctx.db.delete(lineId);
    const totals = await recompute(ctx, doc._id);
    await audit(ctx, doc.orgId, user._id, "quote.line_removed", "quote", doc._id, { lineId, description: line.description });
    return totals;
  },
});

/** Delete a draft quote that was never sent. */
export const remove = mutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const { doc, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    requireDraft(doc);
    if (doc.previousRevisionId) fail("Revisions can't be deleted; send or keep them as drafts");
    for (const l of await linesOf(ctx, quoteId)) await ctx.db.delete(l._id);
    for (const d of doc.defectIds ?? []) { const x = await ctx.db.get(d); if (x?.quoteId === quoteId) await ctx.db.patch(d, { quoteId: undefined, status: x.status === "quoted" ? "open" : x.status }); }
    await ctx.db.delete(quoteId);
    await audit(ctx, doc.orgId, user._id, "quote.deleted", "quote", quoteId, { quoteNumber: doc.quoteNumber });
  },
});

/**
 * Send to the client: freezes the quote, creates the public acceptance link and queues an email
 * (dry run until email is configured). Recipient defaults to the client's primary contact.
 */
export const send = mutation({
  args: { quoteId: v.id("quotes"), to: v.optional(v.string()), message: v.optional(v.string()), validUntil: v.optional(v.number()) },
  handler: async (ctx, { quoteId, to, message, validUntil }) => {
    const { doc, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    if (doc.status !== "draft" && doc.status !== "sent" && doc.status !== "viewed") fail(`A ${doc.status} quote can't be sent`);
    const lines = await linesOf(ctx, quoteId);
    if (!lines.length) fail("Add at least one line before sending");
    const client = await loadDoc(ctx, doc.clientId, "Client");
    const recipient = to ? cleanEmail(to) : (client.primaryContact?.email ?? client.reminderEmails?.[0]);
    if (!recipient) fail("The client has no email address; pass `to`");
    const now = Date.now();
    const until = validUntil ?? doc.validUntil ?? now + 30 * DAY;
    if (until <= now) fail("Valid-until date must be in the future");
    const token = doc.acceptanceToken ?? newPublicToken(24);
    await ctx.db.patch(quoteId, { status: doc.status === "draft" ? "sent" : doc.status, sentAt: now, validUntil: until, acceptanceToken: token, updatedAt: now });
    const org = await loadDoc(ctx, doc.orgId, "Organization");
    const link = appUrl(`quotes/${token}`);
    await queueEmail(ctx, org, {
      to: recipient, type: "quote_sent", recipientType: "client", clientId: client._id, greetingName: client.primaryContact?.name,
      subject: `Quote ${doc.quoteNumber}${doc.revision ? ` rev ${doc.revision}` : ""}: ${doc.title}`, heading: doc.title,
      paragraphs: [optStr(message, "Message", 3000) ?? `Please find our quote ${doc.quoteNumber} below. You can review it and accept or decline online.`],
      details: [["Quote", doc.quoteNumber], ["Total (inc. VAT)", formatMoney(doc.total, doc.currency)], ["Valid until", new Date(until).toLocaleDateString("en-GB", { timeZone: org.timezone || "Europe/London" })]],
      cta: { label: "View and respond", url: link }, links: [{ label: "Download PDF copy", url: quotePdfUrl(token) }], statusLabel: "Quote",
    });
    await requestQuotePdf(ctx, quoteId);
    await audit(ctx, doc.orgId, user._id, "quote.sent", "quote", quoteId, { to: recipient });
    return { acceptUrl: link, pdfUrl: quotePdfUrl(token) };
  },
});

/** Copy a sent/declined/expired quote into a new draft revision; the old one becomes superseded. */
export const revise = mutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const { doc, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    if (!["sent", "viewed", "declined", "expired"].includes(doc.status)) fail(`A ${doc.status} quote can't be revised`);
    const now = Date.now();
    const { _id, _creationTime, status: _s, sentAt, viewedAt, acceptanceToken, acceptance, pdfStorageId, pdfHash, pdfStatus, pdfGeneratedAt, pdfError, jobId, ...rest } = doc;
    const id = await ctx.db.insert("quotes", { ...rest, revision: doc.revision + 1, status: "draft", previousRevisionId: doc._id, validUntil: undefined, createdBy: user._id, createdAt: now, updatedAt: now });
    for (const l of await linesOf(ctx, quoteId)) {
      const { _id: _l, _creationTime: _c, quoteId: _q, ...line } = l;
      await ctx.db.insert("quoteLineItems", { ...line, quoteId: id, selected: true });
    }
    await ctx.db.patch(quoteId, { status: "superseded", updatedAt: now });
    for (const d of doc.defectIds ?? []) { const x = await ctx.db.get(d); if (x?.quoteId === quoteId) await ctx.db.patch(d, { quoteId: id }); }
    await recompute(ctx, id);
    await audit(ctx, doc.orgId, user._id, "quote.revised", "quote", id, { from: quoteId, revision: doc.revision + 1 });
    return id;
  },
});

/* ---------------- public (token) ---------------- */

async function byToken(ctx: QueryCtx, token: string) {
  const t = token.trim();
  if (t.length < 16) return null;
  return await ctx.db.query("quotes").withIndex("by_acceptance_token", (q) => q.eq("acceptanceToken", t)).unique();
}
const isExpired = (q: Doc<"quotes">) => q.validUntil !== undefined && q.validUntil < Date.now() && (q.status === "sent" || q.status === "viewed");

/** PUBLIC: the client-facing view of a quote, by its acceptance link token. */
export const getByToken = query({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const q = await byToken(ctx, token);
    if (!q || q.status === "draft") return null;
    const [org, client, site, lines] = await Promise.all([ctx.db.get(q.orgId), ctx.db.get(q.clientId), q.siteId ? ctx.db.get(q.siteId) : null, linesOf(ctx, q._id)]);
    return {
      quoteNumber: q.quoteNumber, revision: q.revision, title: q.title, introduction: q.introduction ?? null, terms: q.terms ?? null,
      status: isExpired(q) ? ("expired" as const) : q.status, currency: q.currency, subtotal: q.subtotal, discountTotal: q.discountTotal, taxTotal: q.taxTotal, total: q.total,
      validUntil: q.validUntil ?? null, sentAt: q.sentAt ?? null,
      acceptance: q.acceptance ? { decision: q.acceptance.decision, decidedAt: q.acceptance.decidedAt, signedByName: q.acceptance.signature?.signedByName ?? null } : null,
      company: { name: org?.name ?? "", email: org?.email ?? null, phone: org?.phone ?? null, logoUrl: org?.logoId ? await ctx.storage.getUrl(org.logoId) : null },
      clientName: client?.name ?? "", siteName: site?.name ?? null,
      lines: lines.map((l) => ({ id: l._id, kind: l.kind, description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent ?? 0, taxRate: l.taxRate, lineTotal: l.lineTotal, optional: l.optional, selected: l.selected })),
      canRespond: (q.status === "sent" || q.status === "viewed") && !isExpired(q),
    };
  },
});

/** PUBLIC: record that the client opened the link (call once on page load). */
export const markViewed = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const q = await byToken(ctx, token);
    if (!q || q.status !== "sent") return null;
    await ctx.db.patch(q._id, { status: "viewed", viewedAt: Date.now() });
    await audit(ctx, q.orgId, undefined, "quote.viewed", "quote", q._id);
    return null;
  },
});

/** PUBLIC: upload URL for the acceptance signature image (only while the quote is open). */
export const generateSignatureUploadUrl = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const q = await byToken(ctx, token);
    if (!q || !(q.status === "sent" || q.status === "viewed") || isExpired(q)) fail("This quote can't be signed");
    return await ctx.storage.generateUploadUrl();
  },
});

/**
 * PUBLIC: accept or decline via the link. Accepting needs the signer's name (+ optional signature image)
 * and can opt in/out of optional lines; totals are recalculated from the selection.
 */
export const respond = mutation({
  args: {
    token: v.string(), decision: v.union(v.literal("accepted"), v.literal("declined")),
    signedByName: v.optional(v.string()), signedByRole: v.optional(v.string()), signatureImageId: v.optional(v.id("_storage")),
    purchaseOrderNumber: v.optional(v.string()), declineReason: v.optional(v.string()), selectedOptionalLineIds: v.optional(v.array(v.id("quoteLineItems"))),
    userAgent: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const q = await byToken(ctx, a.token);
    if (!q) fail("Quote not found");
    if (q.status === "accepted" || q.status === "declined") fail(`This quote has already been ${q.status}`);
    if (!(q.status === "sent" || q.status === "viewed")) fail("This quote is no longer open");
    if (isExpired(q)) { await ctx.db.patch(q._id, { status: "expired" }); fail("This quote has expired; please ask for an updated quote"); }
    const now = Date.now();
    const userId = await getAuthUserId(ctx);
    let signature: NonNullable<NonNullable<Doc<"quotes">["acceptance"]>["signature"]> | undefined;
    if (a.decision === "accepted") {
      const name = str(a.signedByName ?? "", "Your name", 120);
      if (a.signatureImageId) await requireFile(ctx, a.signatureImageId, { types: IMAGE, maxBytes: 2 * 1024 * 1024, label: "Signature" });
      const lines = await linesOf(ctx, q._id);
      const chosen = new Set(a.selectedOptionalLineIds ?? []);
      for (const id of chosen) if (!lines.some((l) => l._id === id && l.optional)) fail("Unknown optional line");
      for (const l of lines) if (l.optional) await ctx.db.patch(l._id, { selected: chosen.has(l._id) });
      await recompute(ctx, q._id);
      const fresh = (await ctx.db.get(q._id))!;
      const payload = JSON.stringify({ quote: q.quoteNumber, revision: q.revision, total: fresh.total, lines: lines.filter((l) => !l.optional || chosen.has(l._id)).map((l) => [l.description, l.quantity, l.unitPrice]) });
      const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
      signature = { signedByName: name, signedByRole: optStr(a.signedByRole, "Role", 80), signatureImageId: a.signatureImageId, signedAt: now, deviceInfo: optStr(a.userAgent, "Device", 300), signedByUserId: userId ?? undefined, contentHash: [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("") };
    }
    await ctx.db.patch(q._id, {
      status: a.decision,
      acceptance: defined({ decision: a.decision, decidedAt: now, signature, purchaseOrderNumber: optStr(a.purchaseOrderNumber, "PO number", 60), declineReason: a.decision === "declined" ? optStr(a.declineReason, "Reason", 2000) : undefined, acceptedByUserId: userId ?? undefined }) as NonNullable<Doc<"quotes">["acceptance"]>,
      updatedAt: now,
    });
    await requestQuotePdf(ctx, q._id);
    if (a.decision === "declined") for (const d of q.defectIds ?? []) { const x = await ctx.db.get(d); if (x?.status === "quoted") await ctx.db.patch(d, { status: "open" }); }
    await audit(ctx, q.orgId, userId ?? undefined, `quote.${a.decision}`, "quote", q._id, { signedByName: signature?.signedByName });
    const org = await ctx.db.get(q.orgId);
    if (org?.email) await queueEmail(ctx, org, {
      to: org.email, type: `quote_${a.decision}`, recipientType: "org", subject: `Quote ${q.quoteNumber} ${a.decision}`, heading: `Quote ${a.decision}`,
      paragraphs: [`${a.decision === "accepted" ? signature?.signedByName ?? "The client" : "The client"} ${a.decision} quote ${q.quoteNumber} (${q.title}).`],
      details: [["Quote", q.quoteNumber], ...(a.purchaseOrderNumber ? [["PO number", a.purchaseOrderNumber] as [string, string]] : [])],
      cta: { label: "Open quote", url: appUrl(`app/quotes/${q._id}`) }, links: [{ label: `Download ${a.decision} copy (PDF)`, url: quotePdfUrl(q.acceptanceToken!) }], statusLabel: "Quote update",
    });
    return { status: a.decision };
  },
});

/** Turn an accepted quote into a remedial job; linked defects become "scheduled". */
export const convertToJob = mutation({
  args: { quoteId: v.id("quotes"), siteId: v.optional(v.id("sites")), scheduledStart: v.optional(v.number()), scheduledEnd: v.optional(v.number()), assignedEngineerIds: v.optional(v.array(v.id("users"))) },
  handler: async (ctx, a) => {
    const { doc: q, user } = await loadForMember(ctx, a.quoteId, "Quote", OFFICE);
    if (q.status !== "accepted") fail("Only accepted quotes can be converted to a job");
    if (q.jobId) return q.jobId;
    const siteId = q.siteId ?? a.siteId;
    if (!siteId) fail("Pick the site for the job");
    const site = await inOrg(ctx, siteId, q.orgId, "Site");
    if (site.clientId !== q.clientId) fail("Site belongs to another client");
    const defects = (await Promise.all((q.defectIds ?? []).map((d) => ctx.db.get(d)))).filter((d): d is Doc<"defects"> => !!d);
    const disciplines = [...new Set(defects.map((d) => d.discipline))];
    for (const e of a.assignedEngineerIds ?? []) {
      const m = await ctx.db.query("memberships").withIndex("by_org_and_user", (x) => x.eq("orgId", q.orgId).eq("userId", e)).unique();
      if (!m || m.status !== "active" || m.role === "client_user") fail("Assigned engineers must be active team members");
    }
    const jobId = await insertJob(ctx, site, user._id, {
      type: "remedial", disciplines: disciplines.length ? disciplines : ["other"], title: q.title, description: `From quote ${q.quoteNumber}${q.revision ? ` rev ${q.revision}` : ""}`,
      priority: defects.some((d) => d.severity === "critical") ? "high" : "normal", assignedEngineerIds: a.assignedEngineerIds ?? [],
      scheduledStart: a.scheduledStart, scheduledEnd: a.scheduledEnd, purchaseOrderNumber: q.acceptance?.purchaseOrderNumber, quoteId: q._id,
      status: a.scheduledStart ? "scheduled" : "draft",
    });
    await ctx.db.patch(q._id, { jobId, updatedAt: Date.now() });
    for (const d of defects) if (["open", "quoted"].includes(d.status)) await ctx.db.patch(d._id, { status: "scheduled", remedialJobId: jobId });
    await audit(ctx, q.orgId, user._id, "quote.converted", "quote", q._id, { jobId });
    return jobId;
  },
});


/* ---------------- PDF ---------------- */

/**
 * PDF status + download URL. Staff any status; portal users only for quotes they can see (not drafts/superseded).
 * `publicUrl` is the stable emailed link (latest render), null for drafts.
 */
export const getPdf = query({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const { doc, membership } = await loadForMember(ctx, quoteId, "Quote", ANY);
    if (membership.role === "client_user") {
      if (doc.status === "draft" || doc.status === "superseded") fail("Quote not found");
      if (doc.siteId && !(await canSeeSite(ctx, membership, await loadDoc(ctx, doc.siteId, "Site")))) fail("Quote not found");
    }
    return {
      status: doc.status, pdfStatus: doc.pdfStatus ?? null, pdfError: membership.role === "client_user" ? null : (doc.pdfError ?? null),
      sha256: doc.pdfHash ?? null, generatedAt: doc.pdfGeneratedAt ?? null,
      url: doc.pdfStorageId ? await ctx.storage.getUrl(doc.pdfStorageId) : null,
      publicUrl: doc.acceptanceToken && doc.status !== "draft" ? quotePdfUrl(doc.acceptanceToken) : null,
    };
  },
});

/** Re-render the PDF now (office). Works for drafts too (watermarked DRAFT) as a preview. */
export const regeneratePdf = mutation({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const { doc, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    await requestQuotePdf(ctx, quoteId);
    await audit(ctx, doc.orgId, user._id, "quote.pdf_requested", "quote", quoteId);
    return null;
  },
});
