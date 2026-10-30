"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { Loading, PageHeader } from "@/components/ui";
import { ClientForm } from "@/components/forms/ClientForm";

export default function EditClientPage() {
  const { id } = useParams<{ id: Id<"clients"> }>();
  const client = useQuery(api.clients.get, { clientId: id });
  if (!client) return <Loading />;
  return (<><PageHeader title={`Edit ${client.name}`} back={{ href: `/app/clients/${id}`, label: client.name }} /><ClientForm client={client as Doc<"clients">} /></>);
}
