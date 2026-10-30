"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { date, money } from "@/lib/format";
import { Card, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";
import { OverdueBadge } from "@/components/OverdueBadge";

export default function PortalInvoices() {
  const { orgId } = useOrg();
  const { results, status, loadMore } = usePaginatedQuery(api.invoices.list, { orgId }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Invoices" />
      <Card>
        <Table rows={status === "LoadingFirstPage" ? undefined : results} href={(i) => `/portal/invoices/${i._id}`} empty="No invoices." columns={[
          { header: "Invoice", cell: (i) => i.invoiceNumber },
          { header: "Issued", cell: (i) => date(i.issuedAt) },
          { header: "Due", cell: (i) => date(i.dueAt) },
          { header: "Total", cell: (i) => money(i.total, i.currency) },
          { header: "Balance", cell: (i) => money(i.total - i.amountPaid, i.currency) },
          { header: "Status", cell: (i) => (i.status === "overdue" ? <OverdueBadge inv={i} /> : <StatusBadge status={i.status} />) },
        ]} />
        <LoadMore status={status} loadMore={loadMore} />
      </Card>
    </>
  );
}
