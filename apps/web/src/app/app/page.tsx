"use client";

import Link from "next/link";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "convex/react";
import { SiteName } from "@/components/Refs";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { DENIED_PARAM, useAssignedScope, usePermissions } from "@/lib/permissions";
import { date, dateTime, money } from "@/lib/format";
import { disciplineLabel, jobStatusLabel } from "@/lib/labels";
import { Card, LinkButton, Notice, PageHeader, StatusBadge, Table, Badge } from "@/components/ui";

const page = { numItems: 10, cursor: null };

function DeniedNotice() {
  const sp = useSearchParams();
  if (!sp.get(DENIED_PARAM)) return null;
  return <div className="mb-4"><Notice>That page isn&apos;t available for your role, so you&apos;ve been brought back to your dashboard.</Notice></div>;
}

export default function DashboardPage() {
  const perms = usePermissions();
  return (
    <>
      <Suspense fallback={null}><DeniedNotice /></Suspense>
      {perms.assignedOnly ? <EngineerDashboard /> : <Dashboard />}
    </>
  );
}

const startOfDay = (ms: number) => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };

/** Engineers: today's and upcoming jobs assigned to them, and open defects at those sites. */
function EngineerDashboard() {
  const { orgId, me, membership } = useOrg();
  const scope = useAssignedScope();
  const defects = useQuery(api.defects.list, { orgId, status: "open", paginationOpts: { numItems: 100, cursor: null } });
  const today0 = startOfDay(Date.now()), tomorrow0 = today0 + 864e5;
  const open = (scope.jobs ?? []).filter((j) => !["completed", "invoiced", "cancelled"].includes(j.status));
  const today = scope.jobs && open.filter((j) => j.status === "in_progress" || j.status === "on_hold" || ((j.scheduledStart ?? 0) >= today0 && (j.scheduledStart ?? 0) < tomorrow0) || (j.scheduledStart ?? 0) < today0);
  const upcoming = scope.jobs && open.filter((j) => !today!.includes(j));
  const myDefects = defects && scope.ready ? defects.page.filter((d) => scope.canSeeSite(d.siteId)) : undefined;
  const cols = [
    { header: "Job", cell: (j: NonNullable<typeof today>[number]) => `${j.jobNumber} · ${j.title}` },
    { header: "Site", cell: (j: NonNullable<typeof today>[number]) => j.siteName },
    { header: "When", cell: (j: NonNullable<typeof today>[number]) => dateTime(j.scheduledStart) },
    { header: "Status", cell: (j: NonNullable<typeof today>[number]) => <StatusBadge status={j.status} label={jobStatusLabel(j.status)} /> },
  ];
  return (
    <>
      <PageHeader title={`Welcome${me.name ? `, ${me.name.split(" ")[0]}` : ""}`} subtitle={membership.orgName ?? undefined} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Today" className="lg:col-span-2">
          <Table rows={today} href={(j) => `/app/jobs/${j._id}`} empty="Nothing for you today." columns={cols} />
        </Card>
        <Card title="Upcoming" actions={<Link className="text-sm text-red-700 hover:underline" href="/app/jobs">All my jobs</Link>}>
          <Table rows={upcoming} href={(j) => `/app/jobs/${j._id}`} empty="No upcoming jobs assigned to you." columns={cols} />
        </Card>
        <Card title="Open defects at my sites" actions={<Link className="text-sm text-red-700 hover:underline" href="/app/defects">View all</Link>}>
          <Table rows={myDefects} href={(d) => `/app/defects/${d._id}`} empty="No open defects at your sites." columns={[
            { header: "Defect", cell: (d) => `${d.reference} · ${d.title}` },
            { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
            { header: "Site", cell: (d) => d.siteName || "—" },
          ]} />
        </Card>
      </div>
    </>
  );
}

function Dashboard() {
  const { orgId, me, membership } = useOrg();
  const perms = usePermissions();
  const office = perms.can("jobs.manage");
  const due = useQuery(api.serviceSchedules.dueSoon, { orgId, days: 30 });
  const mine = useQuery(api.jobs.myJobs, { orgId });
  const unscheduled = useQuery(api.jobs.list, office ? { orgId, status: "draft", paginationOpts: page } : "skip");
  const defects = useQuery(api.defects.list, { orgId, status: "open", paginationOpts: page });
  const overdue = useQuery(api.invoices.list, perms.can("invoices.view") ? { orgId, status: "overdue", paginationOpts: page } : "skip");
  const now = Date.now();

  return (
    <>
      <PageHeader
        title={`Welcome${me.name ? `, ${me.name.split(" ")[0]}` : ""}`}
        subtitle={membership.orgName ?? undefined}
        actions={office ? <><LinkButton href="/app/jobs/new">New job</LinkButton><LinkButton variant="secondary" href="/app/clients/new">New client</LinkButton></> : null}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="My jobs (next 30 days)">
          <Table rows={mine} href={(j) => `/app/jobs/${j._id}`} empty="No jobs assigned to you." columns={[
            { header: "Job", cell: (j) => `${j.jobNumber} · ${j.title}` },
            { header: "Site", cell: (j) => j.siteName },
            { header: "When", cell: (j) => dateTime(j.scheduledStart) },
            { header: "Status", cell: (j) => <StatusBadge status={j.status} label={jobStatusLabel(j.status)} /> },
          ]} />
        </Card>
        <Card title="Service due in the next 30 days" actions={<Link className="text-sm text-red-700 hover:underline" href="/app/schedules">All schedules</Link>}>
          <Table rows={due} href={(s) => `/app/schedules/${s._id}`} empty="Nothing due. 🎉" columns={[
            { header: "Schedule", cell: (s) => s.name },
            { header: "Site", cell: (s) => <SiteName id={s.siteId} /> },
            { header: "Discipline", cell: (s) => disciplineLabel(s.discipline) },
            { header: "Due", cell: (s) => <span className={s.nextDueAt < now ? "font-medium text-red-700" : ""}>{date(s.nextDueAt)}{s.nextDueAt < now && " (overdue)"}</span> },
          ]} />
        </Card>
        {office && (
          <Card title="Unscheduled jobs" actions={<Link className="text-sm text-red-700 hover:underline" href="/app/jobs?status=draft">View all</Link>}>
            <Table rows={unscheduled?.page} href={(j) => `/app/jobs/${j._id}`} empty="No unscheduled jobs." columns={[
              { header: "Job", cell: (j) => `${j.jobNumber} · ${j.title}` },
              { header: "Site", cell: (j) => j.siteName || "—" },
              { header: "", cell: (j) => j.autoCreated ? <Badge tone="blue">Auto · due {date(j.scheduleDueAt)}</Badge> : null },
            ]} />
          </Card>
        )}
        <Card title="Open defects" actions={<Link className="text-sm text-red-700 hover:underline" href="/app/defects">View all</Link>}>
          <Table rows={defects?.page} href={(d) => `/app/defects/${d._id}`} empty="No open defects." columns={[
            { header: "Defect", cell: (d) => `${d.reference} · ${d.title}` },
            { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
            { header: "Site", cell: (d) => d.siteName || "—" },
          ]} />
        </Card>
        {perms.can("invoices.view") && (
          <Card title="Overdue invoices" actions={<Link className="text-sm text-red-700 hover:underline" href="/app/invoices?status=overdue">View all</Link>}>
            <Table rows={overdue?.page} href={(i) => `/app/invoices/${i._id}`} empty="No overdue invoices." columns={[
              { header: "Invoice", cell: (i) => i.invoiceNumber },
              { header: "Due", cell: (i) => date(i.dueAt) },
              { header: "Balance", cell: (i) => money(i.total - i.amountPaid, i.currency) },
            ]} />
          </Card>
        )}
      </div>
    </>
  );
}
