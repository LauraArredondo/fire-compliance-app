"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, disciplineLabel, humanize, jobStatusLabel } from "@/lib/labels";
import { date, dateTime } from "@/lib/format";
import { ActionButton, Badge, Button, Card, DL, ErrorBox, LinkButton, Loading, Notice, PageHeader, StatusBadge, Table, Textarea } from "@/components/ui";
import { EngineerChecklist } from "@/components/Pickers";
import { QualificationWarnings, type AssignmentWarning } from "@/components/Warnings";

const TRANSITIONS: Record<string, string[]> = {
  draft: ["scheduled", "in_progress", "cancelled"],
  scheduled: ["draft", "in_progress", "on_hold", "completed", "cancelled"],
  in_progress: ["on_hold", "completed", "cancelled"],
  on_hold: ["scheduled", "in_progress", "cancelled"],
  completed: ["in_progress"],
  cancelled: ["draft"],
  invoiced: [],
};
const VERB: Record<string, string> = { draft: "Unschedule", scheduled: "Mark scheduled", in_progress: "Start", on_hold: "Put on hold", completed: "Complete", cancelled: "Cancel job" };

export default function JobDetailPage() {
  const { id } = useParams<{ id: Id<"jobs"> }>();
  const { role, me } = useOrg();
  const office = OFFICE.includes(role);
  const job = useQuery(api.jobs.get, { jobId: id });
  const setStatus = useMutation(api.jobs.setStatus);
  const assign = useMutation(api.jobs.assignEngineers);
  const startVisit = useMutation(api.visits.start);
  const finishVisit = useMutation(api.visits.finish);
  const createInvoice = useMutation(api.invoices.createFromJob);
  const [assigning, setAssigning] = useState(false);
  const [engineers, setEngineers] = useState<Id<"users">[]>([]);
  const [assignWarnings, setAssignWarnings] = useState<AssignmentWarning[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visitNotes, setVisitNotes] = useState("");

  if (!job) return <Loading />;
  const locked = ["completed", "invoiced", "cancelled"].includes(job.status);
  const openVisit = job.visits.find((v) => v.status === "on_site" || v.status === "travelling" || v.status === "planned");
  const assigned = me && job.assignedEngineerIds.includes(me._id);
  const allowed = (TRANSITIONS[job.status] ?? []).filter((s) => office || (assigned && ["in_progress", "on_hold", "completed"].includes(s)));

  async function change(status: string) {
    let reason: string | undefined;
    if (status === "cancelled" || status === "on_hold") { reason = window.prompt(status === "cancelled" ? "Reason for cancelling?" : "Reason for hold? (optional)") ?? undefined; if (status === "cancelled" && !reason) return; }
    await setStatus({ jobId: id, status: status as never, reason: reason || undefined });
  }

  return (
    <>
      <PageHeader
        back={{ href: "/app/jobs", label: "Jobs" }}
        title={<span className="flex flex-wrap items-center gap-3">{job.jobNumber} · {job.title} <StatusBadge status={job.status} label={jobStatusLabel(job.status)} />{job.autoCreated && <Badge tone="purple">Auto-created</Badge>}</span>}
        subtitle={<><a className="hover:underline" href={`/app/sites/${job.siteId}`}>{job.siteName}</a> · <a className="hover:underline" href={`/app/clients/${job.clientId}`}>{job.clientName}</a></>}
        actions={
          <>
            {allowed.map((s) => (
              <ActionButton key={s} variant={s === "cancelled" ? "danger" : s === "completed" || s === "in_progress" ? "primary" : "secondary"} confirm={s === "completed" ? "Mark this job complete? A linked service schedule will roll forward." : undefined} action={() => change(s)} onError={setError}>
                {VERB[s] ?? humanize(s)}
              </ActionButton>
            ))}
            {office && !locked && <LinkButton variant="secondary" href={`/app/jobs/${id}/edit`}>Edit</LinkButton>}
            {office && job.status === "completed" && <ActionButton action={async () => { const r = await createInvoice({ jobId: id }); window.location.href = `/app/invoices/${r}`; }}>Create invoice</ActionButton>}
          </>
        }
      />
      <ErrorBox message={error} />
      {job.autoCreated && job.status === "draft" && <div className="mb-4"><Notice tone="blue">Created automatically from a service schedule{job.scheduleDueAt ? ` due ${date(job.scheduleDueAt)}` : ""}. Schedule a time and engineers to confirm it.</Notice></div>}
      {job.qualificationWarnings.length > 0 && <div className="mb-4"><QualificationWarnings warnings={job.qualificationWarnings} /></div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL items={[
            ["Type", humanize(job.type)],
            ["Disciplines", job.disciplines.map(disciplineLabel).join(", ")],
            ["Priority", humanize(job.priority)],
            ["Scheduled", job.scheduledStart ? `${dateTime(job.scheduledStart)}${job.scheduledEnd ? ` – ${dateTime(job.scheduledEnd)}` : ""}` : "Unscheduled"],
            ["Service due", job.scheduleDueAt ? date(job.scheduleDueAt) : null],
            ["Schedule", job.scheduleId ? <a className="text-link hover:underline" href={`/app/schedules/${job.scheduleId}`}>View schedule</a> : null],
            ["Quote", job.quoteId ? <a className="text-link hover:underline" href={`/app/quotes/${job.quoteId}`}>View quote</a> : null],
            ["Purchase order", job.purchaseOrderNumber],
            ["Completed", job.completedAt ? dateTime(job.completedAt) : null],
            ["Description", job.description],
          ]} />
        </Card>
        <Card title="Engineers" actions={office && !locked && <Button variant="ghost" onClick={() => { setEngineers(job.assignedEngineerIds); setAssigning((v) => !v); setAssignWarnings(null); }}>{assigning ? "Close" : "Change"}</Button>}>
          {assigning ? (
            <div className="space-y-3">
              <EngineerChecklist value={engineers} onChange={setEngineers} />
              <ActionButton variant="primary" onError={setError} action={async () => { const r = await assign({ jobId: id, engineerIds: engineers }); setAssignWarnings(r.warnings); setAssigning(false); }}>Save engineers</ActionButton>
            </div>
          ) : (
            <ul className="space-y-1 text-sm">{job.engineers.length ? job.engineers.map((e) => <li key={e._id}>{e.name}</li>) : <li className="text-fg-muted">No engineers assigned.</li>}</ul>
          )}
          {assignWarnings && (assignWarnings.length ? <div className="mt-3"><QualificationWarnings warnings={assignWarnings} title="Assigned, with warnings" /></div> : <div className="mt-3"><Notice tone="green">Engineers assigned. All are qualified.</Notice></div>)}
        </Card>
      </div>

      <Card title="Visits" className="mt-6" actions={!locked && !openVisit && (assigned || office) && job.status !== "draft" && (
        <ActionButton variant="secondary" onError={setError} action={() => startVisit({ jobId: id, arrivedAt: Date.now() })}>Start visit (arrived)</ActionButton>
      )}>
        <Table rows={job.visits} empty="No visits recorded yet." columns={[
          { header: "Arrived", cell: (v) => dateTime(v.arrivedAt) },
          { header: "Departed", cell: (v) => dateTime(v.departedAt) },
          { header: "Status", cell: (v) => <StatusBadge status={v.status} /> },
          { header: "Notes", cell: (v) => v.notes ?? "—" },
        ]} />
        {openVisit && (
          <div className="mt-4 space-y-2 rounded-md border border-line bg-subtle p-3">
            <div className="text-sm font-medium">Finish current visit</div>
            <Textarea placeholder="Visit notes" value={visitNotes} onChange={(e) => setVisitNotes(e.target.value)} />
            <div className="flex gap-2">
              <ActionButton onError={setError} action={() => finishVisit({ visitId: openVisit._id, notes: visitNotes || undefined })}>Finish visit</ActionButton>
              <ActionButton variant="primary" onError={setError} action={() => finishVisit({ visitId: openVisit._id, notes: visitNotes || undefined, completeJob: true })}>Finish & complete job</ActionButton>
            </div>
          </div>
        )}
      </Card>
      <div className="mt-6 flex gap-2">
        <LinkButton variant="secondary" href={`/app/certificates/new?siteId=${job.siteId}&jobId=${id}`}>New certificate for this job</LinkButton>
        <LinkButton variant="secondary" href={`/app/defects/new?siteId=${job.siteId}`}>Raise defect</LinkButton>
      </div>
    </>
  );
}
