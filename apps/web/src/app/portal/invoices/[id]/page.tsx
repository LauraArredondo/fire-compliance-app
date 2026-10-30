"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { date, money } from "@/lib/format";
import { Card, DL, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { LinesTable, Totals } from "@/components/LinesEditor";
import { PdfButton } from "@/components/PdfButton";
import { OverdueBadge } from "@/components/OverdueBadge";

export default function PortalInvoice() {
  const { id } = useParams<{ id: Id<"invoices"> }>();
  const inv = useQuery(api.invoices.get, { invoiceId: id });
  const pdf = useQuery(api.invoices.getPdf, { invoiceId: id });
  if (!inv) return <Loading />;
  return (
    <>
      <PageHeader back={{ href: "/portal/invoices", label: "Invoices" }} title={<span className="flex items-center gap-3">{inv.invoiceNumber} <StatusBadge status={inv.status} /><OverdueBadge inv={inv} /></span>} actions={<PdfButton pdf={pdf} />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2">
          <LinesTable lines={inv.lines ?? []} currency={inv.currency} />
          <Totals rows={[["Subtotal", money(inv.subtotal, inv.currency)], ["VAT", money(inv.taxTotal, inv.currency)], ["Total", money(inv.total, inv.currency), true], ["Paid", money(inv.amountPaid, inv.currency)], ["Balance due", money(inv.balance, inv.currency), true]]} />
        </Card>
        <Card title="Details"><DL items={[["Issued", date(inv.issuedAt)], ["Due", date(inv.dueAt)], ["Notes", inv.notes]]} /></Card>
      </div>
    </>
  );
}
