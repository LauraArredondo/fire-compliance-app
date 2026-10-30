"use client";

import { LINE_KINDS } from "@/lib/labels";
import { money, toMinor } from "@/lib/format";
import { Input, Select } from "./ui";

export type LineDraft = { kind: string; description: string; quantity: string; unitPrice: string; discountPercent: string; taxRate: string; optional: boolean };
export const blankLine = (taxRate = "20"): LineDraft => ({ kind: "labour", description: "", quantity: "1", unitPrice: "", discountPercent: "", taxRate, optional: false });

export function lineNet(l: LineDraft): number {
  const gross = Math.round((Number(l.quantity) || 0) * toMinor(l.unitPrice || 0));
  return Math.round(gross * (1 - (Number(l.discountPercent) || 0) / 100));
}
export function lineTotals(lines: LineDraft[]) {
  const req = lines.filter((l) => !l.optional);
  const subtotal = req.reduce((s, l) => s + lineNet(l), 0);
  const tax = req.reduce((s, l) => s + Math.round((lineNet(l) * (Number(l.taxRate) || 0)) / 100), 0);
  return { subtotal, tax, total: subtotal + tax };
}
export function toLineArgs(l: LineDraft) {
  return {
    description: l.description.trim(), quantity: Number(l.quantity) || 0, unitPrice: toMinor(l.unitPrice || 0),
    discountPercent: l.discountPercent ? Number(l.discountPercent) : undefined, taxRate: l.taxRate === "" ? undefined : Number(l.taxRate),
  };
}

export function LinesEditor({ lines, onChange, withKinds }: { lines: LineDraft[]; onChange: (l: LineDraft[]) => void; withKinds?: boolean }) {
  const set = (i: number, patch: Partial<LineDraft>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const t = lineTotals(lines);
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-12 gap-2 text-xs font-medium text-slate-500 md:grid">
        {withKinds && <div className="col-span-2">Kind</div>}
        <div className={withKinds ? "col-span-3" : "col-span-5"}>Description</div>
        <div className="col-span-1">Qty</div><div className="col-span-2">Unit £</div><div className="col-span-1">Disc %</div><div className="col-span-1">VAT %</div><div className="col-span-2 text-right">Net</div>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="grid grid-cols-2 items-center gap-2 rounded-md border border-slate-100 p-2 md:grid-cols-12 md:border-0 md:p-0">
          {withKinds && <div className="md:col-span-2"><Select options={LINE_KINDS} value={l.kind} onChange={(e) => set(i, { kind: e.target.value })} /></div>}
          <div className={`col-span-2 ${withKinds ? "md:col-span-3" : "md:col-span-5"}`}><Input required placeholder="Description" value={l.description} onChange={(e) => set(i, { description: e.target.value })} /></div>
          <div className="md:col-span-1"><Input inputMode="decimal" value={l.quantity} onChange={(e) => set(i, { quantity: e.target.value })} /></div>
          <div className="md:col-span-2"><Input inputMode="decimal" placeholder="0.00" value={l.unitPrice} onChange={(e) => set(i, { unitPrice: e.target.value })} /></div>
          <div className="md:col-span-1"><Input inputMode="decimal" value={l.discountPercent} onChange={(e) => set(i, { discountPercent: e.target.value })} /></div>
          <div className="md:col-span-1"><Input inputMode="decimal" value={l.taxRate} onChange={(e) => set(i, { taxRate: e.target.value })} /></div>
          <div className="flex items-center justify-end gap-2 text-sm md:col-span-2">
            {withKinds && <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={l.optional} onChange={(e) => set(i, { optional: e.target.checked })} />opt.</label>}
            <span className="tabular-nums">{money(lineNet(l))}</span>
            <button type="button" aria-label="Remove line" className="text-slate-400 hover:text-red-700" onClick={() => onChange(lines.filter((_, j) => j !== i))}>✕</button>
          </div>
        </div>
      ))}
      <button type="button" className="text-sm font-medium text-red-700 hover:underline" onClick={() => onChange([...lines, blankLine(lines.at(-1)?.taxRate ?? "20")])}>+ Add line</button>
      <div className="ml-auto w-full max-w-xs space-y-1 border-t border-slate-200 pt-2 text-sm">
        <div className="flex justify-between"><span>Subtotal</span><span className="tabular-nums">{money(t.subtotal)}</span></div>
        <div className="flex justify-between"><span>VAT</span><span className="tabular-nums">{money(t.tax)}</span></div>
        <div className="flex justify-between font-semibold"><span>Total</span><span className="tabular-nums">{money(t.total)}</span></div>
        {withKinds && lines.some((l) => l.optional) && <div className="text-xs text-slate-500">Optional lines are excluded until the client selects them.</div>}
      </div>
    </div>
  );
}

/** Read-only lines table. */
export function LinesTable({ lines, currency }: { lines: { description: string; quantity: number; unitPrice: number; discountPercent?: number; taxRate?: number; lineTotal: number; optional?: boolean; selected?: boolean; kind?: string }[]; currency?: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm">
        <thead><tr className="border-b border-slate-200 text-left text-xs text-slate-500"><th className="py-2 pr-3">Description</th><th className="py-2 pr-3 text-right">Qty</th><th className="py-2 pr-3 text-right">Unit</th><th className="py-2 pr-3 text-right">Disc</th><th className="py-2 pr-3 text-right">VAT</th><th className="py-2 text-right">Net</th></tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={`border-b border-slate-100 ${l.optional && !l.selected ? "text-slate-400" : ""}`}>
              <td className="py-2 pr-3">{l.description}{l.optional && <span className="ml-2 text-xs">(optional{l.selected ? ", selected" : ""})</span>}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{l.quantity}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{money(l.unitPrice, currency)}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{l.discountPercent ? `${l.discountPercent}%` : "—"}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{l.taxRate ?? 0}%</td>
              <td className="py-2 text-right tabular-nums">{money(l.lineTotal, currency)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Totals({ rows }: { rows: [string, string, boolean?][] }) {
  return (
    <div className="ml-auto mt-3 w-full max-w-xs space-y-1 text-sm">
      {rows.map(([k, v, bold]) => <div key={k} className={`flex justify-between ${bold ? "font-semibold" : ""}`}><span>{k}</span><span className="tabular-nums">{v}</span></div>)}
    </div>
  );
}
