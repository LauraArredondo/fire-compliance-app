"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { errorMessage } from "@/lib/errors";
import { opt } from "@/lib/format";
import { Button, Card, ErrorBox, Field, Input, Textarea } from "@/components/ui";
import { ClientSelect } from "@/components/Pickers";
import { AddressFields, addressArg, addressFrom, ContactFields, contactArg, contactFrom } from "./AddressFields";

export function SiteForm({ site, defaultClientId }: { site?: Doc<"sites">; defaultClientId?: string }) {
  const { orgId, role } = useOrg();
  const engineer = role === "engineer";
  const router = useRouter();
  const create = useMutation(api.sites.create);
  const update = useMutation(api.sites.update);
  const [clientId, setClientId] = useState<string>(site?.clientId ?? defaultClientId ?? "");
  const [name, setName] = useState(site?.name ?? "");
  const [reference, setReference] = useState(site?.reference ?? "");
  const [addr, setAddr] = useState(addressFrom(site?.address));
  const [siteContact, setSiteContact] = useState(contactFrom(site?.siteContact));
  const [responsible, setResponsible] = useState(contactFrom(site?.responsiblePerson));
  const [accessNotes, setAccessNotes] = useState(site?.accessNotes ?? "");
  const [hazards, setHazards] = useState((site?.hazards ?? []).join("\n"));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const address = addressArg(addr);
    if (!address && !engineer) return setError("Address line 1 is required.");
    setBusy(true);
    const common = {
      siteContact: contactArg(siteContact), responsiblePerson: contactArg(responsible), accessNotes: opt(accessNotes),
      hazards: hazards.split("\n").map((h) => h.trim()).filter(Boolean),
    };
    try {
      if (site) {
        await update({ siteId: site._id, ...common, ...(engineer ? {} : { name: name.trim(), reference: opt(reference), address }) });
        router.push(`/app/sites/${site._id}`);
      } else {
        if (!clientId) throw new Error("Choose a client");
        const id = await create({ orgId, clientId: clientId as Id<"clients">, name: name.trim(), reference: opt(reference), address: address!, ...common });
        router.push(`/app/sites/${id}`);
      }
    } catch (err) { setError(errorMessage(err)); setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="space-y-6">
      <Card title="Site">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {!site && <Field label="Client" className="sm:col-span-2"><ClientSelect required value={clientId} onChange={setClientId} /></Field>}
          <Field label="Site name"><Input required disabled={engineer} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Head office" /></Field>
          <Field label="Site reference (optional)"><Input disabled={engineer} value={reference} onChange={(e) => setReference(e.target.value)} /></Field>
        </div>
        {engineer && <p className="mt-2 text-xs text-slate-500">Engineers can update contacts, access notes and hazards; the office manages name and address.</p>}
      </Card>
      {!engineer && <Card title="Address"><AddressFields required value={addr} onChange={setAddr} /></Card>}
      <Card title="Site contact"><ContactFields value={siteContact} onChange={setSiteContact} /></Card>
      <Card title="Responsible person (Fire Safety Order)"><ContactFields value={responsible} onChange={setResponsible} /></Card>
      <Card title="Access & hazards">
        <div className="space-y-4">
          <Field label="Access notes"><Textarea value={accessNotes} onChange={(e) => setAccessNotes(e.target.value)} placeholder="Keys, parking, alarm codes kept by…" /></Field>
          <Field label="Hazards" hint="One per line."><Textarea value={hazards} onChange={(e) => setHazards(e.target.value)} /></Field>
        </div>
      </Card>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy}>{busy ? "Saving…" : site ? "Save changes" : "Create site"}</Button>
        <Button type="button" variant="secondary" onClick={() => router.back()}>Cancel</Button>
      </div>
    </form>
  );
}
