/**
 * Internal data loaders + storage bookkeeping for quote and invoice PDFs
 * (rendered by commercialPdf.ts, served by http.ts /pdf/...).
 */
import { v } from "convex/values";
import { internalMutation, internalQuery, QueryCtx } from "./_generated/server";
import { Doc } from "./_generated/dataModel";
import { appUrl } from "./lib/notify";
import { audit } from "./lib/util";

function orgData(org: Doc<"organizations">) {
  return {
    name: org.name, legalName: org.legalName ?? null, address: org.address ?? null, phone: org.phone ?? null, email: org.email ?? null,
    registrationNumber: org.registrationNumber ?? null, vatNumber: org.vatNumber ?? null,
    accreditations: (org.accreditations ?? []).map((a) => ({ body: a.body, scheme: a.scheme ?? null, number: a.number ?? null })),
    logoId: org.logoId ?? null, timezone: org.timezone || "Europe/London", bankDetails: org.bankDetails ?? null,
    quoteTerms: org.quoteTerms ?? null, invoiceFooter: org.invoiceFooter ?? null,
  };
}
async function partyData(ctx: QueryCtx, clientId: Doc<"clients">["_id"], siteId: Doc<"sites">["_id"] | undefined) {
  const client = await ctx.db.get(clientId);
  const site = siteId ? await ctx.db.get(siteId) : null;
  return {
    client: { name: client?.name ?? "", address: client?.billingAddress ?? null, contact: client?.primaryContact ?? null },
    site: site ? { name: site.name, reference: site.reference ?? null, address: site.address } : null,
  };
}

export const quoteData = internalQuery({
  args: { quoteId: v.id("quotes") },
  handler: async (ctx, { quoteId }) => {
    const q = await ctx.db.get(quoteId);
    if (!q) return null;
    const org = await ctx.db.get(q.orgId);
    if (!org) return null;
    const lines = await ctx.db.query("quoteLineItems").withIndex("by_quote", (x) => x.eq("quoteId", quoteId)).take(500);
    const defects = [];
    for (const id of q.defectIds ?? []) {
      const d = await ctx.db.get(id);
      if (!d) continue;
      const site = d.siteId !== q.siteId ? await ctx.db.get(d.siteId) : null;
      defects.push({ reference: d.reference, severity: d.severity, title: d.title, recommendedAction: d.recommendedAction ?? null, siteName: site?.name ?? null });
    }
    const job = q.jobId ? await ctx.db.get(q.jobId) : null;
    const prev = q.previousRevisionId ? await ctx.db.get(q.previousRevisionId) : null;
    const expired = q.validUntil !== undefined && q.validUntil < Date.now() && (q.status === "sent" || q.status === "viewed");
    return {
      org: orgData(org), ...(await partyData(ctx, q.clientId, q.siteId)),
      quote: {
        quoteNumber: q.quoteNumber, revision: q.revision, title: q.title, introduction: q.introduction ?? null, terms: q.terms ?? null,
        status: expired ? ("expired" as const) : q.status, currency: q.currency, subtotal: q.subtotal, discountTotal: q.discountTotal, taxTotal: q.taxTotal, total: q.total,
        createdAt: q.createdAt, sentAt: q.sentAt ?? null, validUntil: q.validUntil ?? null, previousRevision: prev ? `${prev.quoteNumber}${prev.revision ? ` rev ${prev.revision}` : ""}` : null,
        acceptance: q.acceptance ?? null, jobNumber: job?.jobNumber ?? null,
      },
      lines: lines.map((l) => ({ kind: l.kind, description: l.description, productCode: l.productCode ?? null, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent ?? 0, taxRate: l.taxRate, lineTotal: l.lineTotal, optional: l.optional, selected: l.selected })),
      defects,
      acceptUrl: q.acceptanceToken ? appUrl(`quotes/${q.acceptanceToken}`) : null,
    };
  },
});

export const invoiceData = internalQuery({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const i = await ctx.db.get(invoiceId);
    if (!i) return null;
    const org = await ctx.db.get(i.orgId);
    if (!org) return null;
    const job = i.jobId ? await ctx.db.get(i.jobId) : null;
    const quote = i.quoteId ? await ctx.db.get(i.quoteId) : null;
    const overdue = (i.status === "sent" || i.status === "partially_paid") && !!i.dueAt && i.dueAt < Date.now();
    return {
      org: orgData(org), ...(await partyData(ctx, i.clientId, i.siteId)),
      invoice: {
        invoiceNumber: i.invoiceNumber, status: i.status, overdue, currency: i.currency, subtotal: i.subtotal, taxTotal: i.taxTotal, total: i.total,
        discountTotal: i.discountTotal ?? 0, amountPaid: i.amountPaid, balance: i.total - i.amountPaid, createdAt: i.createdAt,
        issuedAt: i.issuedAt ?? null, dueAt: i.dueAt ?? null, paidAt: i.paidAt ?? null, paymentTermsDays: i.paymentTermsDays ?? 30,
        notes: i.notes ?? null, voidReason: i.voidReason ?? null, payments: (i.payments ?? []).map((p) => ({ amount: p.amount, paidAt: p.paidAt, method: p.method, reference: p.reference ?? null })),
      },
      lines: (i.lines ?? []).map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, discountPercent: l.discountPercent ?? 0, taxRate: l.taxRate, lineTotal: l.lineTotal })),
      job: job ? { jobNumber: job.jobNumber, purchaseOrderNumber: job.purchaseOrderNumber ?? null } : null,
      quote: quote ? { quoteNumber: quote.quoteNumber, revision: quote.revision, purchaseOrderNumber: quote.acceptance?.purchaseOrderNumber ?? null } : null,
    };
  },
});

const target = { quoteId: v.optional(v.id("quotes")), invoiceId: v.optional(v.id("invoices")) };

/** Store the rendered PDF (replacing the previous file) with its SHA-256 fingerprint. */
export const savePdf = internalMutation({
  args: { ...target, storageId: v.id("_storage"), sha256: v.string(), bytes: v.number() },
  handler: async (ctx, { quoteId, invoiceId, storageId, sha256, bytes }) => {
    const doc = quoteId ? await ctx.db.get(quoteId) : invoiceId ? await ctx.db.get(invoiceId) : null;
    if (!doc) { await ctx.storage.delete(storageId); return; }
    if (doc.pdfStorageId && doc.pdfStorageId !== storageId) await ctx.storage.delete(doc.pdfStorageId);
    await ctx.db.patch(doc._id, { pdfStorageId: storageId, pdfHash: sha256, pdfStatus: "ready", pdfGeneratedAt: Date.now(), pdfError: undefined });
    await audit(ctx, doc.orgId, undefined, `${quoteId ? "quote" : "invoice"}.pdf_generated`, quoteId ? "quote" : "invoice", doc._id, { sha256, bytes, status: doc.status });
  },
});

export const markPdfFailed = internalMutation({
  args: { ...target, error: v.string() },
  handler: async (ctx, { quoteId, invoiceId, error }) => {
    const id = quoteId ?? invoiceId;
    if (id && (await ctx.db.get(id))) await ctx.db.patch(id, { pdfStatus: "failed", pdfError: error.slice(0, 500) });
  },
});

/** For the public /pdf/q/<token> and /pdf/i/<token> routes. Drafts are never served. */
export const pdfForToken = internalQuery({
  args: { kind: v.union(v.literal("q"), v.literal("i")), token: v.string() },
  handler: async (ctx, { kind, token }) => {
    const t = token.trim();
    if (t.length < 16) return null;
    if (kind === "q") {
      const q = await ctx.db.query("quotes").withIndex("by_acceptance_token", (x) => x.eq("acceptanceToken", t)).unique();
      if (!q || q.status === "draft") return null;
      return { storageId: q.pdfStorageId ?? null, pending: q.pdfStatus === "pending", filename: `${q.quoteNumber}${q.revision ? `-rev${q.revision}` : ""}.pdf`, sha256: q.pdfHash ?? null };
    }
    const i = await ctx.db.query("invoices").withIndex("by_pdf_token", (x) => x.eq("pdfToken", t)).unique();
    if (!i || i.status === "draft") return null;
    return { storageId: i.pdfStorageId ?? null, pending: i.pdfStatus === "pending", filename: `${i.invoiceNumber}.pdf`, sha256: i.pdfHash ?? null };
  },
});
