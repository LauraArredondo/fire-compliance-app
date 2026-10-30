"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api, type Doc } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { errorMessage } from "@/lib/errors";
import { CLIENT_TYPES } from "@/lib/labels";
import { opt } from "@/lib/format";
import { Button, Card, ErrorBox, Field, Input, Select, Textarea } from "@/components/ui";
import { AddressFields, addressArg, addressFrom, ContactFields, contactArg, contactFrom } from "./AddressFields";

type ClientType = (typeof CLIENT_TYPES)[number];

export function ClientForm({ client }: { client?: Doc<"clients"> }) {
  const { orgId } = useOrg();
  const router = useRouter();
  const create = useMutation(api.clients.create);
  const update = useMutation(api.clients.update);
  const [name, setName] = useState(client?.name ?? "");
  const [type, setType] = useState<ClientType>(client?.type ?? "commercial");
  const [accountNumber, setAccountNumber] = useState(client?.accountNumber ?? "");
  const [addr, setAddr] = useState(addressFrom(client?.billingAddress));
  const [contact, setContact] = useState(contactFrom(client?.primaryContact));
  const [reminderEmails, setReminderEmails] = useState((client?.reminderEmails ?? []).join(", "));
  const [notes, setNotes] = useState(client?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null); setBusy(true);
    const args = {
      name: name.trim(), type, accountNumber: opt(accountNumber), billingAddress: addressArg(addr), primaryContact: contactArg(contact),
      reminderEmails: reminderEmails.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean), notes: opt(notes),
    };
    try {
      if (client) {
        await update({ clientId: client._id, ...args });
        router.push(`/app/clients/${client._id}`);
      } else {
        const id = await create({ orgId, ...args });
        router.push(`/app/clients/${id}`);
      }
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title="Client">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Client name" className="sm:col-span-2"><Input required value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Type"><Select options={CLIENT_TYPES} value={type} onChange={(e) => setType(e.target.value as ClientType)} /></Field>
          <Field label="Account number (optional)"><Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} /></Field>
        </div>
      </Card>
      <Card title="Billing address"><AddressFields value={addr} onChange={setAddr} /></Card>
      <Card title="Primary contact"><ContactFields value={contact} onChange={setContact} /></Card>
      <Card title="Reminders & notes">
        <div className="space-y-4">
          <Field label="Reminder emails" hint="Comma-separated. Service and certificate reminders go here (else the primary contact)."><Input value={reminderEmails} onChange={(e) => setReminderEmails(e.target.value)} /></Field>
          <Field label="Internal notes"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Card>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : client ? "Save changes" : "Create client"}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
