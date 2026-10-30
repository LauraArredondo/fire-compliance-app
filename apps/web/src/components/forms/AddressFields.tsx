"use client";

import { Field, Input } from "@/components/ui";

export type AddressState = { line1: string; line2: string; city: string; region: string; postcode: string };
export const emptyAddress: AddressState = { line1: "", line2: "", city: "", region: "", postcode: "" };
export function addressFrom(a?: { line1?: string; line2?: string; city?: string; region?: string; postcode?: string } | null): AddressState {
  return { line1: a?.line1 ?? "", line2: a?.line2 ?? "", city: a?.city ?? "", region: a?.region ?? "", postcode: a?.postcode ?? "" };
}
/** For Convex: undefined when line1 is blank (optional addresses), else a cleaned object. */
export function addressArg(a: AddressState) {
  if (!a.line1.trim()) return undefined;
  const t = (s: string) => s.trim() || undefined;
  return { line1: a.line1.trim(), line2: t(a.line2), city: t(a.city), region: t(a.region), postcode: t(a.postcode) };
}

export function AddressFields({ value, onChange, required }: { value: AddressState; onChange: (a: AddressState) => void; required?: boolean }) {
  const set = (k: keyof AddressState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label={`Address line 1${required ? "" : " (optional)"}`} className="sm:col-span-2"><Input required={required} value={value.line1} onChange={set("line1")} /></Field>
      <Field label="Address line 2" className="sm:col-span-2"><Input value={value.line2} onChange={set("line2")} /></Field>
      <Field label="Town / city"><Input value={value.city} onChange={set("city")} /></Field>
      <Field label="County"><Input value={value.region} onChange={set("region")} /></Field>
      <Field label="Postcode"><Input value={value.postcode} onChange={set("postcode")} /></Field>
    </div>
  );
}

export type ContactState = { name: string; email: string; phone: string; role: string };
export const emptyContact: ContactState = { name: "", email: "", phone: "", role: "" };
export function contactFrom(c?: { name?: string; email?: string; phone?: string; role?: string } | null): ContactState {
  return { name: c?.name ?? "", email: c?.email ?? "", phone: c?.phone ?? "", role: c?.role ?? "" };
}
export function contactArg(c: ContactState) {
  if (!c.name.trim()) return undefined;
  const t = (s: string) => s.trim() || undefined;
  return { name: c.name.trim(), email: t(c.email), phone: t(c.phone), role: t(c.role) };
}
export function ContactFields({ value, onChange }: { value: ContactState; onChange: (c: ContactState) => void }) {
  const set = (k: keyof ContactState) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [k]: e.target.value });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Name"><Input value={value.name} onChange={set("name")} /></Field>
      <Field label="Role"><Input value={value.role} onChange={set("role")} /></Field>
      <Field label="Email"><Input type="email" value={value.email} onChange={set("email")} /></Field>
      <Field label="Phone"><Input value={value.phone} onChange={set("phone")} /></Field>
    </div>
  );
}
