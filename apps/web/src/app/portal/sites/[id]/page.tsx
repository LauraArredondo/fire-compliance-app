"use client";

import { useParams } from "next/navigation";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { address, date } from "@/lib/format";
import { disciplineLabel } from "@/lib/labels";
import { Card, DL, Loading, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

export default function PortalSitePage() {
  const { id } = useParams<{ id: Id<"sites"> }>();
  const { orgId } = useOrg();
  const site = useQuery(api.sites.get, { siteId: id });
  const certs = useQuery(api.certificates.listBySite, { orgId, siteId: id });
  const defects = useQuery(api.defects.openForSite, { orgId, siteId: id });
  const schedules = useQuery(api.serviceSchedules.list, { orgId, siteId: id, status: "active", paginationOpts: { numItems: 50, cursor: null } });
  const assets = usePaginatedQuery(api.assets.list, { siteId: id }, { initialNumItems: 25 });
  if (!site) return <Loading />;
  return (
    <>
      <PageHeader back={{ href: "/portal", label: "Overview" }} title={site.name} subtitle={address(site.address)} />
      <Card title="Site">
        <DL items={[["Reference", site.reference], ["Site contact", site.siteContact?.name], ["Responsible person", site.responsiblePerson?.name]]} />
      </Card>
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Certificates">
          <Table rows={certs} href={(c) => `/portal/certificates/${c._id}`} empty="No certificates yet." columns={[
            { header: "Number", cell: (c) => c.certificateNumber },
            { header: "Type", cell: (c) => disciplineLabel(c.discipline) },
            { header: "Inspected", cell: (c) => date(c.inspectionDate) },
            { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
          ]} />
        </Card>
        <Card title="Open defects">
          <Table rows={defects} href={(d) => `/portal/defects/${d._id}`} empty="No open defects." columns={[
            { header: "Defect", cell: (d) => d.title },
            { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
            { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
          ]} />
        </Card>
        <Card title="Upcoming services">
          <Table rows={schedules?.page} empty="No scheduled services." columns={[
            { header: "Service", cell: (s) => s.name },
            { header: "Discipline", cell: (s) => disciplineLabel(s.discipline) },
            { header: "Next due", cell: (s) => date(s.nextDueAt) },
          ]} />
        </Card>
        <Card title="Asset register">
          <Table rows={assets.status === "LoadingFirstPage" ? undefined : assets.results} empty="No assets recorded." columns={[
            { header: "Ref", cell: (a) => a.reference },
            { header: "Type", cell: (a) => disciplineLabel(a.discipline) },
            { header: "Description", cell: (a) => a.description ?? "—" },
            { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
          ]} />
          <LoadMore status={assets.status} loadMore={assets.loadMore} />
        </Card>
      </div>
    </>
  );
}
