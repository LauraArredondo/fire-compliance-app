"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { humanize, toneFor, type Tone } from "@/lib/labels";
import { errorMessage } from "@/lib/errors";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover shadow-e1 dark:shadow-glow disabled:opacity-50",
  secondary: "bg-surface text-fg border border-line shadow-e1 hover:bg-hover disabled:opacity-50",
  danger: "bg-surface text-danger border border-danger-line hover:bg-danger-bg disabled:opacity-50",
  ghost: "text-fg-2 hover:bg-hover",
};

const btn = "inline-flex h-10 items-center justify-center gap-1.5 rounded-md px-4 text-sm font-medium transition disabled:cursor-not-allowed";

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={cx(btn, VARIANT[variant], className)} />;
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: Variant; className?: string }) {
  return <Link href={href} className={cx(btn, VARIANT[variant], className)}>{children}</Link>;
}

/** Button that runs an async action, shows a spinner and reports errors. */
export function ActionButton({ action, children, confirm, variant = "secondary", onError, className, disabled }: {
  action: () => Promise<unknown>; children: ReactNode; confirm?: string; variant?: Variant; onError?: (msg: string) => void; className?: string; disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col items-start">
      <Button
        type="button" variant={variant} className={className} disabled={busy || disabled}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return;
          setBusy(true); setErr(null);
          try { await action(); } catch (e) { const m = errorMessage(e); setErr(m); onError?.(m); } finally { setBusy(false); }
        }}
      >{busy ? "Working…" : children}</Button>
      {err && !onError && <span className="mt-1 max-w-xs text-xs text-danger">{err}</span>}
    </span>
  );
}

const fieldCls = "block w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-fg shadow-e1 placeholder:text-fg-muted disabled:bg-subtle disabled:text-fg-muted";
export function Input(p: InputHTMLAttributes<HTMLInputElement>) { return <input {...p} className={cx(fieldCls, p.className)} />; }
export function Textarea(p: TextareaHTMLAttributes<HTMLTextAreaElement>) { return <textarea rows={3} {...p} className={cx(fieldCls, p.className)} />; }
export function Select({ options, placeholder, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { options: readonly (string | { value: string; label: string })[]; placeholder?: string }) {
  return (
    <select {...p} className={cx(fieldCls, p.className)}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => typeof o === "string" ? <option key={o} value={o}>{humanize(o)}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-sm font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-fg-muted">{hint}</span>}
    </label>
  );
}
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-fg-2">
      <input type="checkbox" className="h-4 w-4 rounded border-line accent-brand" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const TONE: Record<Tone, string> = {
  gray: "bg-neutral-bg text-neutral border-neutral-line",
  blue: "bg-info-bg text-info border-info-line",
  green: "bg-success-bg text-success border-success-line",
  amber: "bg-warning-bg text-warning border-warning-line",
  red: "bg-danger-bg text-danger border-danger-line",
  purple: "bg-brand-subtle text-fg border-brand-border",
};
export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-medium before:size-1.5 before:shrink-0 before:rounded-full before:bg-current", TONE[tone])}>
      {children}
    </span>
  );
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={toneFor(status)}>{label ?? humanize(status)}</Badge>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-xl border border-line-subtle bg-surface shadow-e1", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line-subtle px-5 py-3.5">
          <h2 className="text-base font-semibold text-fg">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link href={back.href} className="mb-2 inline-block text-sm text-fg-muted hover:text-fg">← {back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="type-h2 text-fg">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-fg-muted">{subtitle}</div>}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function DL({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt className="type-overline text-fg-muted">{k}</dt>
          <dd className="mt-0.5 text-sm text-fg">{v === undefined || v === null || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <div role="alert" className="rounded-md border border-danger-line bg-danger-bg px-3 py-2 text-sm text-danger">{message}</div>;
}
export function Notice({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "blue" | "green" }) {
  const c = tone === "amber" ? "border-warning-line bg-warning-bg text-warning" : tone === "blue" ? "border-info-line bg-info-bg text-info" : "border-success-line bg-success-bg text-success";
  return <div className={cx("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="py-10 text-center text-sm text-fg-muted">{label}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-fg-muted">{children}</div>;
}

export type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string };
export function Table<T extends { _id: string }>({ rows, columns, href, empty = "Nothing here yet." }: { rows: T[] | undefined; columns: Column<T>[]; href?: (row: T) => string; empty?: ReactNode }) {
  if (rows === undefined) return <Loading />;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-line text-sm">
        <thead className="bg-sunken">
          <tr>{columns.map((c) => <th key={c.header} className={cx("type-overline px-3 py-2.5 text-left text-fg-muted", c.className)}>{c.header}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line-subtle">
          {rows.map((r) => (
            <tr key={r._id} className={cx(href && "hover:bg-hover")}>
              {columns.map((c, i) => (
                <td key={c.header} className={cx("px-3 py-3 align-top text-fg", c.className)}>
                  {href && i === 0 ? <Link className="font-medium text-link hover:underline" href={href(r)}>{c.cell(r)}</Link> : c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Load more" footer for usePaginatedQuery results. */
export function LoadMore({ status, loadMore, n = 25 }: { status: "LoadingFirstPage" | "CanLoadMore" | "LoadingMore" | "Exhausted"; loadMore: (n: number) => void; n?: number }) {
  if (status === "Exhausted" || status === "LoadingFirstPage") return null;
  return (
    <div className="mt-3 flex justify-center">
      <Button variant="secondary" disabled={status === "LoadingMore"} onClick={() => loadMore(n)}>{status === "LoadingMore" ? "Loading…" : "Load more"}</Button>
    </div>
  );
}

export function FilterTabs<T extends string>({ value, onChange, options, labels, allowAll = true }: { value: T | ""; onChange: (v: T | "") => void; options: readonly T[]; labels?: (v: T) => string; allowAll?: boolean }) {
  return (
    <div className="mb-4 flex flex-wrap gap-1">
      {((allowAll ? ["", ...options] : [...options]) as (T | "")[]).map((o) => (
        <button key={o || "all"} type="button" onClick={() => onChange(o)}
          className={cx("rounded-full px-3 py-1 text-xs font-medium", value === o ? "bg-inverse text-fg-inverse" : "bg-sunken text-fg-2 hover:bg-hover")}>
          {o === "" ? "All" : labels ? labels(o as T) : humanize(o)}
        </button>
      ))}
    </div>
  );
}
