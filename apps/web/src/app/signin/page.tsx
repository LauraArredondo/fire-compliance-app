"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useSession } from "@/lib/session";
import { homeFor } from "@/lib/routing";
import { errorMessage } from "@/lib/errors";
import { Button, ErrorBox, Field, Input, Loading } from "@/components/ui";
import { Logo } from "@/components/Logo";
import { ThemeToggle } from "@/components/ThemeToggle";

function passwordProblem(pw: string): string | null {
  if (pw.length < 8 || !/\d/.test(pw) || !/[a-zA-Z]/.test(pw)) return "Password must be at least 8 characters and include a letter and a number.";
  return null;
}

function SignInForm() {
  const { signIn } = useAuthActions();
  const s = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next");
  const [flow, setFlow] = useState<"signIn" | "signUp">(params.get("mode") === "signup" ? "signUp" : "signIn");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!s.isLoading && s.isAuthenticated && s.me) router.replace(next && next.startsWith("/") ? next : homeFor(s.current));
  }, [s.isLoading, s.isAuthenticated, s.me, s.current, next, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (flow === "signUp") {
      const p = passwordProblem(password);
      if (p) return setError(p);
    }
    setBusy(true);
    try {
      await signIn("password", { email: email.trim().toLowerCase(), password, flow, ...(flow === "signUp" && name.trim() ? { name: name.trim() } : {}) });
    } catch (err) {
      const m = errorMessage(err);
      setError(flow === "signIn" && /InvalidSecret|InvalidAccountId|Invalid credentials|could not/i.test(m) ? "Incorrect email or password." : flow === "signUp" && /already exists/i.test(m) ? "An account with this email already exists. Sign in instead." : m);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center px-4 py-16">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 h-[420px] w-[520px] rounded-full blur-[120px] glow-brand" />
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="relative w-full max-w-sm">
        <div className="mb-6 flex justify-center"><Logo /></div>
        <div className="rounded-xl border border-line-subtle bg-surface p-6 shadow-e2">
          <h1 className="mb-1 text-lg font-semibold">{flow === "signIn" ? "Sign in" : "Create your account"}</h1>
          <p className="mb-5 text-sm text-fg-muted">FireGrid — fire and security compliance for UK service companies.</p>
          <form onSubmit={submit} className="space-y-4">
            {flow === "signUp" && <Field label="Your name"><Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></Field>}
            <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" /></Field>
            <Field label="Password" hint={flow === "signUp" ? "At least 8 characters, with a letter and a number." : undefined}>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={flow === "signUp" ? "new-password" : "current-password"} />
            </Field>
            <ErrorBox message={error} />
            <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : flow === "signIn" ? "Sign in" : "Create account"}</Button>
          </form>
          <p className="mt-4 text-center text-sm text-fg-2">
            {flow === "signIn" ? "New here? " : "Already have an account? "}
            <button type="button" className="font-medium text-link hover:underline" onClick={() => { setFlow(flow === "signIn" ? "signUp" : "signIn"); setError(null); }}>
              {flow === "signIn" ? "Create an account" : "Sign in"}
            </button>
          </p>
        </div>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return <Suspense fallback={<Loading />}><SignInForm /></Suspense>;
}
