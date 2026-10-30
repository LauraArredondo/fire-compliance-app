"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { DISCIPLINES, DISCIPLINE_LABEL, OFFICE, ROLE_LABEL, disciplineLabel, type Discipline, type Role } from "@/lib/labels";
import { date, fromDateInput, opt } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, StatusBadge, Table } from "@/components/ui";

export default function TeamMemberPage() {
  const { userId } = useParams<{ userId: Id<"users"> }>();
  const { orgId, role } = useOrg();
  const office = OFFICE.includes(role);
  const members = useQuery(api.team.list, office ? { orgId, includeDisabled: true } : "skip");
  const quals = useQuery(api.qualifications.list, { orgId, userId });
  const remove = useMutation(api.qualifications.remove);
  const [error, setError] = useState<string | null>(null);
  const m = members?.find((x) => x.userId === userId);
  if (office && !members) return <Loading />;
  return (
    <>
      <PageHeader back={office ? { href: "/app/team", label: "Team" } : undefined}
        title={<span className="flex items-center gap-3">{m?.name ?? m?.email ?? "Team member"} {m && <StatusBadge status={m.status} />}</span>}
        subtitle={m ? `${ROLE_LABEL[m.role as Role]} · ${m.email ?? ""}` : undefined} />
      <ErrorBox message={error} />
      <Card title="Qualifications" className="mb-6">
        <p className="mb-3 text-xs text-fg-muted">Engineers need an in-date qualification for a discipline to sign its certificates (BAFE/NSI audit trail). Owners/admins can override with a recorded reason.</p>
        <Table rows={quals} empty="No qualifications recorded." columns={[
          { header: "Discipline", cell: (q) => disciplineLabel(q.discipline) },
          { header: "Qualification", cell: (q) => q.documentUrl ? <a className="text-link hover:underline" href={q.documentUrl} target="_blank" rel="noreferrer">{q.title}</a> : q.title },
          { header: "Issuer", cell: (q) => q.issuer ?? "—" },
          { header: "Reference", cell: (q) => q.reference ?? "—" },
          { header: "Expires", cell: (q) => <span>{date(q.expiresAt)} {q.expiresAt && q.expiresAt < Date.now() && <Badge tone="red">Expired</Badge>}</span> },
          { header: "", cell: (q) => office ? <ActionButton variant="ghost" confirm="Remove this qualification?" onError={setError} action={() => remove({ qualificationId: q._id })}>Remove</ActionButton> : null },
        ]} />
      </Card>
      {office && <AddQualification userId={userId} />}
    </>
  );
}

function AddQualification({ userId }: { userId: Id<"users"> }) {
  const { orgId } = useOrg();
  const create = useMutation(api.qualifications.create);
  const [discipline, setDiscipline] = useState<Discipline>("fire_alarm");
  const [title, setTitle] = useState("");
  const [issuer, setIssuer] = useState("");
  const [reference, setReference] = useState("");
  const [issuedAt, setIssuedAt] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { await create({ orgId, userId, discipline, title, issuer: opt(issuer), reference: opt(reference), issuedAt: fromDateInput(issuedAt), expiresAt: fromDateInput(expiresAt) }); setTitle(""); setIssuer(""); setReference(""); setIssuedAt(""); setExpiresAt(""); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <Card title="Add qualification">
      <form onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Discipline"><Select options={DISCIPLINES.map((d) => ({ value: d, label: DISCIPLINE_LABEL[d] }))} value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} /></Field>
        <Field label="Title"><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. FIA Unit 4 – Maintenance" /></Field>
        <Field label="Issuer"><Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="FIA" /></Field>
        <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <Field label="Issued"><Input type="date" value={issuedAt} onChange={(e) => setIssuedAt(e.target.value)} /></Field>
        <Field label="Expires"><Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} /></Field>
        <div className="sm:col-span-3"><ErrorBox message={error} /></div>
        <div><Button type="submit">Add qualification</Button></div>
      </form>
    </Card>
  );
}
