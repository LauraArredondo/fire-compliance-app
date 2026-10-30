"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";

/** Small reactive lookups for list rows (lists return ids, not names). */
export function ClientName({ id, link = true, base = "/app" }: { id: Id<"clients"> | null | undefined; link?: boolean; base?: string }) {
  const c = useQuery(api.clients.get, id ? { clientId: id } : "skip");
  if (!id) return <>—</>;
  if (c === undefined) return <span className="text-slate-400">…</span>;
  return link ? <Link className="hover:underline" href={`${base}/clients/${id}`}>{c.name}</Link> : <>{c.name}</>;
}
export function SiteName({ id, link = true, base = "/app" }: { id: Id<"sites"> | null | undefined; link?: boolean; base?: string }) {
  const s = useQuery(api.sites.get, id ? { siteId: id } : "skip");
  if (!id) return <>—</>;
  if (s === undefined) return <span className="text-slate-400">…</span>;
  return link ? <Link className="hover:underline" href={`${base}/sites/${id}`}>{s.name}</Link> : <>{s.name}</>;
}
