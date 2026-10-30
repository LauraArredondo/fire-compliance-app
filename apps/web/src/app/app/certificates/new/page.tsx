"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OVERALL_RESULTS, disciplineLabel } from "@/lib/labels";
import { fromDateInput, opt, toDateInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, Textarea } from "@/components/ui";
import { SiteSelect } from "@/components/Pickers";

type Overall = (typeof OVERALL_RESULTS)[number];

function Inner() {
  const { orgId } = useOrg();
  const sp = useSearchParams();
  const router = useRouter();
  const jobId = sp.get("jobId") ?? "";
  const types = useQuery(api.certificateTypes.list, { orgId });
  const createDraft = useMutation(api.certificates.createDraft);
  const [siteId, setSiteId] = useState<string>(sp.get("siteId") ?? "");
  const [typeId, setTypeId] = useState("");
  const [inspectionDate, setInspectionDate] = useState(toDateInput(Date.now()));
  const [overall, setOverall] = useState<Overall>("satisfactory");
  const [summary, setSummary] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const id = await createDraft({
        certificateTypeId: typeId as Id<"certificateTypes">, jobId: (jobId || undefined) as Id<"jobs"> | undefined, siteId: jobId ? undefined : (siteId as Id<"sites">),
        inspectionDate: fromDateInput(inspectionDate), overallResult: overall, summary: opt(summary),
      });
      router.push(`/app/certificates/${id}`);
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }
  return (
    <>
      <PageHeader title="New certificate" back={{ href: jobId ? `/app/jobs/${jobId}` : "/app/certificates", label: jobId ? "Job" : "Certificates" }} />
      <form onSubmit={submit} className="space-y-6">
        <Card>
          {jobId && <div className="mb-4"><Notice tone="blue">The draft will be pre-filled with this job&apos;s inspections, inspected assets and defects.</Notice></div>}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {!jobId && <Field label="Site"><SiteSelect required value={siteId} onChange={setSiteId} /></Field>}
            <Field label="Certificate type"><Select required placeholder={types ? "Select…" : "Loading…"} value={typeId} onChange={(e) => setTypeId(e.target.value)} options={(types ?? []).map((t) => ({ value: t._id, label: `${t.name}${t.standard ? ` (${t.standard})` : ""} · ${disciplineLabel(t.discipline)}` }))} /></Field>
            <Field label="Inspection date"><Input type="date" required value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} /></Field>
            <Field label="Overall result"><Select options={OVERALL_RESULTS} value={overall} onChange={(e) => setOverall(e.target.value as Overall)} /></Field>
            <Field label="Summary" className="sm:col-span-2"><Textarea value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
          </div>
        </Card>
        <ErrorBox message={error} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create draft"}</Button><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button></div>
      </form>
    </>
  );
}
export default function NewCertificatePage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
