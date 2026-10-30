"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { DEFECT_SEVERITIES, disciplineLabel, humanize } from "@/lib/labels";
import { NotAvailable } from "@/components/NotAvailable";
import { useAssignedScope, usePermissions } from "@/lib/permissions";
import { date, dateTime, fromDateInput, opt, toDateInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Button, Card, Checkbox, DL, ErrorBox, Field, Input, LinkButton, Loading, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { SiteName } from "@/components/Refs";

type Severity = (typeof DEFECT_SEVERITIES)[number];
const OPEN = ["open", "quoted", "scheduled", "in_progress"];

export default function DefectPage() {
  const { id } = useParams<{ id: Id<"defects"> }>();
  const perms = usePermissions();
  const scope = useAssignedScope();
  const office = perms.can("defects.verifyClose");
  const d = useQuery(api.defects.get, { defectId: id });
  const setStatus = useMutation(api.defects.setStatus);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!d || !scope.ready) return <Loading />;
  // Engineers only see defects at the sites of their own jobs.
  if (!scope.canSeeSite(d.siteId)) return <NotAvailable what="defect" />;
  const closed = d.status === "verified" || d.status === "closed_no_action";
  const to = (status: string, needNotes?: boolean) => async () => {
    let notes: string | undefined;
    if (needNotes) { notes = window.prompt(status === "closed_no_action" ? "Reason for closing without action?" : "Resolution notes (optional)") ?? undefined; if (status === "closed_no_action" && !notes) return; }
    await setStatus({ defectId: id, status: status as never, resolutionNotes: notes || undefined });
  };
  return (
    <>
      <PageHeader
        back={{ href: "/app/defects", label: "Defects" }}
        title={<span className="flex flex-wrap items-center gap-3">{d.reference} · {d.title} <StatusBadge status={d.severity} /> <StatusBadge status={d.status} /></span>}
        subtitle={<SiteName id={d.siteId} />}
        actions={
          <>
            {d.status === "open" && <ActionButton onError={setError} action={to("in_progress")}>Start work</ActionButton>}
            {OPEN.includes(d.status) && <ActionButton variant="primary" onError={setError} action={to("resolved", true)}>Mark resolved</ActionButton>}
            {office && d.status === "resolved" && <ActionButton variant="primary" onError={setError} action={to("verified")}>Verify</ActionButton>}
            {office && OPEN.includes(d.status) && <ActionButton variant="danger" onError={setError} action={to("closed_no_action", true)}>Close, no action</ActionButton>}
            {!OPEN.includes(d.status) && <ActionButton onError={setError} action={to("open")}>Reopen</ActionButton>}
            {!closed && <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>}
            {perms.can("defects.quote") && OPEN.includes(d.status) && !d.quoteId && <LinkButton variant="secondary" href={`/app/quotes/new?clientId=${d.clientId}&siteId=${d.siteId}&defectId=${id}`}>Quote remedial</LinkButton>}
          </>
        }
      />
      <ErrorBox message={error} />
      {editing && <EditDefect d={d} onDone={() => setEditing(false)} />}
      <Card title="Details">
        <DL items={[
          ["Discipline", disciplineLabel(d.discipline)],
          ["Asset", d.assetId ? <a className="text-red-700 hover:underline" href={`/app/assets/${d.assetId}`}>View asset</a> : null],
          ["Description", d.description],
          ["Recommended action", d.recommendedAction],
          ["Raised", dateTime(d.raisedAt)],
          ["Target resolution", d.targetResolutionAt ? date(d.targetResolutionAt) : null],
          ["Visible to client", d.visibleToClient ? "Yes" : "No"],
          ["Quote", d.quoteId ? <a className="text-red-700 hover:underline" href={`/app/quotes/${d.quoteId}`}>View quote</a> : null],
          ["Remedial job", d.remedialJobId ? <a className="text-red-700 hover:underline" href={`/app/jobs/${d.remedialJobId}`}>View job</a> : null],
          ["Resolved", d.resolvedAt ? dateTime(d.resolvedAt) : null],
          ["Resolution notes", d.resolutionNotes],
          ["Status", humanize(d.status)],
        ]} />
        {d.photoUrls.filter(Boolean).length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">{d.photoUrls.filter(Boolean).map((u) => <a key={u!} href={u!} target="_blank" rel="noreferrer"><img src={u!} alt="Defect photo" className="h-28 w-28 rounded object-cover" /></a>)}</div>
        )}
      </Card>
    </>
  );
}

type D = { _id: Id<"defects">; title: string; description?: string; severity: Severity; recommendedAction?: string; targetResolutionAt?: number; visibleToClient?: boolean };
function EditDefect({ d, onDone }: { d: D; onDone: () => void }) {
  const update = useMutation(api.defects.update);
  const [title, setTitle] = useState(d.title);
  const [description, setDescription] = useState(d.description ?? "");
  const [severity, setSeverity] = useState<Severity>(d.severity);
  const [action, setAction] = useState(d.recommendedAction ?? "");
  const [target, setTarget] = useState(toDateInput(d.targetResolutionAt));
  const [visible, setVisible] = useState(d.visibleToClient ?? true);
  const [error, setError] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { await update({ defectId: d._id, title, description: opt(description), severity, recommendedAction: opt(action), targetResolutionAt: fromDateInput(target), visibleToClient: visible }); onDone(); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <Card title="Edit defect" className="mb-6">
      <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2"><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Severity"><Select options={DEFECT_SEVERITIES} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} /></Field>
        <Field label="Target resolution"><Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        <Field label="Description" className="sm:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Recommended action" className="sm:col-span-2"><Textarea value={action} onChange={(e) => setAction(e.target.value)} /></Field>
        <Checkbox label="Visible to the client" checked={visible} onChange={setVisible} />
        <div className="sm:col-span-2"><ErrorBox message={error} /></div>
        <div><Button type="submit">Save</Button></div>
      </form>
    </Card>
  );
}
