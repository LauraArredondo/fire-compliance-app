"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, disciplineLabel } from "@/lib/labels";
import { date } from "@/lib/format";
import { ActionButton, Button, Card, DL, ErrorBox, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { ScheduleForm } from "@/components/forms/ScheduleForm";
import { SiteName } from "@/components/Refs";
import { useEngineers } from "@/components/Pickers";

export default function SchedulePage() {
  const { id } = useParams<{ id: Id<"serviceSchedules"> }>();
  const { role } = useOrg();
  const office = OFFICE.includes(role);
  const s = useQuery(api.serviceSchedules.get, { scheduleId: id });
  const engineers = useEngineers();
  const setStatus = useMutation(api.serviceSchedules.setStatus);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!s) return <Loading />;
  if (editing) return (<><PageHeader title={`Edit ${s.name}`} back={{ href: `/app/schedules/${id}`, label: s.name }} /><ScheduleForm schedule={s as Doc<"serviceSchedules">} /></>);
  const eng = engineers?.find((e) => e.userId === s.defaultEngineerId);
  return (
    <>
      <PageHeader
        back={{ href: "/app/schedules", label: "Schedules" }}
        title={<span className="flex items-center gap-3">{s.name} <StatusBadge status={s.status} /></span>}
        subtitle={<SiteName id={s.siteId} />}
        actions={office && (
          <>
            {s.status !== "ended" && <Button variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}
            {s.status === "active" && <ActionButton onError={setError} action={() => setStatus({ scheduleId: id, status: "paused" })}>Pause</ActionButton>}
            {s.status === "paused" && <ActionButton onError={setError} action={() => setStatus({ scheduleId: id, status: "active" })}>Resume</ActionButton>}
            {s.status !== "ended" && <ActionButton variant="danger" confirm="End this schedule? No more reminders or jobs will be created." onError={setError} action={() => setStatus({ scheduleId: id, status: "ended" })}>End</ActionButton>}
          </>
        )}
      />
      <ErrorBox message={error} />
      <Card>
        <DL items={[
          ["Discipline", disciplineLabel(s.discipline)],
          ["Frequency", `Every ${s.frequency.interval} ${s.frequency.unit}${s.frequency.interval === 1 ? "" : "s"}`],
          ["Next due", date(s.nextDueAt)],
          ["Last completed", s.lastCompletedAt ? date(s.lastCompletedAt) : null],
          ["Reminders", s.reminderOffsetsDays.map((d) => (d === 0 ? "on the day" : `${d}d before`)).join(", ")],
          ["Notify", [s.notifyClient && "client", s.notifyOrg && "office"].filter(Boolean).join(" & ") || "nobody"],
          ["Automatic jobs", s.autoCreateJob ? `Yes${s.autoJobLeadDays !== undefined ? `, ${s.autoJobLeadDays} days before due` : " (company lead time)"}` : "No"],
          ["Default engineer", s.defaultEngineerId ? eng?.name ?? "—" : null],
          ["Contract reference", s.contractReference],
        ]} />
      </Card>
    </>
  );
}
