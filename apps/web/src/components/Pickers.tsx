"use client";

import { useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { Select } from "./ui";

const big = { numItems: 200, cursor: null };

export function ClientSelect({ value, onChange, required }: { value: string; onChange: (id: Id<"clients"> | "") => void; required?: boolean }) {
  const { orgId } = useOrg();
  const r = useQuery(api.clients.list, { orgId, paginationOpts: big });
  return <Select required={required} placeholder={r ? "Select a client…" : "Loading…"} value={value} onChange={(e) => onChange(e.target.value as Id<"clients">)} options={(r?.page ?? []).map((c) => ({ value: c._id, label: c.name }))} />;
}

export function SiteSelect({ value, onChange, clientId, required, placeholder = "Select a site…" }: { value: string; onChange: (id: Id<"sites"> | "") => void; clientId?: Id<"clients"> | ""; required?: boolean; placeholder?: string }) {
  const { orgId } = useOrg();
  const r = useQuery(api.sites.list, { orgId, clientId: clientId || undefined, paginationOpts: big });
  // For engineers the backend already returns only the sites of their own jobs.
  return <Select required={required} placeholder={r ? placeholder : "Loading…"} value={value} onChange={(e) => onChange(e.target.value as Id<"sites">)} options={(r?.page ?? []).filter((s) => s.status === "active").map((s) => ({ value: s._id, label: s.name }))} />;
}

export function useEngineers() {
  const { orgId } = useOrg();
  return useQuery(api.team.listEngineers, { orgId });
}

export function EngineerSelect({ value, onChange, placeholder = "Not set" }: { value: string; onChange: (id: Id<"users"> | "") => void; placeholder?: string }) {
  const eng = useEngineers();
  return <Select placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value as Id<"users">)} options={(eng ?? []).map((u) => ({ value: u.userId, label: `${u.name} (${u.role})` }))} />;
}

/** Multi-select engineers as checkboxes. */
export function EngineerChecklist({ value, onChange }: { value: Id<"users">[]; onChange: (ids: Id<"users">[]) => void }) {
  const eng = useEngineers();
  if (!eng) return <div className="text-sm text-slate-500">Loading…</div>;
  if (!eng.length) return <div className="text-sm text-slate-500">No team members yet.</div>;
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">
      {eng.map((u) => (
        <label key={u.userId} className="inline-flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4" checked={value.includes(u.userId)} onChange={(e) => onChange(e.target.checked ? [...value, u.userId] : value.filter((x) => x !== u.userId))} />
          {u.name} <span className="text-xs text-slate-500">({u.role})</span>
        </label>
      ))}
    </div>
  );
}
