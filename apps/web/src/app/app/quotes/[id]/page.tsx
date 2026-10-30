"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { date, dateTime, fromDateInput, money, opt, toDateInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Button, Card, DL, ErrorBox, Field, Input, Loading, Notice, PageHeader, StatusBadge, Textarea } from "@/components/ui";
import { LinesEditor, LinesTable, Totals, blankLine, toLineArgs, type LineDraft } from "@/components/LinesEditor";
import { PdfButton } from "@/components/PdfButton";
import { CopyLink } from "@/components/CopyLink";
import { ClientName, SiteName } from "@/components/Refs";

export default function QuotePage() {
  const { id } = useParams<{ id: Id<"quotes"> }>();
  const router = useRouter();
  const q = useQuery(api.quotes.get, { quoteId: id });
  const pdf = useQuery(api.quotes.getPdf, q && q.status !== "draft" ? { quoteId: id } : "skip");
  const regen = useMutation(api.quotes.regeneratePdf);
  const revise = useMutation(api.quotes.revise);
  const remove = useMutation(api.quotes.remove);
  const convert = useMutation(api.quotes.convertToJob);
  const invoice = useMutation(api.invoices.createFromQuote);
  const removeLine = useMutation(api.quotes.removeLine);
  const addLine = useMutation(api.quotes.addLine);
  const [error, setError] = useState<string | null>(null);
  const [newLines, setNewLines] = useState<LineDraft[]>([]);
  const [editing, setEditing] = useState(false);

  if (!q) return <Loading />;
  const draft = q.status === "draft";
  const open = q.status === "sent" || q.status === "viewed";
  const token = "acceptanceToken" in q ? (q.acceptanceToken as string | undefined) : undefined;
  const link = token && typeof window !== "undefined" ? `${window.location.origin}/quotes/${token}` : null;

  return (
    <>
      <PageHeader
        back={{ href: "/app/quotes", label: "Quotes" }}
        title={<span className="flex flex-wrap items-center gap-3">{q.quoteNumber}{q.revision > 1 ? ` rev ${q.revision}` : ""} · {q.title} <StatusBadge status={q.status} /></span>}
        subtitle={<><ClientName id={q.clientId} />{q.siteId && <> · <SiteName id={q.siteId} /></>}</>}
        actions={
          <>
            {!draft && <PdfButton pdf={pdf} onRegenerate={() => void regen({ quoteId: id }).catch((e) => setError(errorMessage(e)))} />}
            {draft && <Button variant="secondary" onClick={() => setEditing((v) => !v)}>{editing ? "Close" : "Edit details"}</Button>}
            {(open || q.status === "declined" || q.status === "expired") && <ActionButton onError={setError} action={async () => { const r = await revise({ quoteId: id }); router.push(`/app/quotes/${r}`); }}>Revise</ActionButton>}
            {q.status === "accepted" && <ActionButton variant="primary" onError={setError} action={async () => { const r = await convert({ quoteId: id }); router.push(`/app/jobs/${r}`); }}>Convert to job</ActionButton>}
            {q.status === "accepted" && <ActionButton onError={setError} action={async () => { const r = await invoice({ quoteId: id }); router.push(`/app/invoices/${r}`); }}>Create invoice</ActionButton>}
            {draft && <ActionButton variant="danger" confirm="Delete this draft quote?" onError={setError} action={async () => { await remove({ quoteId: id }); router.push("/app/quotes"); }}>Delete</ActionButton>}
          </>
        }
      />
      <ErrorBox message={error} />
      {editing && <EditQuote q={q} onDone={() => setEditing(false)} />}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2">
          {draft ? (
            <div className="space-y-1">
              {q.lines.map((l) => (
                <div key={l._id} className="flex items-center justify-between gap-3 border-b border-line-subtle py-2 text-sm">
                  <span className="min-w-0 flex-1">{l.description}{l.optional && <span className="ml-1 text-xs text-fg-muted">(optional)</span>} <span className="text-xs text-fg-muted">× {l.quantity} @ {money(l.unitPrice, q.currency)}{l.discountPercent ? ` −${l.discountPercent}%` : ""} · VAT {l.taxRate}%</span></span>
                  <span className="tabular-nums">{money(l.lineTotal, q.currency)}</span>
                  <ActionButton variant="ghost" onError={setError} action={() => removeLine({ lineId: l._id })}>✕</ActionButton>
                </div>
              ))}
              {!q.lines.length && <p className="text-sm text-fg-muted">No lines yet.</p>}
              <div className="pt-3">
                {newLines.length > 0 ? (
                  <div className="space-y-2 rounded-md bg-subtle p-3">
                    <LinesEditor withKinds lines={newLines} onChange={setNewLines} />
                    <ActionButton variant="primary" onError={setError} action={async () => {
                      for (const l of newLines.filter((x) => x.description.trim())) await addLine({ quoteId: id, ...toLineArgs(l), kind: l.kind as never, optional: l.optional || undefined });
                      setNewLines([]);
                    }}>Save new lines</ActionButton>
                  </div>
                ) : <Button variant="secondary" onClick={() => setNewLines([blankLine()])}>Add lines</Button>}
              </div>
            </div>
          ) : <LinesTable lines={q.lines} currency={q.currency} />}
          <Totals rows={[["Subtotal", money(q.subtotal, q.currency)], ...(q.discountTotal ? [["Discounts", `−${money(q.discountTotal, q.currency)}`] as [string, string]] : []), ["VAT", money(q.taxTotal, q.currency)], ["Total", money(q.total, q.currency), true]]} />
        </Card>
        <div className="space-y-6">
          <Card title="Details">
            <DL items={[
              ["Valid until", date(q.validUntil)],
              ["Sent", q.sentAt ? dateTime(q.sentAt) : null],
              ["Viewed", q.viewedAt ? dateTime(q.viewedAt) : null],
              ["Decision", q.acceptance ? `${q.acceptance.decision} ${dateTime(q.acceptance.decidedAt)}` : null],
              ["Signed by", q.acceptance?.signature?.signedByName],
              ["Client PO", q.acceptance?.purchaseOrderNumber],
              ["Decline reason", q.acceptance?.declineReason],
            ]} />
          </Card>
          {(draft || open) && <SendCard quoteId={id} validUntil={q.validUntil} resend={!draft} />}
          {link && (open || q.status === "accepted" || q.status === "declined") && <Card title="Client link"><CopyLink url={link} /><p className="mt-2 text-xs text-fg-muted">The client can view, accept or decline here without logging in.</p></Card>}
        </div>
      </div>
      {(q.introduction || q.terms) && (
        <Card title="Introduction & terms" className="mt-6">
          {q.introduction && <p className="mb-3 whitespace-pre-wrap text-sm">{q.introduction}</p>}
          {q.terms && <p className="whitespace-pre-wrap text-xs text-fg-2">{q.terms}</p>}
        </Card>
      )}
    </>
  );
}

function SendCard({ quoteId, validUntil, resend }: { quoteId: Id<"quotes">; validUntil?: number; resend: boolean }) {
  const send = useMutation(api.quotes.send);
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [valid, setValid] = useState(toDateInput(validUntil));
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  return (
    <Card title={resend ? "Resend quote" : "Send quote"}>
      <div className="space-y-2">
        <Field label="To" hint="Blank = client's reminder email or primary contact."><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Message (optional)"><Textarea value={message} onChange={(e) => setMessage(e.target.value)} /></Field>
        <Field label="Valid until"><Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
        <ErrorBox message={error} />
        <ActionButton variant="primary" onError={setError} action={async () => { await send({ quoteId, to: opt(to), message: opt(message), validUntil: fromDateInput(valid) }); setSent(true); }}>{resend ? "Resend" : "Send to client"}</ActionButton>
        {sent && <Notice tone="green">Sent. Email delivery is in dry-run mode until email is configured — share the client link below if needed.</Notice>}
      </div>
    </Card>
  );
}

function EditQuote({ q, onDone }: { q: { _id: Id<"quotes">; title: string; introduction?: string; terms?: string; validUntil?: number }; onDone: () => void }) {
  const update = useMutation(api.quotes.update);
  const [title, setTitle] = useState(q.title);
  const [introduction, setIntroduction] = useState(q.introduction ?? "");
  const [terms, setTerms] = useState(q.terms ?? "");
  const [valid, setValid] = useState(toDateInput(q.validUntil));
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Edit quote" className="mb-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Valid until"><Input type="date" value={valid} onChange={(e) => setValid(e.target.value)} /></Field>
        <Field label="Introduction" className="sm:col-span-2"><Textarea value={introduction} onChange={(e) => setIntroduction(e.target.value)} /></Field>
        <Field label="Terms" className="sm:col-span-2"><Textarea value={terms} onChange={(e) => setTerms(e.target.value)} /></Field>
      </div>
      <ErrorBox message={error} />
      <div className="mt-3"><ActionButton variant="primary" onError={setError} action={async () => { await update({ quoteId: q._id, title, introduction: opt(introduction), terms: opt(terms), validUntil: fromDateInput(valid) }); onDone(); }}>Save</ActionButton></div>
    </Card>
  );
}
