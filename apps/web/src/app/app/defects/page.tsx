"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { DEFECT_STATUSES, disciplineLabel } from "@/lib/labels";
import { date } from "@/lib/format";
import { Card, FilterTabs, LinkButton, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";
import { SiteName } from "@/components/Refs";

type S = (typeof DEFECT_STATUSES)[number];

export default function DefectsPage() {
  const { orgId } = useOrg();
  const [status, setStatus] = useState<S | "">("open");
  const { results, status: st, loadMore } = usePaginatedQuery(api.defects.list, { orgId, status: status || undefined }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Defects" actions={<LinkButton href="/app/defects/new">Raise defect</LinkButton>} />
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={DEFECT_STATUSES} allowAll={false} />
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(d) => `/app/defects/${d._id}`} empty="No defects with this status." columns={[
          { header: "Ref", cell: (d) => d.reference },
          { header: "Defect", cell: (d) => d.title },
          { header: "Site", cell: (d) => <SiteName id={d.siteId} link={false} /> },
          { header: "Discipline", cell: (d) => disciplineLabel(d.discipline) },
          { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
          { header: "Raised", cell: (d) => date(d.raisedAt) },
          { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
