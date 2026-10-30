"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { DEFECT_STATUSES } from "@/lib/labels";
import { date } from "@/lib/format";
import { Card, FilterTabs, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

type S = (typeof DEFECT_STATUSES)[number];

export default function PortalDefects() {
  const { orgId } = useOrg();
  const [status, setStatus] = useState<S | "">("open");
  const { results, status: st, loadMore } = usePaginatedQuery(api.defects.list, { orgId, status: status || "all" }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Defects" />
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={DEFECT_STATUSES} />
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(d) => `/portal/defects/${d._id}`} empty="No defects with this status." columns={[
          { header: "Ref", cell: (d) => d.reference },
          { header: "Defect", cell: (d) => d.title },
          { header: "Site", cell: (d) => d.siteName || "—" },
          { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
          { header: "Raised", cell: (d) => date(d.raisedAt) },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
