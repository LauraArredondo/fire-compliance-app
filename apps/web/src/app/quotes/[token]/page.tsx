"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { date, dateTime, money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, Notice, StatusBadge, Textarea } from "@/components/ui";
import { LinesTable, Totals } from "@/components/LinesEditor";
import { SignaturePad, uploadBlob } from "@/components/SignaturePad";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Logo } from "@/components/Logo";

/** Public, unauthenticated quote view/accept/decline page (link from the quote email). */
export default function PublicQuotePage() {
  const { token } = useParams<{ token: string }>();
  const q = useQuery(api.quotes.getByToken, { token });
  const markViewed = useMutation(api.quotes.markViewed);
  useEffect(() => { if (q?.status === "sent") void markViewed({ token }).catch(() => {}); }, [q?.status, token, markViewed]);

  if (q === undefined) return <Wrap><Loading /></Wrap>;
  if (q === null) return <Wrap><Card><p className="text-sm">This quote link is not valid. Please contact the company that sent it.</p></Card></Wrap>;
  return (
    <Wrap>
      <div className="mb-6 flex items-center gap-4">
        {q.company.logoUrl && <img src={q.company.logoUrl} alt="" className="h-12 w-auto" />}
        <div>
          <div className="text-lg font-semibold">{q.company.name}</div>
          <div className="text-sm text-fg-muted">{[q.company.email, q.company.phone].filter(Boolean).join(" · ")}</div>
        </div>
      </div>
      <Card title={<span className="flex flex-wrap items-center gap-3">Quote {q.quoteNumber}{q.revision > 1 ? ` (rev ${q.revision})` : ""} <StatusBadge status={q.status} /></span>}>
        <div className="mb-4 text-sm">
          <div className="text-base font-medium">{q.title}</div>
          <div className="text-fg-muted">For {q.clientName}{q.siteName ? ` · ${q.siteName}` : ""}{q.validUntil ? ` · Valid until ${date(q.validUntil)}` : ""}</div>
          {q.introduction && <p className="mt-3 whitespace-pre-line">{q.introduction}</p>}
        </div>
        <LinesTable lines={q.lines} currency={q.currency} />
        <Totals rows={[["Subtotal", money(q.subtotal, q.currency)], ...(q.discountTotal ? [["Discount", `−${money(q.discountTotal, q.currency)}`] as [string, string]] : []), ["VAT", money(q.taxTotal, q.currency)], ["Total", money(q.total, q.currency), true]]} />
        {q.terms && <div className="mt-6 border-t border-line pt-4 text-xs whitespace-pre-line text-fg-2"><div className="mb-1 font-medium">Terms</div>{q.terms}</div>}
      </Card>
      <div className="mt-6">
        {q.acceptance ? (
          <Notice tone={q.acceptance.decision === "accepted" ? "green" : "amber"}>
            This quote was {q.acceptance.decision}{q.acceptance.signedByName ? ` by ${q.acceptance.signedByName}` : ""} on {dateTime(q.acceptance.decidedAt)}.
          </Notice>
        ) : q.canRespond ? <Respond token={token} lines={q.lines} currency={q.currency} /> : <Notice>This quote is {q.status} and can no longer be accepted. Please contact {q.company.name} for an updated quote.</Notice>}
      </div>
    </Wrap>
  );
}

function Wrap({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative mx-auto min-h-screen max-w-3xl px-4 py-10">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="mb-8"><Logo /></div>
      {children}
    </main>
  );
}

type Line = { id: Id<"quoteLineItems">; description: string; optional: boolean; selected: boolean; lineTotal: number };

function Respond({ token, lines, currency }: { token: string; lines: Line[]; currency: string }) {
  const respond = useMutation(api.quotes.respond);
  const uploadUrl = useMutation(api.quotes.generateSignatureUploadUrl);
  const optional = useMemo(() => lines.filter((l) => l.optional), [lines]);
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(optional.filter((l) => l.selected).map((l) => l.id)));
  const [mode, setMode] = useState<"accept" | "decline" | null>(null);
  const [name, setName] = useState(""); const [role, setRole] = useState(""); const [po, setPo] = useState(""); const [reason, setReason] = useState("");
  const [sig, setSig] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      if (mode === "accept") {
        let signatureImageId: Id<"_storage"> | undefined;
        if (sig) signatureImageId = (await uploadBlob(await uploadUrl({ token }), sig)) as Id<"_storage">;
        await respond({ token, decision: "accepted", signedByName: name, signedByRole: role || undefined, purchaseOrderNumber: po || undefined, signatureImageId, selectedOptionalLineIds: [...chosen] as Id<"quoteLineItems">[], userAgent: navigator.userAgent.slice(0, 300) });
      } else {
        await respond({ token, decision: "declined", declineReason: reason || undefined, userAgent: navigator.userAgent.slice(0, 300) });
      }
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  }

  if (!mode) return (
    <Card title="Your response">
      <div className="flex gap-3"><Button onClick={() => setMode("accept")}>Accept quote</Button><Button variant="secondary" onClick={() => setMode("decline")}>Decline</Button></div>
    </Card>
  );
  return (
    <Card title={mode === "accept" ? "Accept quote" : "Decline quote"}>
      <form onSubmit={submit} className="space-y-4">
        {mode === "accept" ? (
          <>
            {optional.length > 0 && (
              <Field label="Optional items to include">
                <div className="space-y-1">{optional.map((l) => (
                  <Checkbox key={l.id} label={`${l.description} (${money(l.lineTotal, currency)})`} checked={chosen.has(l.id)} onChange={(v) => setChosen((s) => { const n = new Set(s); if (v) n.add(l.id); else n.delete(l.id); return n; })} />
                ))}</div>
              </Field>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Your name"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
              <Field label="Position (optional)"><Input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
              <Field label="Purchase order number (optional)"><Input value={po} onChange={(e) => setPo(e.target.value)} /></Field>
            </div>
            <Field label="Signature"><SignaturePad onChange={setSig} /></Field>
            <p className="text-xs text-fg-muted">By accepting you agree to the quote and its terms. Totals are recalculated for the optional items you select.</p>
          </>
        ) : (
          <Field label="Reason (optional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        )}
        <ErrorBox message={err} />
        <div className="flex gap-3">
          <Button type="submit" disabled={busy}>{busy ? "Submitting…" : mode === "accept" ? "Accept and sign" : "Decline quote"}</Button>
          <Button type="button" variant="secondary" onClick={() => setMode(null)}>Back</Button>
        </div>
      </form>
    </Card>
  );
}
