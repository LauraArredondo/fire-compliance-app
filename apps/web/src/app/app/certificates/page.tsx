"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { CERT_STATUSES, disciplineLabel } from "@/lib/labels";
import { date } from "@/lib/format";
import { Card, FilterTabs, LinkButton, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";
import { SiteName } from "@/components/Refs";

type S = (typeof CERT_STATUSES)[number];

export default function CertificatesPage() {
  const { orgId } = useOrg();
  const [status, setStatus] = useState<S | "">("issued");
  const { results, status: st, loadMore } = usePaginatedQuery(api.certificates.list, { orgId, status: status || undefined }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Certificates" actions={<LinkButton href="/app/certificates/new">New certificate</LinkButton>} />
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={CERT_STATUSES} allowAll={false} />
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(c) => `/app/certificates/${c._id}`} empty="No certificates with this status." columns={[
          { header: "Number", cell: (c) => c.certificateNumber },
          { header: "Site", cell: (c) => <SiteName id={c.siteId} link={false} /> },
          { header: "Discipline", cell: (c) => disciplineLabel(c.discipline) },
          { header: "Inspected", cell: (c) => date(c.inspectionDate) },
          { header: "Result", cell: (c) => <StatusBadge status={c.overallResult} /> },
          { header: "Next due", cell: (c) => date(c.nextInspectionDueAt) },
          { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
