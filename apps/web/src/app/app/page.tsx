"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { SiteName } from "@/components/Refs";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, disciplineLabel, jobStatusLabel } from "@/lib/labels";
import { money } from "@/lib/format";
import { LinkButton, StatusBadge } from "@/components/ui";
import { Icon, type IconName } from "@/components/icons";

const page = { numItems: 100, cursor: null };

function londonHour(now = Date.now()) {
  return Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Europe/London" }).format(now));
}
function greeting(now = Date.now()) {
  const h = londonHour(now);
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
function londonDay(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "2-digit", day: "2-digit", timeZone: "Europe/London" }).format(ms);
}
function londonTime(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }).format(ms);
}
function countLabel(n: number, capped: boolean) {
  return capped ? `${n}+` : String(n);
}

export default function Dashboard() {
  const { orgId, role, me } = useOrg();
  const office = OFFICE.includes(role);
  const due = useQuery(api.serviceSchedules.dueSoon, { orgId, days: 30 });
  const horizon = useQuery(api.serviceSchedules.dueSoon, { orgId, days: 3650 });
  const mine = useQuery(api.jobs.myJobs, { orgId });
  const unscheduled = useQuery(api.jobs.list, office ? { orgId, status: "draft", paginationOpts: page } : "skip");
  const defects = useQuery(api.defects.list, { orgId, status: "open", paginationOpts: page });
  const overdue = useQuery(api.invoices.list, office ? { orgId, status: "overdue", paginationOpts: page } : "skip");
  const now = Date.now();
  const first = me.name?.split(" ")[0];
  const todayLabel = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/London" }).format(now);

  const schedules = horizon ?? [];
  const cappedSchedules = schedules.length >= 500;
  const overdueSchedules = schedules.filter((s) => s.nextDueAt < now).length;
  const inDate = schedules.length - overdueSchedules;
  const pct = schedules.length ? Math.round((inDate / schedules.length) * 100) : null;

  const todayJobs = (mine ?? []).filter((j) => j.scheduledStart && londonDay(j.scheduledStart) === londonDay(now));
  const jobRows = (todayJobs.length ? todayJobs : mine ?? []).slice(0, 6);
  const jobsTitle = todayJobs.length ? "My jobs today" : "My jobs";

  const defectCritical = defects?.page.filter((d) => d.severity === "critical").length ?? 0;
  const unassignedDrafts = unscheduled?.page.filter((j) => j.assignedEngineerIds.length === 0).length ?? 0;
  const overdueSum = overdue?.page.reduce((sum, inv) => sum + (inv.total - inv.amountPaid), 0) ?? 0;
  const currency = overdue?.page[0]?.currency ?? "GBP";

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="type-overline text-brand">{todayLabel}</div>
          <h1 className="type-h1 mt-1 text-fg">{greeting()}{first ? `, ${first}` : ""}</h1>
          <p className="mt-1 text-[15px] text-fg-2">
            {mine === undefined ? "Loading your day…" : `${todayJobs.length} job${todayJobs.length === 1 ? "" : "s"} today · ${due === undefined ? "…" : due.length} service${due?.length === 1 ? "" : "s"} due in 30 days`}
          </p>
        </div>
        {office && <div className="flex flex-wrap gap-2"><LinkButton href="/app/jobs/new">New job</LinkButton><LinkButton variant="secondary" href="/app/clients/new">New client</LinkButton></div>}
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <section className="flex flex-col gap-4 overflow-hidden rounded-xl border border-line-subtle bg-surface p-6 shadow-e1 xl:col-span-4 xl:row-span-2">
          <div className="type-overline text-fg-muted">Schedules in date</div>
          <div>
            {pct === null ? <div className="text-5xl font-semibold leading-none text-fg-muted">—</div> : <div className="text-fire text-7xl font-bold leading-none tracking-[-0.05em]">{pct}%</div>}
            <p className="mt-2 text-[15px] text-fg-2">
              {horizon === undefined ? "Loading schedules…" : schedules.length === 0 ? "No active schedules due in the next 10 years." : `${inDate} of ${schedules.length}${cappedSchedules ? "+" : ""} active schedules are not overdue`}
            </p>
          </div>
          <DueBars rows={schedules} />
        </section>

        <Stat href="/app/schedules" icon="schedules" tone="warning" label="Service due · 30d" value={due === undefined ? "—" : String(due.length)} hint={due === undefined ? "…" : `${due.filter((s) => s.nextDueAt < now).length} already overdue`} />
        <Stat href="/app/defects" icon="defects" tone="danger" label="Open defects" value={defects === undefined ? "—" : countLabel(defects.page.length, !defects.isDone)} hint={defects === undefined ? "…" : `${defectCritical} critical${defects.isDone ? "" : " in this sample"}`} />
        {office ? (
          <Stat href="/app/jobs?status=draft" icon="jobs" tone="info" label="Unscheduled jobs" value={unscheduled === undefined ? "—" : countLabel(unscheduled.page.length, !unscheduled.isDone)} hint={unscheduled === undefined ? "…" : `${unassignedDrafts} without an engineer${unscheduled.isDone ? "" : " in this sample"}`} />
        ) : (
          <Stat href="/app/jobs" icon="jobs" tone="info" label="My jobs" value={mine === undefined ? "—" : String(mine.length)} hint="Assigned in the next 30 days" />
        )}
        {office && (
          <Stat href="/app/invoices?status=overdue" icon="invoices" tone="neutral" label="Overdue invoices" value={overdue === undefined ? "—" : `${money(overdueSum, currency)}${overdue.isDone ? "" : "+"}`} hint={overdue === undefined ? "…" : `${countLabel(overdue.page.length, !overdue.isDone)} invoice${overdue.page.length === 1 ? "" : "s"}`} />
        )}

        <section className="overflow-hidden rounded-xl border border-line-subtle bg-surface shadow-e1 xl:col-span-8">
          <header className="flex items-center justify-between px-5 py-4">
            <h2 className="text-base font-semibold">{jobsTitle}</h2>
            <Link href="/app/jobs" className="text-sm font-medium text-link hover:underline">View all →</Link>
          </header>
          {mine === undefined ? <p className="px-5 pb-5 text-sm text-fg-muted">Loading…</p> : jobRows.length === 0 ? <p className="px-5 pb-5 text-sm text-fg-muted">No jobs assigned to you.</p> : (
            <ul>
              {jobRows.map((j) => (
                <li key={j._id} className="flex flex-wrap items-center gap-3 border-t border-line-subtle px-5 py-3.5">
                  <Link href={`/app/jobs/${j._id}`} className="w-36 shrink-0 font-mono text-[13px] text-link hover:underline">{j.jobNumber}</Link>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{j.title}</div>
                    <div className="truncate text-xs text-fg-muted">{j.siteName || "No site"}</div>
                  </div>
                  <span className="w-14 font-mono text-[13px] text-fg-2">{j.scheduledStart ? londonTime(j.scheduledStart) : "—"}</span>
                  <StatusBadge status={j.status} label={jobStatusLabel(j.status)} />
                </li>
              ))}
            </ul>
          )}
          {!todayJobs.length && (mine?.length ?? 0) > 0 && <p className="border-t border-line-subtle px-5 py-2 text-xs text-fg-muted">Nothing scheduled for today — showing the next assignments.</p>}
        </section>

        <section className="rounded-xl border border-line-subtle bg-surface p-5 shadow-e1 xl:col-span-12">
          <header className="mb-3.5 flex items-center justify-between">
            <h2 className="text-base font-semibold">Service schedules</h2>
            <span className="type-overline text-fg-muted">Next 30 days</span>
          </header>
          {due === undefined ? <p className="text-sm text-fg-muted">Loading…</p> : due.length === 0 ? <p className="text-sm text-fg-muted">Nothing due.</p> : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {due.slice(0, 4).map((s) => {
                const days = Math.ceil((s.nextDueAt - now) / 864e5);
                const when = new Date(s.nextDueAt);
                const day = new Intl.DateTimeFormat("en-GB", { day: "2-digit", timeZone: "Europe/London" }).format(when);
                const mon = new Intl.DateTimeFormat("en-GB", { month: "short", timeZone: "Europe/London" }).format(when);
                return (
                  <Link key={s._id} href={`/app/schedules/${s._id}`} className="flex items-center gap-3.5 rounded-lg border border-line-subtle bg-subtle p-3.5 hover:bg-hover">
                    <div className="w-12 text-center">
                      <div className="font-mono text-lg font-semibold">{day}</div>
                      <div className="type-overline text-fg-muted">{mon}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium"><SiteName id={s.siteId} link={false} /></div>
                      <div className="mb-2 truncate text-xs text-fg-muted">{disciplineLabel(s.discipline)} · {s.frequency.interval} {s.frequency.unit}{s.frequency.interval === 1 ? "" : "s"}</div>
                      {s.nextDueAt < now ? <StatusBadge status="overdue" /> : days <= 7 ? <StatusBadge status="on_hold" label={days <= 0 ? "Due today" : `Due in ${days}d`} /> : s.defaultEngineerId ? <StatusBadge status="scheduled" /> : <StatusBadge status="draft" label="Unassigned" />}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
          {(due?.length ?? 0) > 4 && <div className="mt-3 text-right"><Link href="/app/schedules" className="text-sm font-medium text-link hover:underline">All schedules →</Link></div>}
        </section>
      </div>
    </>
  );
}

function DueBars({ rows }: { rows: { nextDueAt: number }[] }) {
  const map = new Map<string, { label: string; n: number; sort: number }>();
  for (const r of rows) {
    const d = new Date(r.nextDueAt);
    const sort = d.getFullYear() * 12 + d.getMonth();
    const key = String(sort);
    const label = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "Europe/London" }).format(r.nextDueAt);
    const cur = map.get(key) ?? { label, n: 0, sort };
    cur.n += 1;
    map.set(key, cur);
  }
  const buckets = [...map.values()].sort((a, b) => a.sort - b.sort).slice(-12);
  if (!buckets.length) return <div className="flex flex-1 items-end text-sm text-fg-muted">Due dates will chart here once schedules exist.</div>;
  const max = Math.max(...buckets.map((b) => b.n));
  return (
    <div className="mt-auto">
      <div className="flex h-32 items-end gap-1.5">
        {buckets.map((b, i) => (
          <div key={b.sort} className="flex h-full flex-1 items-end" title={`${b.label}: ${b.n}`}>
            <div className={`w-full rounded-md ${i === buckets.length - 1 ? "bg-fire" : "border border-brand-border bg-brand-subtle"}`} style={{ height: `${Math.max(8, Math.round((b.n / max) * 100))}%` }} />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[11px] text-fg-muted">
        <span>{buckets[0].label}</span>
        <span>{buckets[buckets.length - 1].label}</span>
      </div>
    </div>
  );
}

function Stat({ href, icon, tone, label, value, hint }: { href: string; icon: IconName; tone: "warning" | "danger" | "info" | "neutral"; label: string; value: string; hint: string }) {
  const box = tone === "warning" ? "border-warning-line bg-warning-bg text-warning" : tone === "danger" ? "border-danger-line bg-danger-bg text-danger" : tone === "info" ? "border-info-line bg-info-bg text-info" : "border-neutral-line bg-neutral-bg text-neutral";
  return (
    <Link href={href} className="flex flex-col gap-3.5 rounded-xl border border-line-subtle bg-surface p-5 shadow-e1 hover:bg-hover xl:col-span-2">
      <span className="flex items-center gap-2.5">
        <span className={`grid h-9 w-9 place-items-center rounded-[10px] border ${box}`}><Icon name={icon} /></span>
        <span className="type-overline text-fg-muted">{label}</span>
      </span>
      <span className="text-[2.5rem] font-bold leading-none tracking-tight">{value}</span>
      <span className="text-[13px] text-fg-muted">{hint}</span>
    </Link>
  );
}
