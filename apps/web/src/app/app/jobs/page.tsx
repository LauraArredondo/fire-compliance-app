"use client";

import { Suspense, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { JOB_STATUSES, humanize, jobStatusLabel } from "@/lib/labels";
import { useAssignedScope, usePermissions } from "@/lib/permissions";
import { dateTime } from "@/lib/format";
import { Badge, Card, FilterTabs, LinkButton, Loading, LoadMore, PageHeader, StatusBadge, Table } from "@/components/ui";

type S = (typeof JOB_STATUSES)[number];

/** Engineers: only the jobs assigned to them (recent and upcoming). */
function MyJobs() {
  const scope = useAssignedScope();
  const [status, setStatus] = useState<S | "">("");
  const rows = scope.jobs?.filter((j) => !status || j.status === status);
  return (
    <>
      <PageHeader title="My jobs" subtitle="Jobs assigned to you." />
      <Card>
        <div className="mb-3">
          <FilterTabs value={status} onChange={setStatus} options={["scheduled", "in_progress", "on_hold", "completed"] as S[]} labels={jobStatusLabel} />
        </div>
        <Table rows={rows} href={(j) => `/app/jobs/${j._id}`} empty="No jobs assigned to you." columns={[
          { header: "Job", cell: (j) => `${j.jobNumber} · ${j.title}` },
          { header: "Site", cell: (j) => j.siteName || "—" },
          { header: "Type", cell: (j) => humanize(j.type) },
          { header: "Scheduled", cell: (j) => j.scheduledStart ? dateTime(j.scheduledStart) : "—" },
          { header: "Priority", cell: (j) => j.priority === "normal" ? "Normal" : <StatusBadge status={j.priority} /> },
          { header: "Status", cell: (j) => <StatusBadge status={j.status} label={jobStatusLabel(j.status)} /> },
        ]} />
      </Card>
    </>
  );
}

function Inner() {
  const { orgId } = useOrg();
  const perms = usePermissions();
  const sp = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const raw = sp.get("status");
  const status = (JOB_STATUSES as readonly string[]).includes(raw ?? "") ? (raw as S) : "";
  const { results, status: st, loadMore } = usePaginatedQuery(api.jobs.list, { orgId, status: status || undefined }, { initialNumItems: 25 });
  return (
    <>
      <PageHeader title="Jobs" actions={perms.can("jobs.manage") && <LinkButton href="/app/jobs/new">New job</LinkButton>} />
      <Card>
        <div className="mb-3">
          <FilterTabs value={status} onChange={(v) => router.replace(v ? `${path}?status=${v}` : path)} options={JOB_STATUSES} labels={jobStatusLabel} />
        </div>
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(j) => `/app/jobs/${j._id}`} empty="No jobs." columns={[
          { header: "Job", cell: (j) => <span>{j.jobNumber} · {j.title} {j.autoCreated && <Badge tone="purple">Auto</Badge>}</span> },
          { header: "Site", cell: (j) => j.siteName || "—" },
          { header: "Client", cell: (j) => j.clientName || "—" },
          { header: "Type", cell: (j) => humanize(j.type) },
          { header: "Scheduled", cell: (j) => j.scheduledStart ? dateTime(j.scheduledStart) : "—" },
          { header: "Priority", cell: (j) => j.priority === "normal" ? "Normal" : <StatusBadge status={j.priority} /> },
          { header: "Status", cell: (j) => <StatusBadge status={j.status} label={jobStatusLabel(j.status)} /> },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
export default function JobsPage() {
  const perms = usePermissions();
  return perms.assignedOnly ? <MyJobs /> : <Suspense fallback={<Loading />}><Inner /></Suspense>;
}
