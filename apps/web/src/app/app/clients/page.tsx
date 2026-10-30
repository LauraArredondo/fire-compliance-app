"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, humanize } from "@/lib/labels";
import { address } from "@/lib/format";
import { Card, FilterTabs, Input, LinkButton, LoadMore, PageHeader, Table } from "@/components/ui";

export default function ClientsPage() {
  const { orgId, role } = useOrg();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"active" | "archived" | "">("active");
  const { results, status: st, loadMore } = usePaginatedQuery(api.clients.list, { orgId, search: search.trim() || undefined, status: status || undefined }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Clients" actions={OFFICE.includes(role) && <LinkButton href="/app/clients/new">New client</LinkButton>} />
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <FilterTabs value={status} onChange={setStatus} options={["active", "archived"] as const} allowAll={false} />
          <Input className="max-w-xs" placeholder="Search by name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(c) => `/app/clients/${c._id}`} empty="No clients yet." columns={[
          { header: "Name", cell: (c) => c.name },
          { header: "Type", cell: (c) => humanize(c.type) },
          { header: "Contact", cell: (c) => c.primaryContact ? `${c.primaryContact.name}${c.primaryContact.email ? ` · ${c.primaryContact.email}` : ""}` : "—" },
          { header: "Address", cell: (c) => address(c.billingAddress) || "—" },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
