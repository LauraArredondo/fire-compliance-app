import { MutationCtx } from "../_generated/server";
import { Doc } from "../_generated/dataModel";
import { requestInvoicePdf } from "./docPdf";
import { DAY } from "./reminderConfig";

/**
 * Daily overdue pass for one org. Stored status stays sent / partially_paid (reads already derive
 * "overdue" from dueAt); this records *when* it became overdue (`overdueSince`), writes an audit entry
 * and refreshes the PDF so it shows OVERDUE. Clears stale flags (paid / void / due date moved).
 * Returns the invoices that are overdue at `now` (for reminders).
 */
export async function flagOverdueInvoices(ctx: MutationCtx, org: Doc<"organizations">, now: number) {
  const orgId = org._id;
  let flagged = 0;
  let cleared = 0;
  const overdue: Doc<"invoices">[] = [];
  // Due before now: candidates to flag.
  const past = await ctx.db.query("invoices").withIndex("by_org_and_due", (q) => q.eq("orgId", orgId).gt("dueAt", 0).lt("dueAt", now)).take(5000);
  for (const inv of past) {
    const open = (inv.status === "sent" || inv.status === "partially_paid") && inv.total - inv.amountPaid > 0;
    if (open) {
      overdue.push(inv);
      if (inv.overdueSince === undefined) {
        await ctx.db.patch(inv._id, { overdueSince: now });
        await ctx.db.insert("auditLog", { orgId, action: "invoice.overdue", entityType: "invoice", entityId: inv._id, changes: { dueAt: inv.dueAt, balance: inv.total - inv.amountPaid, system: "daily overdue check" }, at: now });
        await requestInvoicePdf(ctx, inv._id);
        flagged++;
      }
    } else if (inv.overdueSince !== undefined) {
      await ctx.db.patch(inv._id, { overdueSince: undefined });
      await ctx.db.insert("auditLog", { orgId, action: "invoice.overdue_cleared", entityType: "invoice", entityId: inv._id, changes: { status: inv.status, system: "daily overdue check" }, at: now });
      cleared++;
    }
  }
  // Flagged but due date now in the future (e.g. re-sent with new terms): clear.
  const future = await ctx.db.query("invoices").withIndex("by_org_and_due", (q) => q.eq("orgId", orgId).gte("dueAt", now)).take(5000);
  for (const inv of future) {
    if (inv.overdueSince === undefined) continue;
    await ctx.db.patch(inv._id, { overdueSince: undefined });
    await ctx.db.insert("auditLog", { orgId, action: "invoice.overdue_cleared", entityType: "invoice", entityId: inv._id, changes: { dueAt: inv.dueAt, system: "daily overdue check" }, at: now });
    cleared++;
  }
  return { flagged, cleared, overdue };
}

/** Largest configured day-count <= days overdue, as stage "od<k>", or null (not yet at the first stage). */
export function invoiceOverdueStage(dueAt: number, now: number, stages: number[]): string | null {
  const daysOver = Math.floor((now - dueAt) / DAY);
  const hit = [...stages].sort((a, b) => a - b).filter((d) => d <= daysOver).pop();
  return hit === undefined ? null : `od${hit}`;
}
