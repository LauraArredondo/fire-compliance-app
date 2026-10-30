"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { date } from "@/lib/format";
import { disciplineLabel } from "@/lib/labels";
import { Card, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

export default function PortalCertificates() {
  const { orgId } = useOrg();
  const { results, status, loadMore } = usePaginatedQuery(api.certificates.list, { orgId }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Certificates" />
      <Card>
        <Table rows={status === "LoadingFirstPage" ? undefined : results} href={(c) => `/portal/certificates/${c._id}`} empty="No certificates yet." columns={[
          { header: "Number", cell: (c) => c.certificateNumber },
          { header: "Site", cell: (c) => c.siteName || "—" },
          { header: "Type", cell: (c) => disciplineLabel(c.discipline) },
          { header: "Inspected", cell: (c) => date(c.inspectionDate) },
          { header: "Result", cell: (c) => <StatusBadge status={c.overallResult} /> },
          { header: "Next due", cell: (c) => date(c.nextInspectionDueAt) },
          { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
        ]} />
        <LoadMore status={status} loadMore={loadMore} />
      </Card>
    </>
  );
}
