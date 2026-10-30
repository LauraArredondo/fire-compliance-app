"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import type { Id } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/lib/errors";
import { Button, Card, ErrorBox, Loading } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

/** Shared flow for /invite/team/[token] and /invite/portal/[token]. */
export function AcceptInvite({ kind, accept }: { kind: "team" | "portal"; accept: () => Promise<{ orgId: Id<"organizations"> }> }) {
  const s = useSession();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Id<"organizations"> | null>(null);
  const started = useRef(false);

  useEffect(() => {
    if (s.isLoading) return;
    if (!s.isAuthenticated) {
      router.replace(`/signin?mode=signup&next=${encodeURIComponent(window.location.pathname)}`);
      return;
    }
    if (started.current) return;
    started.current = true;
    accept().then((r) => setDone(r.orgId)).catch((e) => setErr(errorMessage(e)));
  }, [s.isLoading, s.isAuthenticated, accept, router]);

  // Wait until the new membership shows up in users.me, then switch to it.
  useEffect(() => {
    if (!done) return;
    if (s.memberships.some((m) => m.orgId === done)) {
      s.setOrgId(done);
      router.replace(kind === "portal" ? "/portal" : "/app");
    }
  }, [done, s, kind, router]);

  return (
    <main className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <Logo className="mb-6" />
      <Card title={kind === "portal" ? "Client portal invitation" : "Team invitation"}>
        {err ? (
          <div className="space-y-4">
            <ErrorBox message={err} />
            <p className="text-sm text-fg-2">Signed in as {s.me?.email ?? "…"}.</p>
            <div className="flex gap-3">
              <Button variant="secondary" onClick={() => void signOut().then(() => router.replace(`/signin?next=${encodeURIComponent(window.location.pathname)}`))}>Use a different account</Button>
              <Button variant="secondary" onClick={() => router.replace("/")}>Go home</Button>
            </div>
          </div>
        ) : <Loading label="Accepting invitation…" />}
      </Card>
    </main>
  );
}
