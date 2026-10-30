"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { DEFECT_SEVERITIES, DISCIPLINES, DISCIPLINE_LABEL, type Discipline } from "@/lib/labels";
import { fromDateInput, opt } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Select, Textarea } from "@/components/ui";
import { SiteSelect } from "@/components/Pickers";

type Severity = (typeof DEFECT_SEVERITIES)[number];

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const raise = useMutation(api.defects.raise);
  const [siteId, setSiteId] = useState<string>(sp.get("siteId") ?? "");
  const [assetId, setAssetId] = useState<string>(sp.get("assetId") ?? "");
  const [discipline, setDiscipline] = useState<Discipline | "">("fire_alarm");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [severity, setSeverity] = useState<Severity>("minor");
  const [recommendedAction, setRecommendedAction] = useState("");
  const [target, setTarget] = useState("");
  const [visibleToClient, setVisibleToClient] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const assets = useQuery(api.assets.list, siteId ? { siteId: siteId as Id<"sites">, paginationOpts: { numItems: 200, cursor: null } } : "skip");

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const id = await raise({
        siteId: siteId as Id<"sites">, assetId: (assetId || undefined) as Id<"assets"> | undefined, discipline: assetId ? undefined : discipline || undefined,
        title, description: opt(description), severity, recommendedAction: opt(recommendedAction), targetResolutionAt: fromDateInput(target), visibleToClient,
      });
      router.push(`/app/defects/${id}`);
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }
  return (
    <>
      <PageHeader title="Raise defect" back={{ href: "/app/defects", label: "Defects" }} />
      <form onSubmit={submit} className="space-y-6">
        <Card>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Site"><SiteSelect required value={siteId} onChange={(v) => { setSiteId(v); setAssetId(""); }} /></Field>
            <Field label="Asset (optional)"><Select placeholder="No specific asset" value={assetId} onChange={(e) => setAssetId(e.target.value)} options={(assets?.page ?? []).map((a) => ({ value: a._id, label: `${a.reference}${a.description ? ` – ${a.description}` : ""}` }))} /></Field>
            {!assetId && <Field label="Discipline"><Select required options={DISCIPLINES.map((d) => ({ value: d, label: DISCIPLINE_LABEL[d] }))} value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)} /></Field>}
            <Field label="Severity" hint="Critical = system non-compliant / immediate risk to life."><Select options={DEFECT_SEVERITIES} value={severity} onChange={(e) => setSeverity(e.target.value as Severity)} /></Field>
            <Field label="Title" className="sm:col-span-2"><Input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Sounder in stairwell 2 inaudible" /></Field>
            <Field label="Description" className="sm:col-span-2"><Textarea value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="Recommended action" className="sm:col-span-2"><Textarea value={recommendedAction} onChange={(e) => setRecommendedAction(e.target.value)} /></Field>
            <Field label="Target resolution date"><Input type="date" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
            <div className="flex items-end"><Checkbox label="Visible to the client in their portal" checked={visibleToClient} onChange={setVisibleToClient} /></div>
          </div>
        </Card>
        <ErrorBox message={error} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Raise defect"}</Button><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button></div>
      </form>
    </>
  );
}
export default function NewDefectPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
