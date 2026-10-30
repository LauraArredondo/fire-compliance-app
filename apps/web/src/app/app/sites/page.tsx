"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE } from "@/lib/labels";
import { address } from "@/lib/format";
import { Card, Input, LinkButton, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

export default function SitesPage() {
  const { orgId, role } = useOrg();
  const [search, setSearch] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(api.sites.list, { orgId, search: search.trim() || undefined }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Sites" actions={OFFICE.includes(role) && <LinkButton href="/app/sites/new">New site</LinkButton>} />
      <Card>
        <div className="mb-3 flex justify-end"><Input className="max-w-xs" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        <Table rows={status === "LoadingFirstPage" ? undefined : results} href={(s) => `/app/sites/${s._id}`} empty="No sites yet." columns={[
          { header: "Site", cell: (s) => s.name },
          { header: "Client", cell: (s) => s.clientName || "—" },
          { header: "Address", cell: (s) => address(s.address) },
          { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
        ]} />
        <LoadMore status={status} loadMore={loadMore} />
      </Card>
    </>
  );
}
