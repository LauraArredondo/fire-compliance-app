"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { disciplineLabel, humanize } from "@/lib/labels";
import { NotAvailable } from "@/components/NotAvailable";
import { useAssignedScope, usePermissions } from "@/lib/permissions";
import { date, fromDateInput, opt, toDateInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Button, Card, DL, ErrorBox, Field, Input, LinkButton, Loading, PageHeader, StatusBadge } from "@/components/ui";

export default function AssetPage() {
  const { id } = useParams<{ id: Id<"assets"> }>();
  const asset = useQuery(api.assets.get, { assetId: id });
  const scope = useAssignedScope();
  const setStatus = useMutation(api.assets.setStatus);
  const decommission = useMutation(api.assets.decommission);
  const [editing, setEditing] = useState(false);
  if (!asset || !scope.ready) return <Loading />;
  // Engineers only see assets at the sites of their own jobs.
  if (!scope.canSeeSite(asset.siteId)) return <NotAvailable what="asset" />;
  const gone = asset.status === "removed" || asset.status === "replaced";
  return (
    <>
      <PageHeader
        back={{ href: `/app/sites/${asset.siteId}`, label: asset.siteName }}
        title={<span className="flex items-center gap-3">{asset.reference} <StatusBadge status={asset.status} /></span>}
        subtitle={`${asset.assetTypeName ?? "Asset"} · ${disciplineLabel(asset.discipline)}`}
        actions={!gone && (
          <>
            <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit"}</Button>
            {asset.status !== "in_service" && <ActionButton action={() => setStatus({ assetId: id, status: "in_service" })}>Mark in service</ActionButton>}
            {asset.status !== "defective" && <ActionButton action={() => setStatus({ assetId: id, status: "defective" })}>Mark defective</ActionButton>}
            {asset.status !== "out_of_service" && <ActionButton action={() => setStatus({ assetId: id, status: "out_of_service" })}>Out of service</ActionButton>}
            <ActionButton variant="danger" confirm="Mark this asset as removed from site?" action={async () => { const reason = window.prompt("Reason for removal?"); if (reason) await decommission({ assetId: id, status: "removed", reason }); }}>Remove</ActionButton>
            <LinkButton variant="secondary" href={`/app/defects/new?siteId=${asset.siteId}&assetId=${id}`}>Raise defect</LinkButton>
          </>
        )}
      />
      {editing && <EditAsset asset={asset} onDone={() => setEditing(false)} />}
      <Card title="Details">
        <DL items={[
          ["Description", asset.description],
          ["Location", asset.locationName],
          ["Manufacturer", asset.manufacturer],
          ["Model", asset.model],
          ["Serial number", asset.serialNumber],
          ["Installed", asset.installedAt ? date(asset.installedAt) : null],
          ["Warranty expires", asset.warrantyExpiresAt ? date(asset.warrantyExpiresAt) : null],
          ["Replace by", asset.replaceBy ? date(asset.replaceBy) : null],
          ["Last inspected", asset.lastInspectedAt ? `${date(asset.lastInspectedAt)}${asset.lastResult ? ` (${humanize(asset.lastResult)})` : ""}` : null],
          ["Next due", asset.nextDueAt ? date(asset.nextDueAt) : null],
          ["Tag code", asset.tagCode],
        ]} />
      </Card>
    </>
  );
}

type A = { _id: Id<"assets">; reference: string; description?: string; manufacturer?: string; model?: string; serialNumber?: string; installedAt?: number; warrantyExpiresAt?: number; replaceBy?: number };
function EditAsset({ asset, onDone }: { asset: A; onDone: () => void }) {
  const update = useMutation(api.assets.update);
  const [f, setF] = useState({
    reference: asset.reference, description: asset.description ?? "", manufacturer: asset.manufacturer ?? "", model: asset.model ?? "", serialNumber: asset.serialNumber ?? "",
    installedAt: toDateInput(asset.installedAt), warrantyExpiresAt: toDateInput(asset.warrantyExpiresAt), replaceBy: toDateInput(asset.replaceBy),
  });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try {
      await update({ assetId: asset._id, reference: f.reference, description: opt(f.description), manufacturer: opt(f.manufacturer), model: opt(f.model), serialNumber: opt(f.serialNumber),
        installedAt: fromDateInput(f.installedAt), warrantyExpiresAt: fromDateInput(f.warrantyExpiresAt), replaceBy: fromDateInput(f.replaceBy) });
      onDone();
    } catch (err) { setError(errorMessage(err)); }
  }
  return (
    <Card title="Edit asset" className="mb-6">
      <form onSubmit={save} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Reference"><Input required value={f.reference} onChange={set("reference")} /></Field>
          <Field label="Description"><Input value={f.description} onChange={set("description")} /></Field>
          <Field label="Manufacturer"><Input value={f.manufacturer} onChange={set("manufacturer")} /></Field>
          <Field label="Model"><Input value={f.model} onChange={set("model")} /></Field>
          <Field label="Serial number"><Input value={f.serialNumber} onChange={set("serialNumber")} /></Field>
          <Field label="Installed"><Input type="date" value={f.installedAt} onChange={set("installedAt")} /></Field>
          <Field label="Warranty expires"><Input type="date" value={f.warrantyExpiresAt} onChange={set("warrantyExpiresAt")} /></Field>
          <Field label="Replace by"><Input type="date" value={f.replaceBy} onChange={set("replaceBy")} /></Field>
        </div>
        <ErrorBox message={error} />
        <Button type="submit">Save</Button>
      </form>
    </Card>
  );
}
