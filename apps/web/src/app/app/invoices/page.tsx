"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { INVOICE_STATUSES } from "@/lib/labels";
import { date, money } from "@/lib/format";
import { Card, FilterTabs, LinkButton, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";
import { OverdueBadge } from "@/components/OverdueBadge";

type S = (typeof INVOICE_STATUSES)[number];

export default function InvoicesPage() {
  const { orgId } = useOrg();
  const [status, setStatus] = useState<S | "">("");
  const { results, status: st, loadMore } = usePaginatedQuery(api.invoices.list, { orgId, status: status || "all" }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Invoices" actions={<LinkButton href="/app/invoices/new">New invoice</LinkButton>} />
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={INVOICE_STATUSES} />
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(i) => `/app/invoices/${i._id}`} empty="No invoices with this status." columns={[
          { header: "Invoice", cell: (i) => i.invoiceNumber },
          { header: "Client", cell: (i) => i.clientName || "—" },
          { header: "Site", cell: (i) => i.siteName || "—" },
          { header: "Total", cell: (i) => money(i.total, i.currency) },
          { header: "Balance", cell: (i) => money(i.total - i.amountPaid, i.currency) },
          { header: "Due", cell: (i) => date(i.dueAt) },
          { header: "Status", cell: (i) => <span className="flex flex-wrap gap-1">{i.status === "overdue" ? <OverdueBadge inv={i} /> : <StatusBadge status={i.status} />}</span> },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
