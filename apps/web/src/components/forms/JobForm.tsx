"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { errorMessage } from "@/lib/errors";
import { DISCIPLINES, DISCIPLINE_LABEL, JOB_TYPES, PRIORITIES, type Discipline } from "@/lib/labels";
import { fromDateTimeInput, opt, toDateTimeInput } from "@/lib/format";
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from "@/components/ui";
import { EngineerChecklist, SiteSelect } from "@/components/Pickers";
import { QualificationWarnings, type AssignmentWarning } from "@/components/Warnings";

type JobType = (typeof JOB_TYPES)[number];
type Priority = (typeof PRIORITIES)[number];

export function JobForm({ job, defaultSiteId }: { job?: Doc<"jobs">; defaultSiteId?: string }) {
  const { orgId } = useOrg();
  const router = useRouter();
  const create = useMutation(api.jobs.create);
  const update = useMutation(api.jobs.update);
  const assign = useMutation(api.jobs.assignEngineers);
  const [siteId, setSiteId] = useState<string>(job?.siteId ?? defaultSiteId ?? "");
  const [title, setTitle] = useState(job?.title ?? "");
  const [type, setType] = useState<JobType>(job?.type ?? "routine_service");
  const [priority, setPriority] = useState<Priority>(job?.priority ?? "normal");
  const [disciplines, setDisciplines] = useState<Discipline[]>((job?.disciplines as Discipline[]) ?? ["fire_alarm"]);
  const [description, setDescription] = useState(job?.description ?? "");
  const [start, setStart] = useState(toDateTimeInput(job?.scheduledStart));
  const [end, setEnd] = useState(toDateTimeInput(job?.scheduledEnd));
  const [po, setPo] = useState(job?.purchaseOrderNumber ?? "");
  const [engineers, setEngineers] = useState<Id<"users">[]>(job?.assignedEngineerIds ?? []);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const check = useQuery(api.jobs.checkAssignment, engineers.length && disciplines.length ? { orgId, engineerIds: engineers, disciplines, at: fromDateTimeInput(start) } : "skip");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    const common = { title: title.trim(), type, priority, disciplines, description: opt(description), scheduledStart: fromDateTimeInput(start), scheduledEnd: fromDateTimeInput(end), purchaseOrderNumber: opt(po) };
    try {
      let id: Id<"jobs">;
      let warnings: AssignmentWarning[] = [];
      if (job) {
        await update({ jobId: job._id, ...common });
        const same = engineers.length === job.assignedEngineerIds.length && engineers.every((x) => job.assignedEngineerIds.includes(x));
        if (!same) warnings = (await assign({ jobId: job._id, engineerIds: engineers })).warnings;
        id = job._id;
      } else {
        if (!siteId) throw new Error("Choose a site");
        id = await create({ siteId: siteId as Id<"sites">, assignedEngineerIds: engineers, ...common });
      }
      router.push(`/app/jobs/${id}`);
      void warnings; // assignment warnings are shown on the job page (jobs.get qualificationWarnings)
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title="Job">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!job && <Field label="Site" className="sm:col-span-2"><SiteSelect required value={siteId} onChange={setSiteId} /></Field>}
          <Field label="Title" className="sm:col-span-2"><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. 6-monthly fire alarm service" /></Field>
          <Field label="Type"><Select options={JOB_TYPES} value={type} onChange={(e) => setType(e.target.value as JobType)} /></Field>
          <Field label="Priority"><Select options={PRIORITIES} value={priority} onChange={(e) => setPriority(e.target.value as Priority)} /></Field>
          <Field label="Disciplines" className="sm:col-span-2">
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
              {DISCIPLINES.map((d) => (
                <label key={d} className="inline-flex items-center gap-2 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={disciplines.includes(d)} onChange={(e) => setDisciplines(e.target.checked ? [...disciplines, d] : disciplines.filter((x) => x !== d))} />
                  {DISCIPLINE_LABEL[d]}
                </label>
              ))}
            </div>
          </Field>
          <Field label="Description" className="sm:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
          <Field label="Purchase order number"><Input value={po} onChange={(e) => setPo(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Scheduling">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Start" hint="Leave blank to keep the job Unscheduled."><Input type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
          <Field label="End"><Input type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} /></Field>
          <Field label="Engineers" className="sm:col-span-2"><EngineerChecklist value={engineers} onChange={setEngineers} /></Field>
        </div>
        <div className="mt-3"><QualificationWarnings warnings={check?.warnings} /></div>
      </Card>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : job ? "Save changes" : "Create job"}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
