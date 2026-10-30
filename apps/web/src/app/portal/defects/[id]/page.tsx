"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import { disciplineLabel } from "@/lib/labels";
import { Card, DL, Loading, PageHeader, StatusBadge } from "@/components/ui";
import { SiteName } from "@/components/Refs";

export default function PortalDefect() {
  const { id } = useParams<{ id: Id<"defects"> }>();
  const d = useQuery(api.defects.get, { defectId: id });
  if (!d) return <Loading />;
  return (
    <>
      <PageHeader back={{ href: "/portal/defects", label: "Defects" }} title={<span className="flex flex-wrap items-center gap-3">{d.reference} · {d.title} <StatusBadge status={d.severity} /> <StatusBadge status={d.status} /></span>} subtitle={<SiteName id={d.siteId} base="/portal" />} />
      <Card>
        <DL items={[
          ["Discipline", disciplineLabel(d.discipline)],
          ["Description", d.description],
          ["Recommended action", d.recommendedAction],
          ["Raised", dateTime(d.raisedAt)],
          ["Target resolution", d.targetResolutionAt ? date(d.targetResolutionAt) : null],
          ["Resolved", d.resolvedAt ? dateTime(d.resolvedAt) : null],
          ["Resolution notes", d.resolutionNotes],
        ]} />
        {d.photoUrls.filter(Boolean).length > 0 && <div className="mt-4 flex flex-wrap gap-2">{d.photoUrls.filter(Boolean).map((u) => <img key={u!} src={u!} alt="Defect photo" className="h-28 w-28 rounded object-cover" />)}</div>}
      </Card>
    </>
  );
}
