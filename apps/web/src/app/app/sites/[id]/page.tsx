"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, disciplineLabel, humanize, jobStatusLabel } from "@/lib/labels";
import { address, date, dateTime, opt } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Badge, Button, Card, DL, ErrorBox, Field, Input, LinkButton, Loading, LoadMore, PageHeader, Select, StatusBadge, Table } from "@/components/ui";
import { ClientName } from "@/components/Refs";

const LOCATION_KINDS = ["building", "floor", "zone", "room", "area"] as const;

export default function SiteDetailPage() {
  const { id } = useParams<{ id: Id<"sites"> }>();
  const { orgId, role } = useOrg();
  const office = OFFICE.includes(role);
  const site = useQuery(api.sites.get, { siteId: id });
  const assets = usePaginatedQuery(api.assets.list, { siteId: id }, { initialNumItems: 25 });
  const defects = useQuery(api.defects.openForSite, { orgId, siteId: id });
  const certs = useQuery(api.certificates.listBySite, { orgId, siteId: id });
  const schedules = useQuery(api.serviceSchedules.list, { orgId, siteId: id, paginationOpts: { numItems: 50, cursor: null } });
  const jobs = useQuery(api.jobs.list, { orgId, siteId: id, paginationOpts: { numItems: 20, cursor: null } });
  const setArchived = useMutation(api.sites.setArchived);
  const [addingAsset, setAddingAsset] = useState(false);

  if (!site) return <Loading />;
  const archived = site.status === "archived";
  const locName = (lid?: string) => site.locations.find((l) => l._id === lid)?.name ?? "—";
  return (
    <>
      <PageHeader
        back={{ href: "/app/sites", label: "Sites" }}
        title={<span className="flex items-center gap-3">{site.name} {archived && <Badge tone="amber">Archived</Badge>}</span>}
        subtitle={<>{address(site.address)} · <ClientName id={site.clientId} /></>}
        actions={
          <>
            {!archived && <LinkButton href={`/app/jobs/new?siteId=${id}`}>New job</LinkButton>}
            {!archived && <LinkButton variant="secondary" href={`/app/defects/new?siteId=${id}`}>Raise defect</LinkButton>}
            <LinkButton variant="secondary" href={`/app/sites/${id}/edit`}>Edit</LinkButton>
            {office && (
              <ActionButton variant={archived ? "secondary" : "danger"} confirm={archived ? undefined : "Archive this site? Its active service schedules will be paused."} action={() => setArchived({ siteId: id, archived: !archived })}>
                {archived ? "Restore" : "Archive"}
              </ActionButton>
            )}
          </>
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL items={[
            ["Reference", site.reference],
            ["Site contact", site.siteContact ? [site.siteContact.name, site.siteContact.phone, site.siteContact.email].filter(Boolean).join(" · ") : null],
            ["Responsible person", site.responsiblePerson ? [site.responsiblePerson.name, site.responsiblePerson.phone, site.responsiblePerson.email].filter(Boolean).join(" · ") : null],
            ["Access notes", site.accessNotes],
            ["Hazards", site.hazards?.length ? site.hazards.join("; ") : null],
          ]} />
        </Card>
        <LocationsCard siteId={id} locations={site.locations} />
      </div>

      <Card title="Asset register" className="mt-6" actions={!archived && <Button variant="secondary" onClick={() => setAddingAsset((v) => !v)}>{addingAsset ? "Close" : "Add asset"}</Button>}>
        {addingAsset && <AddAssetForm siteId={id} locations={site.locations} onDone={() => setAddingAsset(false)} />}
        <Table rows={assets.status === "LoadingFirstPage" ? undefined : assets.results} href={(a) => `/app/assets/${a._id}`} empty="No assets registered." columns={[
          { header: "Ref", cell: (a) => a.reference },
          { header: "Discipline", cell: (a) => disciplineLabel(a.discipline) },
          { header: "Description", cell: (a) => a.description || [a.manufacturer, a.model].filter(Boolean).join(" ") || "—" },
          { header: "Location", cell: (a) => locName(a.locationId) },
          { header: "Status", cell: (a) => <StatusBadge status={a.status} /> },
          { header: "Next due", cell: (a) => date(a.nextDueAt) },
        ]} />
        <LoadMore status={assets.status} loadMore={assets.loadMore} />
      </Card>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Open defects">
          <Table rows={defects} href={(d) => `/app/defects/${d._id}`} empty="No open defects." columns={[
            { header: "Defect", cell: (d) => d.title },
            { header: "Severity", cell: (d) => <StatusBadge status={d.severity} /> },
            { header: "Status", cell: (d) => <StatusBadge status={d.status} /> },
          ]} />
        </Card>
        <Card title="Certificates" actions={!archived && <LinkButton variant="secondary" href={`/app/certificates/new?siteId=${id}`}>New certificate</LinkButton>}>
          <Table rows={certs} href={(c) => `/app/certificates/${c._id}`} empty="No certificates." columns={[
            { header: "Number", cell: (c) => c.certificateNumber },
            { header: "Discipline", cell: (c) => disciplineLabel(c.discipline) },
            { header: "Inspected", cell: (c) => date(c.inspectionDate) },
            { header: "Status", cell: (c) => <StatusBadge status={c.status} /> },
          ]} />
        </Card>
        <Card title="Service schedules" actions={office && !archived && <LinkButton variant="secondary" href={`/app/schedules/new?siteId=${id}`}>New schedule</LinkButton>}>
          <Table rows={schedules?.page} href={(s) => `/app/schedules/${s._id}`} empty="No service schedules." columns={[
            { header: "Schedule", cell: (s) => s.name },
            { header: "Every", cell: (s) => `${s.frequency.interval} ${s.frequency.unit}${s.frequency.interval === 1 ? "" : "s"}` },
            { header: "Next due", cell: (s) => date(s.nextDueAt) },
            { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
          ]} />
        </Card>
        <Card title="Recent jobs">
          <Table rows={jobs?.page} href={(j) => `/app/jobs/${j._id}`} empty="No jobs." columns={[
            { header: "Job", cell: (j) => `${j.jobNumber} · ${j.title}` },
            { header: "Type", cell: (j) => humanize(j.type) },
            { header: "Scheduled", cell: (j) => dateTime(j.scheduledStart) },
            { header: "Status", cell: (j) => <StatusBadge status={j.status} label={jobStatusLabel(j.status)} /> },
          ]} />
        </Card>
      </div>
    </>
  );
}

type Loc = { _id: Id<"locations">; name: string; kind: string; parentId?: Id<"locations">; code?: string };

function LocationsCard({ siteId, locations }: { siteId: Id<"sites">; locations: Loc[] }) {
  const create = useMutation(api.locations.create);
  const remove = useMutation(api.locations.remove);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<(typeof LOCATION_KINDS)[number]>("floor");
  const [parentId, setParentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const depth = (l: Loc): number => { let d = 0; let p = l.parentId; while (p && d < 6) { d++; p = locations.find((x) => x._id === p)?.parentId; } return d; };
  const ordered: Loc[] = [];
  const walk = (parent?: string) => locations.filter((l) => (l.parentId ?? undefined) === parent).forEach((l) => { ordered.push(l); walk(l._id); });
  walk(undefined);
  locations.forEach((l) => { if (!ordered.includes(l)) ordered.push(l); });

  async function add(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { await create({ siteId, name, kind, parentId: (parentId || undefined) as Id<"locations"> | undefined }); setName(""); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <Card title="Locations">
      <ul className="mb-3 space-y-1 text-sm">
        {ordered.map((l) => (
          <li key={l._id} className="flex items-center justify-between" style={{ paddingLeft: depth(l) * 14 }}>
            <span>{l.name} <span className="text-xs text-slate-400">{l.kind}</span></span>
            <ActionButton variant="ghost" confirm={`Remove ${l.name}?`} action={() => remove({ locationId: l._id })}>×</ActionButton>
          </li>
        ))}
        {!locations.length && <li className="text-slate-500">No locations yet.</li>}
      </ul>
      <form onSubmit={add} className="space-y-2 border-t border-slate-100 pt-3">
        <div className="grid grid-cols-2 gap-2">
          <Input required placeholder="e.g. Ground floor" value={name} onChange={(e) => setName(e.target.value)} />
          <Select options={LOCATION_KINDS} value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} />
        </div>
        <Select placeholder="No parent" options={ordered.map((l) => ({ value: l._id, label: l.name }))} value={parentId} onChange={(e) => setParentId(e.target.value)} />
        <ErrorBox message={error} />
        <Button type="submit" variant="secondary">Add location</Button>
      </form>
    </Card>
  );
}

function AddAssetForm({ siteId, locations, onDone }: { siteId: Id<"sites">; locations: Loc[]; onDone: () => void }) {
  const { orgId } = useOrg();
  const types = useQuery(api.assetTypes.list, { orgId });
  const create = useMutation(api.assets.create);
  const [assetTypeId, setAssetTypeId] = useState("");
  const [reference, setReference] = useState("");
  const [description, setDescription] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [locationId, setLocationId] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await create({ siteId, assetTypeId: assetTypeId as Id<"assetTypes">, reference, description: opt(description), manufacturer: opt(manufacturer), model: opt(model), serialNumber: opt(serialNumber), locationId: (locationId || undefined) as Id<"locations"> | undefined });
      onDone();
    } catch (err) { setError(errorMessage(err)); }
  }
  return (
    <form onSubmit={submit} className="mb-4 space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Type"><Select required placeholder={types ? "Select type…" : "Loading…"} value={assetTypeId} onChange={(e) => setAssetTypeId(e.target.value)} options={(types ?? []).map((t) => ({ value: t._id, label: `${t.name} (${disciplineLabel(t.discipline)})` }))} /></Field>
        <Field label="Reference / device address"><Input required value={reference} onChange={(e) => setReference(e.target.value)} placeholder="L1-D023" /></Field>
        <Field label="Location"><Select placeholder="—" value={locationId} onChange={(e) => setLocationId(e.target.value)} options={locations.map((l) => ({ value: l._id, label: l.name }))} /></Field>
        <Field label="Description"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Manufacturer"><Input value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} /></Field>
        <Field label="Model"><Input value={model} onChange={(e) => setModel(e.target.value)} /></Field>
        <Field label="Serial number"><Input value={serialNumber} onChange={(e) => setSerialNumber(e.target.value)} /></Field>
      </div>
      <ErrorBox message={error} />
      <Button type="submit">Add asset</Button>
    </form>
  );
}
