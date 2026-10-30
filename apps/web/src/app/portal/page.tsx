"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { address, date } from "@/lib/format";
import { disciplineLabel } from "@/lib/labels";
import { Card, LoadMore, StatusBadge, Table } from "@/components/ui";

export default function PortalHome() {
  const { orgId, membership, me } = useOrg();
  const org = useQuery(api.organizations.get, { orgId });
  const sites = usePaginatedQuery(api.sites.list, { orgId }, { initialNumItems: 25 });
  const certs = useQuery(api.certificates.list, { orgId, paginationOpts: { numItems: 10, cursor: null } });
  const defects = useQuery(api.defects.list, { orgId, status: "open", paginationOpts: { numItems: 10, cursor: null } });
  const first = me.name?.split(" ")[0];
  const siteCount = sites.status === "LoadingFirstPage" ? null : sites.results.length;
  const siteCapped = sites.status === "CanLoadMore" || sites.status === "LoadingMore";
  return (
    <>
      <div className="mb-6">
        <div className="type-overline text-brand">Compliance portal</div>
        <h1 className="type-h1 mt-1 text-fg">{first ? `Hello, ${first}` : "Your compliance portal"}</h1>
        <p className="mt-1 text-[15px] text-fg-2">
          {org ? `Provided by ${org.name}${org.phone ? ` · ${org.phone}` : ""}${org.email ? ` · ${org.email}` : ""}` : membership.orgName ?? ""}
        </p>
      </div>
      <div className="mb-6 grid grid-cols-1 gap-5 sm:grid-cols-3">
        <Stat label="Sites" value={siteCount === null ? "—" : `${siteCount}${siteCapped ? "+" : ""}`} hint="Shared with your account" />
        <Stat label="Recent certificates" value={certs === undefined ? "—" : `${certs.page.length}${certs.isDone ? "" : "+"}`} hint="Latest issued to you" />
        <Stat label="Open defects" value={defects === undefined ? "—" : `${defects.page.length}${defects.isDone ? "" : "+"}`} hint="Still outstanding" />
      </div>
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
            { header: "Site", cell: (c) => c.siteName || "—" },
            { header: "Type", cell: (c) => disciplineLabel(c.discipline) },
            { header: "Next due", cell: (c) => date(c.nextInspectionDueAt) },
            { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
          ]} />
        </Card>
        <Card title="Open defects">
          <Table rows={defects?.page} href={(d) => `/portal/defects/${d._id}`} empty="No open defects." columns={[
            { header: "Defect", cell: (d) => d.title },
            { header: "Site", cell: (d) => d.siteName || "—" },
            { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
          ]} />
        </Card>
      </div>
    </>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-xl border border-line-subtle bg-surface p-5 shadow-e1">
      <div className="type-overline text-fg-muted">{label}</div>
      <div className="mt-2 text-4xl font-bold tracking-tight">{value}</div>
      <div className="mt-1 text-[13px] text-fg-muted">{hint}</div>
    </div>
  );
}
