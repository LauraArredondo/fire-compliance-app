"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api, type Id } from "@/lib/api";
import { fromDateInput, opt, toDateInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Textarea } from "@/components/ui";
import { ClientSelect, SiteSelect } from "@/components/Pickers";
import { LinesEditor, blankLine, toLineArgs, type LineDraft } from "@/components/LinesEditor";

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const create = useMutation(api.quotes.create);
  const defectId = sp.get("defectId");
  const [clientId, setClientId] = useState<string>(sp.get("clientId") ?? "");
  const [siteId, setSiteId] = useState<string>(sp.get("siteId") ?? "");
  const [title, setTitle] = useState(defectId ? "Remedial works" : "");
  const [introduction, setIntroduction] = useState("");
  const [terms, setTerms] = useState("");
  const [validUntil, setValidUntil] = useState(toDateInput(Date.now() + 30 * 864e5));
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const id = await create({
        clientId: clientId as Id<"clients">, siteId: (siteId || undefined) as Id<"sites"> | undefined, title, introduction: opt(introduction), terms: opt(terms),
        validUntil: fromDateInput(validUntil), defectIds: defectId ? [defectId as Id<"defects">] : undefined,
        lines: lines.filter((l) => l.description.trim()).map((l) => ({ ...toLineArgs(l), kind: l.kind as never, optional: l.optional || undefined })),
      });
      router.push(`/app/quotes/${id}`);
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }
  return (
    <>
      <PageHeader title="New quote" back={{ href: "/app/quotes", label: "Quotes" }} />
      <form onSubmit={submit} className="space-y-6">
        <Card title="Quote">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client"><ClientSelect required value={clientId} onChange={(v) => { setClientId(v); setSiteId(""); }} /></Field>
            <Field label="Site (optional)"><SiteSelect clientId={clientId as Id<"clients">} placeholder="No specific site" value={siteId} onChange={setSiteId} /></Field>
            <Field label="Title" className="sm:col-span-2"><Input required value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="Introduction" className="sm:col-span-2"><Textarea value={introduction} onChange={(e) => setIntroduction(e.target.value)} /></Field>
            <Field label="Terms" hint="Leave blank to use your company's default quote terms." className="sm:col-span-2"><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
            <Field label="Valid until"><Input type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} /></Field>
          </div>
        </Card>
        <Card title="Lines"><LinesEditor withKinds lines={lines} onChange={setLines} /></Card>
        <ErrorBox message={error} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create draft quote"}</Button><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button></div>
      </form>
    </>
  );
}
export default function NewQuotePage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
