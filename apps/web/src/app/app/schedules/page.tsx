"use client";

import { useState } from "react";
import { useMutation, usePaginatedQuery } from "convex/react";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, disciplineLabel } from "@/lib/labels";
import { date } from "@/lib/format";
import { ActionButton, Badge, Card, ErrorBox, FilterTabs, LinkButton, LoadMore, Notice, PageHeader, StatusBadge, Table } from "@/components/ui";

const STATUSES = ["active", "paused", "ended"] as const;
const count = (x: unknown) => (Array.isArray(x) ? x.length : typeof x === "number" ? x : 0);

export default function SchedulesPage() {
  const { orgId, role } = useOrg();
  const office = OFFICE.includes(role);
  const [status, setStatus] = useState<(typeof STATUSES)[number] | "">("active");
  const { results, status: st, loadMore } = usePaginatedQuery(api.serviceSchedules.list, { orgId, status: status || undefined }, { initialNumItems: 25 });
  const run = useMutation(api.serviceSchedules.runAutoJobsNow);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Service schedules" subtitle="Recurring maintenance with reminders and automatic job creation."
        actions={office && (
          <>
            <ActionButton onError={setError} action={async () => { const r = await run({ orgId }); setMsg(r.disabled ? "Job automation is turned off in Settings." : `Created ${r.created.length} job(s); ${count(r.skipped)} skipped.`); }}>Run auto-jobs now</ActionButton>
            <LinkButton href="/app/schedules/new">New schedule</LinkButton>
          </>
        )} />
      <ErrorBox message={error} />
      {msg && <div className="mb-4"><Notice tone="blue">{msg} <a className="underline" href="/app/jobs?status=draft">View unscheduled jobs</a></Notice></div>}
      <Card>
        <FilterTabs value={status} onChange={setStatus} options={STATUSES} />
        <Table rows={st === "LoadingFirstPage" ? undefined : results} href={(s) => `/app/schedules/${s._id}`} empty="No schedules." columns={[
          { header: "Schedule", cell: (s) => s.name },
          { header: "Site", cell: (s) => s.siteName || "—" },
          { header: "Client", cell: (s) => s.clientName || "—" },
          { header: "Discipline", cell: (s) => disciplineLabel(s.discipline) },
          { header: "Every", cell: (s) => `${s.frequency.interval} ${s.frequency.unit}${s.frequency.interval === 1 ? "" : "s"}` },
          { header: "Next due", cell: (s) => <span className="flex items-center gap-2">{date(s.nextDueAt)}{s.status === "active" && s.nextDueAt < Date.now() && <Badge tone="red">Overdue</Badge>}</span> },
          { header: "Auto job", cell: (s) => (s.autoCreateJob ? "Yes" : "No") },
          { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
        ]} />
        <LoadMore status={st} loadMore={loadMore} />
      </Card>
    </>
  );
}
