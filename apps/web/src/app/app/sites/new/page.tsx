"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loading, PageHeader } from "@/components/ui";
import { SiteForm } from "@/components/forms/SiteForm";

function Inner() {
  const clientId = useSearchParams().get("clientId") ?? undefined;
  return (<><PageHeader title="New site" back={clientId ? { href: `/app/clients/${clientId}`, label: "Client" } : { href: "/app/sites", label: "Sites" }} /><SiteForm defaultClientId={clientId} /></>);
}
export default function NewSitePage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
