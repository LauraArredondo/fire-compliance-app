"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { PAYMENT_METHODS, humanize } from "@/lib/labels";
import { date, fromDateInput, money, opt, toDateInput, toMinor } from "@/lib/format";
import { ActionButton, Button, Card, DL, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, StatusBadge, Table } from "@/components/ui";
import { LinesEditor, LinesTable, Totals, toLineArgs, type LineDraft } from "@/components/LinesEditor";
import { PdfButton } from "@/components/PdfButton";
import { OverdueBadge } from "@/components/OverdueBadge";
import { ClientName, SiteName } from "@/components/Refs";
import { errorMessage } from "@/lib/errors";

type Method = (typeof PAYMENT_METHODS)[number];

export default function InvoicePage() {
  const { id } = useParams<{ id: Id<"invoices"> }>();
  const inv = useQuery(api.invoices.get, { invoiceId: id });
  const pdf = useQuery(api.invoices.getPdf, inv && inv.status !== "draft" ? { invoiceId: id } : "skip");
  const regen = useMutation(api.invoices.regeneratePdf);
  const send = useMutation(api.invoices.send);
  const voidInvoice = useMutation(api.invoices.voidInvoice);
  const update = useMutation(api.invoices.update);
  const [error, setError] = useState<string | null>(null);
  const [editLines, setEditLines] = useState<LineDraft[] | null>(null);
  const [to, setTo] = useState("");
  const [sent, setSent] = useState(false);

  if (!inv) return <Loading />;
  const draft = inv.status === "draft";
  const payable = ["sent", "partially_paid", "overdue"].includes(inv.status);
  const lines = inv.lines ?? [];
  return (
    <>
      <PageHeader
        back={{ href: "/app/invoices", label: "Invoices" }}
        title={<span className="flex flex-wrap items-center gap-3">{inv.invoiceNumber} <StatusBadge status={inv.status} /><OverdueBadge inv={inv} /></span>}
        subtitle={<><ClientName id={inv.clientId} />{inv.siteId && <> · <SiteName id={inv.siteId} /></>}</>}
        actions={
          <>
            {!draft && <PdfButton pdf={pdf} onRegenerate={() => void regen({ invoiceId: id }).catch((e) => setError(errorMessage(e)))} />}
            {draft && !editLines && <Button variant="secondary" onClick={() => setEditLines(lines.map((l) => ({ kind: "other", description: l.description, quantity: String(l.quantity), unitPrice: (l.unitPrice / 100).toFixed(2), discountPercent: l.discountPercent ? String(l.discountPercent) : "", taxRate: String(l.taxRate), optional: false })))}>Edit lines</Button>}
            {inv.status !== "void" && inv.status !== "paid" && <ActionButton variant="danger" onError={setError} action={async () => { const reason = window.prompt("Reason for voiding this invoice?"); if (reason) await voidInvoice({ invoiceId: id, reason }); }}>Void</ActionButton>}
          </>
        }
      />
      <ErrorBox message={error} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Lines" className="lg:col-span-2">
          {editLines ? (
            <div className="space-y-3">
              <LinesEditor lines={editLines} onChange={setEditLines} />
              <div className="flex gap-2">
                <ActionButton variant="primary" onError={setError} action={async () => { await update({ invoiceId: id, lines: editLines.filter((l) => l.description.trim()).map(toLineArgs) }); setEditLines(null); }}>Save lines</ActionButton>
                <Button variant="secondary" onClick={() => setEditLines(null)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <LinesTable lines={lines} currency={inv.currency} />
              <Totals rows={[["Subtotal", money(inv.subtotal, inv.currency)], ["VAT", money(inv.taxTotal, inv.currency)], ["Total", money(inv.total, inv.currency), true], ["Paid", money(inv.amountPaid, inv.currency)], ["Balance due", money(inv.balance, inv.currency), true]]} />
            </>
          )}
        </Card>
        <div className="space-y-6">
          <Card title="Details">
            <DL items={[
              ["Issued", inv.issuedAt ? date(inv.issuedAt) : null],
              ["Due", inv.dueAt ? date(inv.dueAt) : null],
              ["Payment terms", inv.paymentTermsDays ? `${inv.paymentTermsDays} days` : null],
              ["Paid", inv.paidAt ? date(inv.paidAt) : null],
              ["Job", inv.jobId ? <a key="j" className="text-red-700 hover:underline" href={`/app/jobs/${inv.jobId}`}>View job</a> : null],
              ["Quote", inv.quoteId ? <a key="q" className="text-red-700 hover:underline" href={`/app/quotes/${inv.quoteId}`}>View quote</a> : null],
              ["Notes", inv.notes],
            ]} />
          </Card>
          {(draft || payable) && (
            <Card title={draft ? "Send invoice" : "Resend invoice"}>
              <div className="space-y-2">
                <Field label="To" hint="Blank = client's reminder email or primary contact."><Input type="email" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
                <ActionButton variant="primary" onError={setError} action={async () => { await send({ invoiceId: id, to: opt(to) }); setSent(true); }}>{draft ? "Send to client" : "Resend"}</ActionButton>
                {sent && <Notice tone="green">Sent (email is in dry-run mode until configured). The PDF is generating.</Notice>}
              </div>
            </Card>
          )}
          {payable && <PaymentCard invoiceId={id} balance={inv.balance} />}
        </div>
      </div>
      {(inv.payments?.length ?? 0) > 0 && (
        <Card title="Payments" className="mt-6">
          <Table rows={(inv.payments ?? []).map((p, i) => ({ ...p, _id: String(i) }))} columns={[
            { header: "Date", cell: (p) => date(p.paidAt) },
            { header: "Amount", cell: (p) => money(p.amount, inv.currency) },
            { header: "Method", cell: (p) => humanize(p.method) },
            { header: "Reference", cell: (p) => p.reference ?? "—" },
          ]} />
        </Card>
      )}
    </>
  );
}

function PaymentCard({ invoiceId, balance }: { invoiceId: Id<"invoices">; balance: number }) {
  const record = useMutation(api.invoices.recordPayment);
  const [amount, setAmount] = useState((balance / 100).toFixed(2));
  const [paidAt, setPaidAt] = useState(toDateInput(Date.now()));
  const [method, setMethod] = useState<Method>("bank_transfer");
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Card title="Record payment">
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Amount £"><Input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} /></Field>
        </div>
        <Field label="Method"><Select options={PAYMENT_METHODS} value={method} onChange={(e) => setMethod(e.target.value as Method)} /></Field>
        <Field label="Reference"><Input value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        <ErrorBox message={error} />
        <ActionButton onError={setError} action={() => record({ invoiceId, amount: toMinor(amount), paidAt: fromDateInput(paidAt), method, reference: opt(reference) })}>Record payment</ActionButton>
      </div>
    </Card>
  );
}
