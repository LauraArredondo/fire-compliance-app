"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Loading, PageHeader } from "@/components/ui";
import { ScheduleForm } from "@/components/forms/ScheduleForm";

function Inner() {
  const siteId = useSearchParams().get("siteId") ?? undefined;
  return (<><PageHeader title="New service schedule" back={{ href: siteId ? `/app/sites/${siteId}` : "/app/schedules", label: siteId ? "Site" : "Schedules" }} /><ScheduleForm defaultSiteId={siteId} /></>);
}
export default function NewSchedulePage() { return <Suspense fallback={<Loading />}><Inner /></Suspense>; }
