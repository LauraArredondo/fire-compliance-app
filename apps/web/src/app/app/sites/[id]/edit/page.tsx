"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Doc, type Id } from "@/lib/api";
import { Loading, PageHeader } from "@/components/ui";
import { SiteForm } from "@/components/forms/SiteForm";

export default function EditSitePage() {
  const { id } = useParams<{ id: Id<"sites"> }>();
  const site = useQuery(api.sites.get, { siteId: id });
  if (!site) return <Loading />;
  return (<><PageHeader title={`Edit ${site.name}`} back={{ href: `/app/sites/${id}`, label: site.name }} /><SiteForm site={site as Doc<"sites">} /></>);
}
