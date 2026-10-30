import { MutationCtx } from "../_generated/server";
import { Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import { httpUrl } from "./notify";

/** Mark the quote's PDF as pending and render it in the background. */
export async function requestQuotePdf(ctx: MutationCtx, quoteId: Id<"quotes">) {
  await ctx.db.patch(quoteId, { pdfStatus: "pending", pdfError: undefined });
  await ctx.scheduler.runAfter(0, internal.commercialPdf.generateQuote, { quoteId });
}
/** Mark the invoice's PDF as pending and render it in the background. */
export async function requestInvoicePdf(ctx: MutationCtx, invoiceId: Id<"invoices">) {
  await ctx.db.patch(invoiceId, { pdfStatus: "pending", pdfError: undefined });
  await ctx.scheduler.runAfter(0, internal.commercialPdf.generateInvoice, { invoiceId });
}

/** Stable public download links (served by http.ts; always the latest render). */
export const quotePdfUrl = (acceptanceToken: string) => httpUrl(`pdf/q/${acceptanceToken}`);
export const invoicePdfUrl = (pdfToken: string) => httpUrl(`pdf/i/${pdfToken}`);
