"use client";

import { useMemo } from "react";
import { useQuery } from "convex/react";
import { can, canAccessWebPath, scopeFor, sectionsFor, type Permission, type Role, type ScopedArea } from "@fire/shared";
import { api, type Id } from "./api";
import { useOrg } from "./session";

/**
 * Web-side role access. The role → permission map itself lives in packages/shared
 * (also used by the mobile app); this file adds the React hooks the web pages use.
 *
 * UI hiding is a convenience, not security: the Convex backend checks roles on every call.
 */
export { can, canAccessWebPath, scopeFor, sectionsFor };
export type { Permission, Role };

/** Query-string flag the staff shell adds when it bounces a user off a page their role can't open. */
export const DENIED_PARAM = "denied";

export function usePermissions() {
  const { role } = useOrg();
  return useMemo(
    () => ({
      role,
      can: (p: Permission) => can(role, p),
      scope: (area: ScopedArea) => scopeFor(role, area),
      assignedOnly: scopeFor(role, "jobs") === "assigned",
    }),
    [role],
  );
}

const DAY = 864e5;

/**
 * For roles that only see their own work (engineers): the jobs assigned to them and the
 * sites those jobs are at. `ready` is false while loading. For other roles everything is allowed.
 */
export function useAssignedScope() {
  const { orgId, role } = useOrg();
  const assignedOnly = scopeFor(role, "jobs") === "assigned";
  // Wide window so recent and upcoming work is covered (the backend default is -7 / +30 days).
  const [from, to] = useMemo(() => {
    const now = Date.now();
    return [now - 180 * DAY, now + 365 * DAY];
  }, []);
  const jobs = useQuery(api.jobs.myJobs, assignedOnly ? { orgId, from, to } : "skip");
  return useMemo(() => {
    const jobIds = new Set<string>((jobs ?? []).map((j) => j._id));
    const siteIds = new Set<string>((jobs ?? []).map((j) => j.siteId));
    return {
      assignedOnly,
      ready: !assignedOnly || jobs !== undefined,
      jobs,
      canSeeJob: (id: Id<"jobs"> | string | null | undefined) => !assignedOnly || (!!id && jobIds.has(id)),
      canSeeSite: (id: Id<"sites"> | string | null | undefined) => !assignedOnly || (!!id && siteIds.has(id)),
    };
  }, [assignedOnly, jobs]);
}
