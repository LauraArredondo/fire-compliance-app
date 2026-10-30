"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation } from "convex/react";
import { api, type Id } from "@/lib/api";
import { opt } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Textarea } from "@/components/ui";
import { ClientSelect, SiteSelect } from "@/components/Pickers";
import { LinesEditor, blankLine, toLineArgs, type LineDraft } from "@/components/LinesEditor";

function Inner() {
  const sp = useSearchParams();
  const router = useRouter();
  const create = useMutation(api.invoices.create);
  const [clientId, setClientId] = useState<string>(sp.get("clientId") ?? "");
  const [siteId, setSiteId] = useState("");
  const [terms, setTerms] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null); setBusy(true);
    try {
      const id = await create({ clientId: clientId as Id<"clients">, siteId: (siteId || undefined) as Id<"sites"> | undefined, paymentTermsDays: terms ? Number(terms) : undefined, notes: opt(notes), lines: lines.filter((l) => l.description.trim()).map(toLineArgs) });
      router.push(`/app/invoices/${id}`);
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }
  return (
    <>
      <PageHeader title="New invoice" back={{ href: "/app/invoices", label: "Invoices" }} />
      <form onSubmit={submit} className="space-y-6">
        <Card title="Invoice">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Client"><ClientSelect required value={clientId} onChange={(v) => { setClientId(v); setSiteId(""); }} /></Field>
            <Field label="Site (optional)"><SiteSelect clientId={clientId as Id<"clients">} placeholder="No specific site" value={siteId} onChange={setSiteId} /></Field>
            <Field label="Payment terms (days)" hint="Blank = company default."><Input inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
            <Field label="Notes" className="sm:col-span-2"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          </div>
        </Card>
        <Card title="Lines"><LinesEditor lines={lines} onChange={setLines} /></Card>
        <ErrorBox message={error} />
        <div className="flex gap-2"><Button type="submit" disabled={busy}>{busy ? "Saving…" : "Create draft invoice"}</Button><Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button></div>
      </form>
    </>
  );
}
export default function NewInvoicePage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
