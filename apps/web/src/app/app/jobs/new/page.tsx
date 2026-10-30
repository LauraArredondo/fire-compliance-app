"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loading, PageHeader } from "@/components/ui";
import { JobForm } from "@/components/forms/JobForm";

function Inner() {
  const siteId = useSearchParams().get("siteId") ?? undefined;
  return (<><PageHeader title="New job" back={{ href: siteId ? `/app/sites/${siteId}` : "/app/jobs", label: siteId ? "Site" : "Jobs" }} /><JobForm defaultSiteId={siteId} /></>);
}
export default function NewJobPage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
