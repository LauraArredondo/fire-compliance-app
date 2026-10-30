"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { errorMessage } from "@/lib/errors";
import { DISCIPLINES, DISCIPLINE_LABEL, FREQ_UNITS, type Discipline } from "@/lib/labels";
import { fromDateInput, opt, toDateInput } from "@/lib/format";
import { Button, Card, Checkbox, ErrorBox, Field, Input, Select } from "@/components/ui";
import { EngineerSelect, SiteSelect } from "@/components/Pickers";

type Unit = (typeof FREQ_UNITS)[number];

export function ScheduleForm({ schedule, defaultSiteId }: { schedule?: Doc<"serviceSchedules">; defaultSiteId?: string }) {
  const router = useRouter();
  const create = useMutation(api.serviceSchedules.create);
  const update = useMutation(api.serviceSchedules.update);
  const [siteId, setSiteId] = useState<string>(schedule?.siteId ?? defaultSiteId ?? "");
  const [name, setName] = useState(schedule?.name ?? "");
  const [discipline, setDiscipline] = useState<Discipline>((schedule?.discipline as Discipline) ?? "fire_alarm");
  const [interval, setInterval] = useState(String(schedule?.frequency.interval ?? 6));
  const [unit, setUnit] = useState<Unit>(schedule?.frequency.unit ?? "month");
  const [nextDue, setNextDue] = useState(toDateInput(schedule?.nextDueAt));
  const [lastDone, setLastDone] = useState(toDateInput(schedule?.lastCompletedAt));
  const [offsets, setOffsets] = useState((schedule?.reminderOffsetsDays ?? [30, 14, 7, 0]).join(", "));
  const [notifyClient, setNotifyClient] = useState(schedule?.notifyClient ?? true);
  const [notifyOrg, setNotifyOrg] = useState(schedule?.notifyOrg ?? true);
  const [autoCreateJob, setAutoCreateJob] = useState(schedule?.autoCreateJob ?? true);
  const [leadDays, setLeadDays] = useState(schedule?.autoJobLeadDays !== undefined ? String(schedule.autoJobLeadDays) : "");
  const [engineer, setEngineer] = useState<string>(schedule?.defaultEngineerId ?? "");
  const [contractRef, setContractRef] = useState(schedule?.contractReference ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    const frequency = { interval: Number(interval) || 1, unit };
    const reminderOffsetsDays = offsets.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));
    try {
      if (schedule) {
        await update({
          scheduleId: schedule._id, name, frequency, nextDueAt: fromDateInput(nextDue), reminderOffsetsDays, notifyClient, notifyOrg, autoCreateJob,
          contractReference: opt(contractRef), autoJobLeadDays: leadDays === "" ? null : Number(leadDays), defaultEngineerId: (engineer || null) as Id<"users"> | null,
        });
        router.push(`/app/schedules/${schedule._id}`);
      } else {
        const id = await create({
          siteId: siteId as Id<"sites">, name, discipline, frequency, nextDueAt: fromDateInput(nextDue), lastCompletedAt: fromDateInput(lastDone), reminderOffsetsDays,
          notifyClient, notifyOrg, autoCreateJob, contractReference: opt(contractRef), autoJobLeadDays: leadDays === "" ? undefined : Number(leadDays),
          defaultEngineerId: (engineer || undefined) as Id<"users"> | undefined,
        });
        router.push(`/app/schedules/${id}`);
      }
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title="Schedule">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!schedule && <Field label="Site"><SiteSelect required value={siteId} onChange={setSiteId} /></Field>}
          {!schedule && <Field label="Discipline"><Select options={DISCIPLINES.map((d) => ({ value: d, label: DISCIPLINE_LABEL[d] }))} value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} /></Field>}
          <Field label="Name" className="sm:col-span-2"><Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Fire alarm 6-monthly service (BS 5839-1)" /></Field>
          <Field label="Every">
            <div className="flex gap-2"><Input className="w-20" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} /><Select options={FREQ_UNITS} value={unit} onChange={(e) => setUnit(e.target.value as Unit)} /></div>
          </Field>
          <Field label="Next due" hint={schedule ? undefined : "Or give the last completed date instead."}><Input type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} /></Field>
          {!schedule && <Field label="Last completed"><Input type="date" value={lastDone} onChange={(e) => setLastDone(e.target.value)} /></Field>}
          <Field label="Contract reference"><Input value={contractRef} onChange={(e) => setContractRef(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Reminders">
        <div className="space-y-3">
          <Field label="Remind (days before due)" hint="Comma-separated, e.g. 30, 14, 7, 0"><Input value={offsets} onChange={(e) => setOffsets(e.target.value)} /></Field>
          <Checkbox label="Email the client" checked={notifyClient} onChange={setNotifyClient} />
          <Checkbox label="Notify the office" checked={notifyOrg} onChange={setNotifyOrg} />
        </div>
      </Card>
      <Card title="Automatic jobs">
        <div className="space-y-3">
          <Checkbox label="Automatically create an Unscheduled job before each due date" checked={autoCreateJob} onChange={setAutoCreateJob} />
          {autoCreateJob && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Lead time (days)" hint="Blank = company default (Settings → Job automation)."><Input inputMode="numeric" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} /></Field>
              <Field label="Default engineer"><EngineerSelect value={engineer} onChange={setEngineer} placeholder="None" /></Field>
            </div>
          )}
        </div>
      </Card>
      <ErrorBox message={error} />
      <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : schedule ? "Save changes" : "Create schedule"}</Button><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button></div>
    </form>
  );
}
