"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { date, money } from "@/lib/format";
import { Card, DL, Loading, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { LinesTable, Totals } from "@/components/LinesEditor";
import { PdfButton } from "@/components/PdfButton";

export default function PortalQuote() {
  const { id } = useParams<{ id: Id<"quotes"> }>();
  const q = useQuery(api.quotes.get, { quoteId: id });
  const pdf = useQuery(api.quotes.getPdf, { quoteId: id });
  if (!q) return <Loading />;
  const open = q.status === "sent" || q.status === "viewed";
  return (
    <>
      <PageHeader back={{ href: "/portal/quotes", label: "Quotes" }} title={<span className="flex items-center gap-3">{q.quoteNumber} · {q.title} <StatusBadge status={q.status} /></span>} actions={<PdfButton pdf={pdf} />} />
      {open && <div className="mb-4"><Notice tone="blue">To accept or decline, use the link in the quote email we sent you.</Notice></div>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2">
          <LinesTable lines={q.lines} currency={q.currency} />
          <Totals rows={[["Subtotal", money(q.subtotal, q.currency)], ["VAT", money(q.taxTotal, q.currency)], ["Total", money(q.total, q.currency), true]]} />
        </Card>
        <Card title="Details"><DL items={[["Valid until", date(q.validUntil)], ["Introduction", q.introduction], ["Terms", q.terms]]} /></Card>
      </div>
    </>
  );
}
