"use client";

import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { homeFor } from "@/lib/routing";
import { ROLE_LABEL } from "@/lib/labels";
import type { Id } from "@/lib/api";

export function OrgSwitcher() {
  const s = useSession();
  const router = useRouter();
  if (!s.current) return null;
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-slate-400">Organisation</label>
      <select
        className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-white focus:outline-none"
        value={s.current.orgId}
        onChange={(e) => {
          if (e.target.value === "__new") return router.push("/onboarding");
          const id = e.target.value as Id<"organizations">;
          s.setOrgId(id);
          const m = s.memberships.find((x) => x.orgId === id) ?? null;
          router.push(homeFor(m));
        }}
      >
        {s.memberships.map((m) => (
          <option key={m.membershipId} value={m.orgId}>{m.orgName ?? "Organisation"} · {ROLE_LABEL[m.role]}</option>
        ))}
        <option value="__new">+ Create a new company…</option>
      </select>
    </div>
  );
}
