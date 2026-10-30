"use client";

import Link from "next/link";
import { useSafeQuery } from "@/lib/useSafeQuery";
import { api, type Id } from "@/lib/api";

/** Small reactive lookups for list rows (lists return ids, not names). */
export function ClientName({ id, link = true, base = "/app" }: { id: Id<"clients"> | null | undefined; link?: boolean; base?: string }) {
  const { data: c, error } = useSafeQuery(api.clients.get, id ? { clientId: id } : "skip");
  if (!id || error) return <>—</>;
  if (c === undefined) return <span className="text-slate-400">…</span>;
  return link ? <Link className="hover:underline" href={`${base}/clients/${id}`}>{c.name}</Link> : <>{c.name}</>;
}
export function SiteName({ id, link = true, base = "/app" }: { id: Id<"sites"> | null | undefined; link?: boolean; base?: string }) {
  const { data: s, error } = useSafeQuery(api.sites.get, id ? { siteId: id } : "skip");
  if (!id || error) return <>—</>;
  if (s === undefined) return <span className="text-slate-400">…</span>;
  return link ? <Link className="hover:underline" href={`${base}/sites/${id}`}>{s.name}</Link> : <>{s.name}</>;
}
