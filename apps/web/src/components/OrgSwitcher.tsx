"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { homeFor } from "@/lib/routing";
import { ROLE_LABEL } from "@/lib/labels";
import type { Id } from "@/lib/api";

function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

export function OrgSwitcher() {
  const s = useSession();
  const router = useRouter();
  if (!s.current) return null;
  const label = s.current.orgName ?? "Organisation";
  return (
    <label className="flex items-center gap-2.5 rounded-lg border border-line-subtle bg-subtle px-2.5 py-2">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-fire text-xs font-semibold text-ash-0" aria-hidden>
        {initials(label)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="sr-only">Organisation</span>
        <select
          className="w-full truncate bg-transparent text-sm font-medium text-fg focus-visible:outline-none"
          value={s.current.orgId}
          aria-label="Organisation"
          onChange={(e) => {
            if (e.target.value === "__new") return router.push("/onboarding");
            const id = e.target.value as Id<"organizations">;
            s.setOrgId(id);
            const m = s.memberships.find((x) => x.orgId === id) ?? null;
            router.push(homeFor(m));
          }}
        >
          {s.memberships.map((m) => (
            <option key={m.membershipId} value={m.orgId}>{m.orgName ?? "Organisation"}</option>
          ))}
          <option value="__new">+ Create a new company…</option>
        </select>
        <span className="block truncate text-xs text-fg-muted">{ROLE_LABEL[s.current.role]}</span>
      </span>
    </label>
  );
}
