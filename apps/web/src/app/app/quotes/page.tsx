"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { QUOTE_STATUSES } from "@/lib/labels";
import { date, money } from "@/lib/format";
import { Card, FilterTabs, LinkButton, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";
import { ClientName } from "@/components/Refs";

type S = (typeof QUOTE_STATUSES)[number];

export default function QuotesPage() {
  const { orgId } = useOrg();
  const [status, setStatus] = useState<S | "">("draft");
  const { results, status: st, loadMore } = usePaginatedQuery(api.quotes.list, { orgId, status: status || undefined }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Quotes" actions={<LinkButton href="/app/quotes/new">New quote</LinkButton>} />
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={QUOTE_STATUSES} allowAll={false} />
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(q) => `/app/quotes/${q._id}`} empty="No quotes with this status." columns={[
          { header: "Quote", cell: (q) => `${q.quoteNumber}${q.revision > 1 ? ` rev ${q.revision}` : ""}` },
          { header: "Title", cell: (q) => q.title },
          { header: "Client", cell: (q) => <ClientName id={q.clientId} link={false} /> },
          { header: "Total", cell: (q) => money(q.total, q.currency) },
          { header: "Valid until", cell: (q) => date(q.validUntil) },
          { header: "Status", cell: (q) => <StatusBadge status={q.status} /> },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
