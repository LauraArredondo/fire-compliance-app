"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useSession } from "@/lib/session";
import { homeFor } from "@/lib/routing";
import { canAccessWebPath } from "@fire/shared";
import { DENIED_PARAM } from "@/lib/permissions";
import { ROLE_LABEL, type Role } from "@/lib/labels";
import { Loading } from "./ui";
import { Logo } from "./Logo";
import { OrgSwitcher } from "./OrgSwitcher";

export type NavItem = { href: string; label: string; roles?: Role[] };

/**
 * Authenticated app frame. `area` = "staff" (/app) or "portal" (/portal); users with the wrong
 * role for the area are redirected to their home.
 */
export function Shell({ area, nav, children }: { area: "staff" | "portal"; nav: NavItem[]; children: ReactNode }) {
  const s = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const { signOut } = useAuthActions();
  const [open, setOpen] = useState(false);

  const wrongArea = s.current && (area === "portal" ? s.current.role !== "client_user" : s.current.role === "client_user");
  // Staff pages the current role can't open (e.g. an engineer typing /app/invoices) bounce to the dashboard.
  const denied = !!s.current && !wrongArea && area === "staff" && !canAccessWebPath(s.current.role, pathname);
  useEffect(() => {
    if (s.isLoading) return;
    if (!s.isAuthenticated) router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
    else if (s.me && !s.current) router.replace("/onboarding");
    else if (wrongArea) router.replace(homeFor(s.current));
    else if (denied) router.replace(`/app?${DENIED_PARAM}=1`);
  }, [s.isLoading, s.isAuthenticated, s.me, s.current, wrongArea, denied, router, pathname]);

  if (s.isLoading || !s.isAuthenticated || !s.me || !s.current || wrongArea || denied) return <Loading />;

  const items = nav.filter((n) => !n.roles || n.roles.includes(s.current!.role));
  const root = area === "staff" ? "/app" : "/portal";
  const isActive = (href: string) => (href === root ? pathname === root : pathname === href || pathname.startsWith(href + "/"));

  const sidebar = (
    <div className="flex h-full flex-col gap-6 bg-slate-900 px-4 py-5 text-slate-200">
      <Link href={root} className="text-white"><Logo /></Link>
      <OrgSwitcher />
      <nav className="flex-1 space-y-0.5">
        {items.map((n) => (
          <Link key={n.href} href={n.href} onClick={() => setOpen(false)}
            className={`block rounded-md px-3 py-2 text-sm ${isActive(n.href) ? "bg-slate-800 font-medium text-white" : "text-slate-300 hover:bg-slate-800 hover:text-white"}`}>
            {n.label}
          </Link>
        ))}
      </nav>
      <div className="border-t border-slate-800 pt-4 text-sm">
        <div className="truncate text-white">{s.me.name ?? s.me.email}</div>
        <div className="truncate text-xs text-slate-400">{s.me.email} · {ROLE_LABEL[s.current.role]}</div>
        <button className="mt-3 text-xs text-slate-400 hover:text-white" onClick={() => void signOut().then(() => router.replace("/signin"))}>Sign out</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <aside className="hidden w-64 shrink-0 lg:block"><div className="fixed inset-y-0 w-64">{sidebar}</div></aside>
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
        <Logo />
        <button className="rounded-md border border-slate-300 px-3 py-1 text-sm" onClick={() => setOpen(!open)}>{open ? "Close" : "Menu"}</button>
      </div>
      {open && <div className="lg:hidden">{sidebar}</div>}
      <main className="min-w-0 flex-1 px-4 py-6 sm:px-8"><div className="mx-auto max-w-6xl">{children}</div></main>
    </div>
  );
}
