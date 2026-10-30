"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { address, date } from "@/lib/format";
import { disciplineLabel } from "@/lib/labels";
import { Card, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";
import { SiteName } from "@/components/Refs";

export default function PortalHome() {
  const { orgId, membership } = useOrg();
  const org = useQuery(api.organizations.get, { orgId });
  const sites = usePaginatedQuery(api.sites.list, { orgId }, { initialNumItems: 25 });
  const certs = useQuery(api.certificates.list, { orgId, paginationOpts: { numItems: 10, cursor: null } });
  const defects = useQuery(api.defects.list, { orgId, status: "open", paginationOpts: { numItems: 10, cursor: null } });
  return (
    <>
      <PageHeader title="Your compliance portal" subtitle={org ? `Provided by ${org.name}${org.phone ? ` · ${org.phone}` : ""}${org.email ? ` · ${org.email}` : ""}` : membership.orgName ?? ""} />
      <Card title="Your sites">
        <Table rows={sites.status === "LoadingFirstPage" ? undefined : sites.results} href={(s) => `/portal/sites/${s._id}`} empty="No sites shared with you yet." columns={[
          { header: "Site", cell: (s) => s.name },
          { header: "Address", cell: (s) => address(s.address) },
        ]} />
        <LoadMore status={sites.status} loadMore={sites.loadMore} />
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Latest certificates">
          <Table rows={certs?.page} href={(c) => `/portal/certificates/${c._id}`} empty="No certificates yet." columns={[
            { header: "Number", cell: (c) => c.certificateNumber },
            { header: "Site", cell: (c) => <SiteName id={c.siteId} link={false} /> },
            { header: "Type", cell: (c) => disciplineLabel(c.discipline) },
            { header: "Next due", cell: (c) => date(c.nextInspectionDueAt) },
            { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
          ]} />
        </Card>
        <Card title="Open defects">
          <Table rows={defects?.page} href={(d) => `/portal/defects/${d._id}`} empty="No open defects." columns={[
            { header: "Defect", cell: (d) => d.title },
            { header: "Site", cell: (d) => <SiteName id={d.siteId} link={false} /> },
            { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
          ]} />
        </Card>
      </div>
    </>
  );
}
