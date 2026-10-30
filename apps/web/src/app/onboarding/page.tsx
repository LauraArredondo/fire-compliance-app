"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { errorMessage } from "@/lib/errors";
import { DISCIPLINES, DISCIPLINE_LABEL, type Discipline } from "@/lib/labels";
import { Button, Checkbox, ErrorBox, Field, Input, Loading } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { opt } from "@/lib/format";

export default function OnboardingPage() {
  const s = useSession();
  const router = useRouter();
  const { signOut } = useAuthActions();
  const create = useMutation(api.organizations.createWithOwner);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [disc, setDisc] = useState<Discipline[]>(["fire_alarm", "emergency_lighting"]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!s.isLoading && !s.isAuthenticated) router.replace("/signin");
  }, [s.isLoading, s.isAuthenticated, router]);
  if (s.isLoading || !s.me) return <Loading />;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!disc.length) return setError("Pick at least one discipline.");
    setBusy(true);
    try {
      const r = await create({ name: name.trim(), disciplines: disc, email: opt(email), phone: opt(phone) });
      s.setOrgId(r.orgId);
      router.replace("/app");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex items-center justify-between">
          <Logo className="text-xl" />
          <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => void signOut().then(() => router.replace("/signin"))}>Sign out</button>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold">Set up your company</h1>
          <p className="mb-5 mt-1 text-sm text-slate-500">
            Signed in as {s.me.email}. {s.memberships.length ? "Create another company, or go back to your existing one." : "You'll be the owner and can invite your team afterwards."}
          </p>
          <form onSubmit={submit} className="space-y-4">
            <Field label="Company name"><Input required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Northern Fire & Security Ltd" /></Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Office email (optional)"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
              <Field label="Phone (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium text-slate-700">Disciplines you cover</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {DISCIPLINES.map((d) => (
                  <Checkbox key={d} label={DISCIPLINE_LABEL[d]} checked={disc.includes(d)} onChange={(on) => setDisc(on ? [...disc, d] : disc.filter((x) => x !== d))} />
                ))}
              </div>
            </fieldset>
            <ErrorBox message={error} />
            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Create company"}</Button>
              {s.memberships.length > 0 && <Button type="button" variant="secondary" onClick={() => router.push("/")}>Back</Button>}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
