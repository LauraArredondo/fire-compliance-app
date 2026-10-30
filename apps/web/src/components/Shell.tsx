"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useQuery } from "convex/react";
import { useSession } from "@/lib/session";
import { homeFor } from "@/lib/routing";
import { ROLE_LABEL, OFFICE, type Role } from "@/lib/labels";
import { api } from "@/lib/api";
import { Loading } from "./ui";
import { Logo } from "./Logo";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeToggle } from "./ThemeToggle";
import { Icon, type IconName } from "./icons";

export type NavItem = { href: string; label: string; roles?: Role[]; group?: string; icon?: IconName };

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2 && name) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

function sectionTitle(pathname: string, nav: NavItem[], root: string) {
  if (pathname === root) return nav.find((n) => n.href === root)?.label ?? "Workspace";
  const hit = [...nav].filter((n) => n.href !== root && (pathname === n.href || pathname.startsWith(n.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0];
  return hit?.label ?? "Workspace";
}

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
  useEffect(() => {
    if (s.isLoading) return;
    if (!s.isAuthenticated) router.replace(`/signin?next=${encodeURIComponent(pathname)}`);
    else if (s.me && !s.current) router.replace("/onboarding");
    else if (wrongArea) router.replace(homeFor(s.current));
  }, [s.isLoading, s.isAuthenticated, s.me, s.current, wrongArea, router, pathname]);

  if (s.isLoading || !s.isAuthenticated || !s.me || !s.current || wrongArea) return <Loading />;

  const items = nav.filter((n) => !n.roles || n.roles.includes(s.current!.role));
  const root = area === "staff" ? "/app" : "/portal";
  const isActive = (href: string) => (href === root ? pathname === root : pathname === href || pathname.startsWith(href + "/"));
  const title = sectionTitle(pathname, items, root);
  const office = area === "staff" && OFFICE.includes(s.current.role);

  const groups: { label: string; items: NavItem[] }[] = [];
  for (const item of items) {
    const label = item.group ?? "Menu";
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }

  const sidebar = (
    <div className="flex h-full flex-col gap-5 bg-surface px-4 py-5">
      <Link href={root} className="px-2" onClick={() => setOpen(false)}><Logo /></Link>
      <OrgSwitcher />
      <nav className="flex-1 space-y-4 overflow-y-auto" aria-label={area === "staff" ? "Workspace" : "Portal"}>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="type-overline px-3 pb-1.5 text-fg-muted">{g.label}</div>
            <div className="space-y-0.5">
              {g.items.map((n) => {
                const active = isActive(n.href);
                return (
                  <Link key={n.href} href={n.href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined}
                    className={`flex h-[38px] items-center gap-3 rounded-[10px] px-3 text-sm font-medium ${active ? "bg-brand-subtle text-fg" : "text-fg-2 hover:bg-hover hover:text-fg"}`}>
                    {n.icon && <Icon name={n.icon} className={`h-[18px] w-[18px] ${active ? "text-brand" : "text-fg-muted"}`} />}
                    <span>{n.label}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>
      <div className="px-1">
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hover text-xs font-semibold text-fg" aria-hidden>
            {initials(s.me.name, s.me.email)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-fg">{s.me.name ?? s.me.email}</div>
            <div className="truncate text-xs text-fg-muted">{s.me.email}</div>
          </div>
        </div>
        <button className="mt-2 px-1 text-xs text-fg-muted hover:text-fg" onClick={() => void signOut().then(() => router.replace("/signin"))}>Sign out</button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[264px_minmax(0,1fr)]">
      <aside className="sticky top-0 hidden h-screen border-r border-line-subtle lg:block">{sidebar}</aside>
      <div className="relative min-w-0">
        <div aria-hidden className="pointer-events-none absolute -right-16 -top-28 h-[420px] w-[520px] rounded-full blur-[120px] glow-brand" />
        <header className="sticky top-0 z-30 flex flex-wrap items-center gap-3 px-4 py-3 glass sm:px-8">
          <button type="button" className="h-10 rounded-md border border-line bg-surface px-3 text-sm font-medium shadow-e1 lg:hidden" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? "Close" : "Menu"}
          </button>
          <div className="min-w-0 flex-1">
            <div className="text-xs text-fg-muted">{area === "staff" ? "Workspace" : "Client portal"}</div>
            <div className="truncate text-lg font-semibold tracking-tight text-fg">{title}</div>
          </div>
          <SearchBox area={area} nav={items} />
          <ThemeToggle />
          {office && (
            <Link href="/app/jobs/new" className="inline-flex h-10 items-center gap-1.5 rounded-md bg-brand px-4 text-sm font-medium text-on-brand shadow-e1 hover:bg-brand-hover dark:shadow-glow">
              <Icon name="plus" className="h-4 w-4" /> New job
            </Link>
          )}
          <span className="grid h-10 w-10 place-items-center rounded-full bg-fire text-xs font-semibold text-ash-0" title={s.me.name ?? s.me.email ?? ""}>
            {initials(s.me.name, s.me.email)}
          </span>
        </header>
        {open && (
          <div className="fixed inset-0 z-40 lg:hidden">
            <button type="button" className="absolute inset-0 bg-inverse/40" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="absolute inset-y-0 left-0 w-[264px] border-r border-line-subtle shadow-e3">{sidebar}</div>
          </div>
        )}
        <main className="relative min-w-0 px-4 py-6 sm:px-8"><div className="mx-auto max-w-7xl">{children}</div></main>
      </div>
    </div>
  );
}

function SearchBox({ area, nav }: { area: "staff" | "portal"; nav: NavItem[] }) {
  const s = useSession();
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const orgId = s.orgId;
  const staff = area === "staff";
  const term = q.trim();
  const ready = term.length >= 2 && !!orgId;
  const clients = useQuery(api.clients.list, staff && ready ? { orgId: orgId!, search: term, paginationOpts: { numItems: 5, cursor: null } } : "skip");
  const sites = useQuery(api.sites.list, ready ? { orgId: orgId!, search: term, paginationOpts: { numItems: 5, cursor: null } } : "skip");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, []);

  const pages = useMemo(() => {
    const needle = term.toLowerCase();
    if (!needle) return nav.slice(0, 6);
    return nav.filter((n) => n.label.toLowerCase().includes(needle));
  }, [nav, term]);

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    router.push(href);
  };

  const base = area === "staff" ? "/app" : "/portal";

  return (
    <div ref={box} className="relative order-last w-full sm:order-none sm:w-80">
      <label className="flex h-10 items-center gap-2 rounded-full border border-line-subtle bg-subtle px-3 text-sm text-fg-muted">
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <input
          ref={input}
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          placeholder={staff ? "Search clients, sites, pages…" : "Search sites, pages…"}
          className="min-w-0 flex-1 bg-transparent text-fg placeholder:text-fg-muted focus-visible:outline-none"
          aria-label="Search"
          aria-expanded={open}
          role="combobox"
        />
        <kbd className="hidden rounded border border-line bg-surface px-1.5 font-mono text-[11px] text-fg-muted sm:inline">⌘K</kbd>
      </label>
      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 max-h-80 overflow-auto rounded-xl border border-line-subtle bg-overlay p-2 shadow-e3">
          {pages.length > 0 && (
            <div className="mb-1">
              <div className="type-overline px-2 py-1 text-fg-muted">Pages</div>
              {pages.map((n) => (
                <button key={n.href} type="button" className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover" onClick={() => go(n.href)}>
                  {n.icon && <Icon name={n.icon} className="h-4 w-4 text-fg-muted" />}
                  {n.label}
                </button>
              ))}
            </div>
          )}
          {staff && (clients?.page.length ?? 0) > 0 && (
            <div className="mb-1">
              <div className="type-overline px-2 py-1 text-fg-muted">Clients</div>
              {clients!.page.map((c) => (
                <button key={c._id} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover" onClick={() => go(`${base}/clients/${c._id}`)}>{c.name}</button>
              ))}
            </div>
          )}
          {(sites?.page.length ?? 0) > 0 && (
            <div>
              <div className="type-overline px-2 py-1 text-fg-muted">Sites</div>
              {sites!.page.map((site) => (
                <button key={site._id} type="button" className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-fg hover:bg-hover" onClick={() => go(`${base}/sites/${site._id}`)}>
                  {site.name}{site.clientName ? <span className="text-fg-muted"> · {site.clientName}</span> : null}
                </button>
              ))}
            </div>
          )}
          {term.length >= 2 && pages.length === 0 && !clients?.page.length && !sites?.page.length && (
            <div className="px-2 py-3 text-sm text-fg-muted">No matches for “{term}”.</div>
          )}
          {term.length < 2 && pages.length === 0 && <div className="px-2 py-3 text-sm text-fg-muted">Type at least 2 characters to search records.</div>}
        </div>
      )}
    </div>
  );
}
