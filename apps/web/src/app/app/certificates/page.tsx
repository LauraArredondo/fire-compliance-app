"use client";

import { useState } from "react";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { useAssignedScope } from "@/lib/permissions";
import { CERT_STATUSES, disciplineLabel } from "@/lib/labels";
import { date } from "@/lib/format";
import { Card, FilterTabs, LinkButton, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

type S = (typeof CERT_STATUSES)[number];

export default function CertificatesPage() {
  const { orgId } = useOrg();
  const scope = useAssignedScope();
  const [status, setStatus] = useState<S | "">("");
  const { results, status: st, loadMore } = usePaginatedQuery(api.certificates.list, { orgId, status: status || "all" }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Certificates" actions={<LinkButton href="/app/certificates/new">New certificate</LinkButton>} />
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={CERT_STATUSES} />
        <Table rows={st === "LoadingFirstPage" || !scope.ready ? undefined : results.filter((r) => scope.canSeeSite(r.siteId))} href={(c) => `/app/certificates/${c._id}`} empty="No certificates with this status." columns={[
          { header: "Number", cell: (c) => c.certificateNumber },
          { header: "Site", cell: (c) => c.siteName || "—" },
          { header: "Client", cell: (c) => c.clientName || "—" },
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
