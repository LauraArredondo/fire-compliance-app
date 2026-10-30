"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { SiteName } from "@/components/Refs";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE } from "@/lib/labels";
import { date, dateTime, money } from "@/lib/format";
import { disciplineLabel, jobStatusLabel } from "@/lib/labels";
import { Card, LinkButton, PageHeader, StatusBadge, Table, Badge } from "@/components/ui";

const page = { numItems: 10, cursor: null };

export default function Dashboard() {
  const { orgId, role, me, membership } = useOrg();
  const office = OFFICE.includes(role);
  const due = useQuery(api.serviceSchedules.dueSoon, { orgId, days: 30 });
  const mine = useQuery(api.jobs.myJobs, { orgId });
  const unscheduled = useQuery(api.jobs.list, office ? { orgId, status: "draft", paginationOpts: page } : "skip");
  const defects = useQuery(api.defects.list, { orgId, status: "open", paginationOpts: page });
  const overdue = useQuery(api.invoices.list, office ? { orgId, status: "overdue", paginationOpts: page } : "skip");
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
        {office && (
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
