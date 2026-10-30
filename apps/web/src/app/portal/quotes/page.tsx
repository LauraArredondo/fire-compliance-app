"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { date, money } from "@/lib/format";
import { Card, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

export default function PortalQuotes() {
  const { orgId } = useOrg();
  const { results, status, loadMore } = usePaginatedQuery(api.quotes.list, { orgId }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Quotes" />
      <Card>
        <Table rows={status === "LoadingFirstPage" ? undefined : results} href={(q) => `/portal/quotes/${q._id}`} empty="No quotes." columns={[
          { header: "Quote", cell: (q) => q.quoteNumber },
          { header: "Title", cell: (q) => q.title },
          { header: "Total", cell: (q) => money(q.total, q.currency) },
          { header: "Valid until", cell: (q) => date(q.validUntil) },
          { header: "Status", cell: (q) => <StatusBadge status={q.status} /> },
        ]} />
        <LoadMore status={status} loadMore={loadMore} />
      </Card>
    </>
  );
}
