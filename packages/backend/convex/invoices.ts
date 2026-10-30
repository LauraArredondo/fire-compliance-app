import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { mutation, query, MutationCtx } from "./_generated/server";
import { Doc, Id } from "./_generated/dataModel";
import { requireMember, canSeeSite } from "./lib/auth";
import { queueEmail, appUrl } from "./lib/notify";
import { included, formatMoney } from "./lib/money";
import { requestInvoicePdf, invoicePdfUrl } from "./lib/docPdf";
import { newPublicToken } from "./lib/tokens";
import { audit, withNames, fail, str, optStr, defined, loadDoc, loadForMember, inOrg, nextNumber, email as cleanEmail, validateLine, lineNet, lineTax, int, num, DAY, OFFICE, MANAGERS, ANY, OFFICE_OR_CLIENT } from "./lib/util";

const status = v.union(v.literal("draft"), v.literal("sent"), v.literal("partially_paid"), v.literal("paid"), v.literal("overdue"), v.literal("void"));
const lineIn = v.object({ description: v.string(), quantity: v.number(), unitPrice: v.number(), discountPercent: v.optional(v.number()), taxRate: v.optional(v.number()) });
type LineIn = typeof lineIn.type;
type Line = NonNullable<Doc<"invoices">["lines"]>[number];

function buildLines(lines: LineIn[], defaultTax: number): Line[] {
  if (!lines.length) fail("An invoice needs at least one line");
  if (lines.length > 200) fail("At most 200 lines");
  return lines.map((l) => {
    const x = { quantity: l.quantity, unitPrice: l.unitPrice, taxRate: l.taxRate ?? defaultTax, ...(l.discountPercent ? { discountPercent: l.discountPercent } : {}) };
    validateLine(x);
    return { description: str(l.description, "Line description", 1000), ...x, lineTotal: lineNet(x) };
  });
}
function totals(lines: Line[], discountTotal?: number) {
  discountTotal ??= lines.reduce((s, l) => s + (Math.round(l.quantity * l.unitPrice) - l.lineTotal), 0);
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const taxTotal = lines.reduce((s, l) => s + lineTax(l), 0);
  return { subtotal, taxTotal, total: subtotal + taxTotal, discountTotal };
}
/** Sent invoices past their due date read as overdue. */
/** Client users never see drafts, or invoices voided before they were sent. */
const hiddenFromClient = (i: Doc<"invoices">) => i.status === "draft" || (i.status === "void" && !i.sentAt);
const effective = (i: Doc<"invoices">) => ((i.status === "sent" || i.status === "partially_paid") && i.dueAt && i.dueAt < Date.now() ? { ...i, status: "overdue" as const } : i);

/* ---------------- reads ---------------- */

/** Invoices by status (office), or the client user's own invoices (sent onwards). Paginated. */
export const list = query({
  /** status: omitted = "draft" for staff (unchanged default); "all" = every status, newest first. "overdue" = derived. */
  args: { orgId: v.id("organizations"), status: v.optional(v.union(status, v.literal("all"))), clientId: v.optional(v.id("clients")), paginationOpts: paginationOptsValidator },
  handler: async (ctx, { orgId, status: stIn, clientId, paginationOpts }) => {
    const { membership } = await requireMember(ctx, orgId, ANY);
    if (membership.role === "engineer") fail("Insufficient permissions");
    const st = stIn === "all" ? undefined : stIn;
    if (membership.role === "client_user") {
      const page = await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", membership.clientId!)).order("desc").paginate(paginationOpts);
      const out = [];
      for (const i of page.page) {
        if (hiddenFromClient(i) || (st && effective(i).status !== st)) continue;
        const site = i.siteId ? await ctx.db.get(i.siteId) : null;
        if (!site || (await canSeeSite(ctx, membership, site))) out.push(effective(i));
      }
      return { ...page, page: await withNames(ctx, out) };
    }
    if (clientId) {
      const page = await ctx.db.query("invoices").withIndex("by_client", (q) => q.eq("clientId", clientId)).order("desc").paginate(paginationOpts);
      return { ...page, page: await withNames(ctx, page.page.filter((i) => i.orgId === orgId && (!st || effective(i).status === st)).map(effective)) };
    }
    if (st === "overdue") {
      const page = await ctx.db.query("invoices").withIndex("by_org_and_due", (q) => q.eq("orgId", orgId).lt("dueAt", Date.now())).paginate(paginationOpts);
      return { ...page, page: await withNames(ctx, page.page.map(effective).filter((i) => i.status === "overdue")) };
    }
    const page = stIn === "all"
      ? await ctx.db.query("invoices").withIndex("by_org", (q) => q.eq("orgId", orgId)).order("desc").paginate(paginationOpts)
      : await ctx.db.query("invoices").withIndex("by_org_and_status", (q) => q.eq("orgId", orgId).eq("status", st ?? "draft")).order("desc").paginate(paginationOpts);
    return { ...page, page: await withNames(ctx, page.page.map(effective)) };
  },
});

export const get = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const { doc, membership } = await loadForMember(ctx, invoiceId, "Invoice", OFFICE_OR_CLIENT);
    if (membership.role === "engineer") fail("Insufficient permissions");
    if (membership.role === "client_user") {
      if (hiddenFromClient(doc)) fail("Invoice not found");
      if (doc.siteId && !(await canSeeSite(ctx, membership, await loadDoc(ctx, doc.siteId, "Site")))) fail("Invoice not found");
      const { externalId, externalProvider, lastSyncedAt, pdfToken, pdfError, ...rest } = effective(doc);
      return { ...rest, balance: doc.total - doc.amountPaid };
    }
    return { ...effective(doc), balance: doc.total - doc.amountPaid };
  },
});

/* ---------------- create ---------------- */

async function insertInvoice(
  ctx: MutationCtx, org: Doc<"organizations">, userId: Id<"users">,
  a: { clientId: Id<"clients">; siteId?: Id<"sites">; jobId?: Id<"jobs">; quoteId?: Id<"quotes">; lines: Line[]; discountTotal?: number; paymentTermsDays?: number; notes?: string },
) {
  const invoiceNumber = await nextNumber(ctx, org._id, "invoice", "INV-");
  const id = await ctx.db.insert("invoices", {
    orgId: org._id, clientId: a.clientId, siteId: a.siteId, jobId: a.jobId, quoteId: a.quoteId, invoiceNumber, currency: org.currency || "GBP",
    ...totals(a.lines, a.discountTotal), amountPaid: 0, status: "draft", lines: a.lines, payments: [],
    paymentTermsDays: a.paymentTermsDays === undefined ? undefined : int(a.paymentTermsDays, "Payment terms (days)", 0, 365),
    notes: optStr(a.notes, "Notes", 5000), createdAt: Date.now(),
  });
  await audit(ctx, org._id, userId, "invoice.created", "invoice", id, { invoiceNumber, jobId: a.jobId, quoteId: a.quoteId });
  return id;
}

/** Manual invoice (office). Amounts in pence; VAT rate defaults to the company's rate. */
export const create = mutation({
  args: { clientId: v.id("clients"), siteId: v.optional(v.id("sites")), lines: v.array(lineIn), paymentTermsDays: v.optional(v.number()), notes: v.optional(v.string()) },
  handler: async (ctx, a) => {
    const { doc: client, user } = await loadForMember(ctx, a.clientId, "Client", OFFICE);
    if (a.siteId) { const s = await inOrg(ctx, a.siteId, client.orgId, "Site"); if (s.clientId !== client._id) fail("Site belongs to another client"); }
    const org = await loadDoc(ctx, client.orgId, "Organization");
    return await insertInvoice(ctx, org, user._id, { ...a, lines: buildLines(a.lines, org.defaultTaxRate ?? 20) });
  },
});

/** Invoice an accepted quote (selected lines, keeping unit prices and line discounts). */
export const createFromQuote = mutation({
  args: { quoteId: v.id("quotes"), paymentTermsDays: v.optional(v.number()), notes: v.optional(v.string()) },
  handler: async (ctx, { quoteId, paymentTermsDays, notes }) => {
    const { doc: q, user } = await loadForMember(ctx, quoteId, "Quote", OFFICE);
    if (q.status !== "accepted") fail("Only accepted quotes can be invoiced");
    const existing = await ctx.db.query("invoices").withIndex("by_quote", (x) => x.eq("quoteId", quoteId)).take(20);
    if (existing.some((i) => i.status !== "void")) fail("This quote has already been invoiced");
    const ql = (await ctx.db.query("quoteLineItems").withIndex("by_quote", (x) => x.eq("quoteId", quoteId)).take(500)).filter(included);
    const lines: Line[] = ql.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, ...(l.discountPercent ? { discountPercent: l.discountPercent } : {}), taxRate: l.taxRate, lineTotal: l.lineTotal }));
    if (!lines.length) fail("The quote has no lines to invoice");
    const org = await loadDoc(ctx, q.orgId, "Organization");
    return await insertInvoice(ctx, org, user._id, { clientId: q.clientId, siteId: q.siteId, quoteId, jobId: q.jobId, lines, discountTotal: q.discountTotal, paymentTermsDays, notes: notes ?? (q.acceptance?.purchaseOrderNumber ? `PO: ${q.acceptance.purchaseOrderNumber}` : undefined) });
  },
});

/** Invoice a completed job: from its accepted quote if it has one, otherwise from the lines given. Job becomes "invoiced". */
export const createFromJob = mutation({
  args: { jobId: v.id("jobs"), lines: v.optional(v.array(lineIn)), paymentTermsDays: v.optional(v.number()), notes: v.optional(v.string()) },
  handler: async (ctx, { jobId, lines, paymentTermsDays, notes }) => {
    const { doc: job, user } = await loadForMember(ctx, jobId, "Job", OFFICE);
    if (job.status !== "completed") fail(job.status === "invoiced" ? "This job has already been invoiced" : "Only completed jobs can be invoiced");
    const org = await loadDoc(ctx, job.orgId, "Organization");
    let built: Line[];
    let discountTotal: number | undefined;
    const quote = job.quoteId ? await ctx.db.get(job.quoteId) : null;
    if (lines?.length) built = buildLines(lines, org.defaultTaxRate ?? 20);
    else if (quote?.status === "accepted") {
      const ql = (await ctx.db.query("quoteLineItems").withIndex("by_quote", (x) => x.eq("quoteId", quote._id)).take(500)).filter(included);
      built = ql.map((l) => ({ description: l.description, quantity: l.quantity, unitPrice: l.unitPrice, ...(l.discountPercent ? { discountPercent: l.discountPercent } : {}), taxRate: l.taxRate, lineTotal: l.lineTotal }));
      discountTotal = quote.discountTotal;
    } else fail("Give the invoice lines (this job has no accepted quote)");
    const id = await insertInvoice(ctx, org, user._id, { clientId: job.clientId, siteId: job.siteId, jobId, quoteId: quote?._id, lines: built, discountTotal, paymentTermsDays, notes: notes ?? (job.purchaseOrderNumber ? `PO: ${job.purchaseOrderNumber}` : undefined) });
    await ctx.db.patch(jobId, { status: "invoiced", updatedAt: Date.now() });
    await audit(ctx, job.orgId, user._id, "job.status", "job", jobId, { from: job.status, to: "invoiced", invoiceId: id });
    return id;
  },
});

/* ---------------- edit / send / pay / void ---------------- */

export const update = mutation({
  args: { invoiceId: v.id("invoices"), lines: v.optional(v.array(lineIn)), paymentTermsDays: v.optional(v.number()), notes: v.optional(v.string()), siteId: v.optional(v.id("sites")) },
  handler: async (ctx, { invoiceId, ...a }) => {
    const { doc, user } = await loadForMember(ctx, invoiceId, "Invoice", OFFICE);
    if (doc.status !== "draft") fail("Only draft invoices can be edited; void and re-create instead");
    if (a.siteId) { const s = await inOrg(ctx, a.siteId, doc.orgId, "Site"); if (s.clientId !== doc.clientId) fail("Site belongs to another client"); }
    const org = await loadDoc(ctx, doc.orgId, "Organization");
    const lines = a.lines && buildLines(a.lines, org.defaultTaxRate ?? 20);
    const patch = { ...defined({ paymentTermsDays: a.paymentTermsDays === undefined ? undefined : int(a.paymentTermsDays, "Payment terms (days)", 0, 365), notes: optStr(a.notes, "Notes", 5000), siteId: a.siteId }), ...(lines ? { lines, ...totals(lines) } : {}) };
    await ctx.db.patch(invoiceId, patch);
    await audit(ctx, doc.orgId, user._id, "invoice.updated", "invoice", invoiceId, { fields: Object.keys(patch) });
  },
});

/** Issue and email the invoice (dry run until email is configured). Due date = issue + payment terms (default 30 days). */
export const send = mutation({
  args: { invoiceId: v.id("invoices"), to: v.optional(v.string()), message: v.optional(v.string()) },
  handler: async (ctx, { invoiceId, to, message }) => {
    const { doc, user } = await loadForMember(ctx, invoiceId, "Invoice", OFFICE);
    if (doc.status === "void" || doc.status === "paid") fail(`A ${doc.status} invoice can't be sent`);
    const client = await loadDoc(ctx, doc.clientId, "Client");
    const recipient = to ? cleanEmail(to) : (client.reminderEmails?.[0] ?? client.primaryContact?.email);
    if (!recipient) fail("The client has no email address; pass `to`");
    const org = await loadDoc(ctx, doc.orgId, "Organization");
    const now = Date.now();
    const issuedAt = doc.issuedAt ?? now;
    const dueAt = doc.dueAt ?? issuedAt + (doc.paymentTermsDays ?? 30) * DAY;
    const pdfToken = doc.pdfToken ?? newPublicToken(24);
    await ctx.db.patch(invoiceId, { status: doc.status === "draft" ? "sent" : doc.status, issuedAt, dueAt, sentAt: now, pdfToken, ...(doc.overdueSince !== undefined && dueAt >= now ? { overdueSince: undefined } : {}) });
    await requestInvoicePdf(ctx, invoiceId);
    const tz = org.timezone || "Europe/London";
    await queueEmail(ctx, org, {
      to: recipient, type: "invoice_sent", recipientType: "client", clientId: client._id, greetingName: client.primaryContact?.name,
      subject: `Invoice ${doc.invoiceNumber} from ${org.name}`, heading: `Invoice ${doc.invoiceNumber}`,
      paragraphs: [optStr(message, "Message", 3000) ?? `Please find invoice ${doc.invoiceNumber} for ${formatMoney(doc.total, doc.currency)}.`, ...(org.vatNumber ? [`VAT registration: ${org.vatNumber}`] : [])],
      details: [["Invoice", doc.invoiceNumber], ["Amount due", formatMoney(doc.total - doc.amountPaid, doc.currency)], ["Due", new Date(dueAt).toLocaleDateString("en-GB", { timeZone: tz })]],
      cta: { label: "View invoice", url: appUrl(`portal/invoices/${invoiceId}`) }, links: [{ label: "Download PDF invoice", url: invoicePdfUrl(pdfToken) }], statusLabel: "Invoice",
    });
    await audit(ctx, doc.orgId, user._id, "invoice.sent", "invoice", invoiceId, { to: recipient });
    return { dueAt, pdfUrl: invoicePdfUrl(pdfToken) };
  },
});

/** Record a payment (office). Status becomes partially_paid or paid; overpayment is refused. */
export const recordPayment = mutation({
  args: { invoiceId: v.id("invoices"), amount: v.number(), paidAt: v.optional(v.number()), method: v.union(v.literal("bank_transfer"), v.literal("card"), v.literal("cash"), v.literal("cheque"), v.literal("other")), reference: v.optional(v.string()) },
  handler: async (ctx, { invoiceId, amount, paidAt, method, reference }) => {
    const { doc, user } = await loadForMember(ctx, invoiceId, "Invoice", OFFICE);
    if (doc.status === "draft") fail("Send the invoice before recording payments");
    if (doc.status === "void" || doc.status === "paid") fail(`This invoice is ${doc.status}`);
    int(amount, "Amount (pence)", 1);
    const balance = doc.total - doc.amountPaid;
    if (amount > balance) fail(`Payment is more than the balance of ${formatMoney(balance, doc.currency)}`);
    const when = Math.min(paidAt ?? Date.now(), Date.now());
    num(when, "Payment date", doc.issuedAt ? doc.issuedAt - 365 * DAY : 0);
    const amountPaid = doc.amountPaid + amount;
    const paid = amountPaid >= doc.total;
    await ctx.db.patch(invoiceId, {
      amountPaid, status: paid ? "paid" : "partially_paid", paidAt: paid ? when : undefined, ...(paid ? { overdueSince: undefined } : {}),
      payments: [...(doc.payments ?? []), defined({ amount, paidAt: when, method, reference: optStr(reference, "Reference", 100), recordedBy: user._id }) as NonNullable<Doc<"invoices">["payments"]>[number]],
    });
    await audit(ctx, doc.orgId, user._id, "invoice.payment", "invoice", invoiceId, { amount, method });
    if (paid && doc.overdueSince !== undefined) await audit(ctx, doc.orgId, user._id, "invoice.overdue_cleared", "invoice", invoiceId, { reason: "paid", overdueSince: doc.overdueSince });
    await requestInvoicePdf(ctx, invoiceId);
    return { amountPaid, balance: doc.total - amountPaid, status: paid ? "paid" : "partially_paid" };
  },
});

/** Void an invoice (owner/admin, reason required). A voided job invoice puts the job back to completed. */
export const voidInvoice = mutation({
  args: { invoiceId: v.id("invoices"), reason: v.string() },
  handler: async (ctx, { invoiceId, reason }) => {
    const { doc, user } = await loadForMember(ctx, invoiceId, "Invoice", MANAGERS);
    if (doc.status === "void") fail("Invoice is already void");
    if (doc.amountPaid > 0) fail("This invoice has payments recorded; refund them before voiding");
    const why = str(reason, "Reason", 500);
    await ctx.db.patch(invoiceId, { status: "void", voidReason: why, overdueSince: undefined });
    if (doc.overdueSince !== undefined) await audit(ctx, doc.orgId, user._id, "invoice.overdue_cleared", "invoice", invoiceId, { reason: "void", overdueSince: doc.overdueSince });
    if (doc.jobId) {
      const job = await ctx.db.get(doc.jobId);
      if (job?.status === "invoiced") await ctx.db.patch(job._id, { status: "completed", updatedAt: Date.now() });
    }
    await audit(ctx, doc.orgId, user._id, "invoice.voided", "invoice", invoiceId, { reason: why });
    if (doc.sentAt || doc.pdfStorageId) await requestInvoicePdf(ctx, invoiceId);
  },
});

/* ---------------- PDF ---------------- */

/** PDF status + download URL. Office/managers any status; portal users only sent invoices they can see. Engineers can't. */
export const getPdf = query({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const { doc, membership } = await loadForMember(ctx, invoiceId, "Invoice", OFFICE_OR_CLIENT);
    if (membership.role === "engineer") fail("Insufficient permissions");
    if (membership.role === "client_user") {
      if (hiddenFromClient(doc)) fail("Invoice not found");
      if (doc.siteId && !(await canSeeSite(ctx, membership, await loadDoc(ctx, doc.siteId, "Site")))) fail("Invoice not found");
    }
    return {
      status: effective(doc).status, pdfStatus: doc.pdfStatus ?? null, pdfError: membership.role === "client_user" ? null : (doc.pdfError ?? null),
      sha256: doc.pdfHash ?? null, generatedAt: doc.pdfGeneratedAt ?? null,
      url: doc.pdfStorageId ? await ctx.storage.getUrl(doc.pdfStorageId) : null,
      publicUrl: doc.pdfToken && doc.status !== "draft" ? invoicePdfUrl(doc.pdfToken) : null,
    };
  },
});

/** Re-render the PDF now (office), e.g. after changing bank details or the logo. Drafts render as a DRAFT preview. */
export const regeneratePdf = mutation({
  args: { invoiceId: v.id("invoices") },
  handler: async (ctx, { invoiceId }) => {
    const { doc, user } = await loadForMember(ctx, invoiceId, "Invoice", OFFICE);
    await requestInvoicePdf(ctx, invoiceId);
    await audit(ctx, doc.orgId, user._id, "invoice.pdf_requested", "invoice", invoiceId);
    return null;
  },
});
