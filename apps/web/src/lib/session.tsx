"use client";

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useConvexAuth, useQuery } from "convex/react";
import { api, type Id } from "./api";
import type { Role } from "./labels";

export type Membership = {
  membershipId: Id<"memberships">;
  orgId: Id<"organizations">;
  orgName: string | null;
  role: Role;
  clientId: Id<"clients"> | null;
  status: string;
};
export type Me = {
  _id: Id<"users">;
  name: string | null;
  email: string | null;
  defaultOrgId: Id<"organizations"> | null;
  memberships: Membership[];
};

type Session = {
  isLoading: boolean;
  isAuthenticated: boolean;
  me: Me | null | undefined;
  /** Active memberships only. */
  memberships: Membership[];
  current: Membership | null;
  orgId: Id<"organizations"> | null;
  role: Role | null;
  setOrgId: (id: Id<"organizations">) => void;
};

const Ctx = createContext<Session | null>(null);
const KEY = "fc.currentOrgId";

export function SessionProvider({ children }: { children: ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const me = useQuery(api.users.me, isAuthenticated ? {} : "skip") as Me | null | undefined;
  const [stored, setStored] = useState<string | null>(null);
  useEffect(() => setStored(typeof window !== "undefined" ? window.localStorage.getItem(KEY) : null), []);

  const value = useMemo<Session>(() => {
    const memberships = (me?.memberships ?? []).filter((m) => m.status === "active");
    const current =
      memberships.find((m) => m.orgId === stored) ??
      memberships.find((m) => m.orgId === me?.defaultOrgId) ??
      memberships[0] ??
      null;
    return {
      isLoading: isLoading || (isAuthenticated && me === undefined),
      isAuthenticated,
      me: isAuthenticated ? me : null,
      memberships,
      current,
      orgId: current?.orgId ?? null,
      role: current?.role ?? null,
      setOrgId: (id) => {
        window.localStorage.setItem(KEY, id);
        setStored(id);
      },
    };
  }, [isLoading, isAuthenticated, me, stored]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession(): Session {
  const s = useContext(Ctx);
  if (!s) throw new Error("useSession must be used inside SessionProvider");
  return s;
}

/** For pages inside the staff shell / portal, where an org is guaranteed. */
export function useOrg() {
  const s = useSession();
  if (!s.orgId || !s.current || !s.role) throw new Error("No organisation selected");
  return { orgId: s.orgId, role: s.role, membership: s.current, me: s.me! };
}
