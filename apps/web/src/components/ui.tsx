"use client";

import Link from "next/link";
import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { humanize, toneFor, type Tone } from "@/lib/labels";
import { errorMessage } from "@/lib/errors";

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

type Variant = "primary" | "secondary" | "danger" | "ghost";
const VARIANT: Record<Variant, string> = {
  primary: "bg-red-700 text-white hover:bg-red-800 disabled:bg-red-300",
  secondary: "bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400",
  danger: "bg-white text-red-700 border border-red-300 hover:bg-red-50 disabled:text-red-300",
  ghost: "text-slate-600 hover:bg-slate-100",
};

export function Button({ variant = "primary", className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return <button {...p} className={cx("inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed", VARIANT[variant], className)} />;
}

export function LinkButton({ href, children, variant = "primary", className }: { href: string; children: ReactNode; variant?: Variant; className?: string }) {
  return <Link href={href} className={cx("inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium shadow-sm transition", VARIANT[variant], className)}>{children}</Link>;
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
      {err && !onError && <span className="mt-1 max-w-xs text-xs text-red-700">{err}</span>}
    </span>
  );
}

const fieldCls = "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-red-600 focus:outline-none focus:ring-1 focus:ring-red-600 disabled:bg-slate-50";
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}
export function Checkbox({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex items-center gap-2 text-sm text-slate-700">
      <input type="checkbox" className="h-4 w-4 rounded border-slate-300 text-red-700 focus:ring-red-600" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

const TONE: Record<Tone, string> = {
  gray: "bg-slate-100 text-slate-700 ring-slate-200",
  blue: "bg-blue-50 text-blue-700 ring-blue-200",
  green: "bg-green-50 text-green-700 ring-green-200",
  amber: "bg-amber-50 text-amber-800 ring-amber-200",
  red: "bg-red-50 text-red-700 ring-red-200",
  purple: "bg-purple-50 text-purple-700 ring-purple-200",
};
export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: Tone }) {
  return <span className={cx("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap", TONE[tone])}>{children}</span>;
}
export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={toneFor(status)}>{label ?? humanize(status)}</Badge>;
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx("rounded-lg border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-6">
      {back && <Link href={back.href} className="mb-2 inline-block text-sm text-slate-500 hover:text-slate-800">← {back.label}</Link>}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
          {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
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
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm text-slate-900">{v === undefined || v === null || v === "" ? "—" : v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function ErrorBox({ message }: { message: string | null | undefined }) {
  if (!message) return null;
  return <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</div>;
}
export function Notice({ children, tone = "amber" }: { children: ReactNode; tone?: "amber" | "blue" | "green" }) {
  const c = tone === "amber" ? "border-amber-200 bg-amber-50 text-amber-900" : tone === "blue" ? "border-blue-200 bg-blue-50 text-blue-900" : "border-green-200 bg-green-50 text-green-900";
  return <div className={cx("rounded-md border px-3 py-2 text-sm", c)}>{children}</div>;
}
export function Loading({ label = "Loading…" }: { label?: string }) {
  return <div className="py-10 text-center text-sm text-slate-500">{label}</div>;
}
export function Empty({ children }: { children: ReactNode }) {
  return <div className="py-8 text-center text-sm text-slate-500">{children}</div>;
}

export type Column<T> = { header: string; cell: (row: T) => ReactNode; className?: string };
export function Table<T extends { _id: string }>({ rows, columns, href, empty = "Nothing here yet." }: { rows: T[] | undefined; columns: Column<T>[]; href?: (row: T) => string; empty?: ReactNode }) {
  if (rows === undefined) return <Loading />;
  if (!rows.length) return <Empty>{empty}</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead><tr>{columns.map((c) => <th key={c.header} className={cx("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", c.className)}>{c.header}</th>)}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => (
            <tr key={r._id} className={cx(href && "hover:bg-slate-50")}>
              {columns.map((c, i) => (
                <td key={c.header} className={cx("px-3 py-2 align-top text-slate-800", c.className)}>
                  {href && i === 0 ? <Link className="font-medium text-red-800 hover:underline" href={href(r)}>{c.cell(r)}</Link> : c.cell(r)}
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
          className={cx("rounded-full px-3 py-1 text-xs font-medium", value === o ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200")}>
          {o === "" ? "All" : labels ? labels(o as T) : humanize(o)}
        </button>
      ))}
    </div>
  );
}
