"use client";

import { PageHeader } from "@/components/ui";
import { ClientForm } from "@/components/forms/ClientForm";

export default function NewClientPage() {
  return (<><PageHeader title="New client" back={{ href: "/app/clients", label: "Clients" }} /><ClientForm /></>);
}
