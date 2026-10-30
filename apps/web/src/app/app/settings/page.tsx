"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { DISCIPLINES, DISCIPLINE_LABEL, MANAGERS, type Discipline } from "@/lib/labels";
import { opt } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, Notice, PageHeader, Textarea } from "@/components/ui";
import { ThemeChoice } from "@/components/ThemeToggle";
import { AddressFields, addressArg, addressFrom } from "@/components/forms/AddressFields";
import { uploadBlob } from "@/components/SignaturePad";

const days = (s: string) => s.split(/[,\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n));

function useSaver() {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const run = (fn: () => Promise<unknown>) => async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setSaved(false); setBusy(true);
    try { await fn(); setSaved(true); } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  const footer = (label = "Save") => (
    <div className="mt-4 space-y-2">
      <ErrorBox message={error} />
      <div className="flex items-center gap-3"><Button type="submit" disabled={busy}>{busy ? "Saving…" : label}</Button>{saved && <span className="text-xs text-success">Saved</span>}</div>
    </div>
  );
  return { run, footer };
}

export default function SettingsPage() {
  const { orgId, role } = useOrg();
  const org = useQuery(api.organizations.get, { orgId });
  const manager = MANAGERS.includes(role);
  if (!org || !("role" in org)) return <Loading />;
  return (
    <>
      <PageHeader title="Settings" subtitle={org.name} />
      {!manager && <div className="mb-4"><Notice tone="blue">Only owners and admins can change company, billing and reminder settings. Office staff can change job automation.</Notice></div>}
      <div className="space-y-6">
        <Card title="Appearance">
          <p className="mb-3 text-sm text-fg-2">FireGrid follows your system setting until you pick light or dark. The choice is saved in this browser.</p>
          <ThemeChoice />
        </Card>
        <ProfileCard org={org} />
        <LogoCard orgId={orgId} logoUrl={org.logoUrl} />
        <BillingCard org={org} />
        <ReminderCard />
        <AutomationCard />
      </div>
    </>
  );
}

type Org = NonNullable<ReturnType<typeof useQuery<typeof api.organizations.get>>> & { role: string };

function ProfileCard({ org }: { org: Org }) {
  const { orgId } = useOrg();
  const update = useMutation(api.organizations.updateProfile);
  const o = org as Org & { legalName?: string; registrationNumber?: string; vatNumber?: string; defaultTaxRate?: number; disciplines?: Discipline[]; timezone?: string };
  const [f, setF] = useState({ name: o.name, legalName: o.legalName ?? "", registrationNumber: o.registrationNumber ?? "", vatNumber: o.vatNumber ?? "", email: o.email ?? "", phone: o.phone ?? "", defaultTaxRate: String(o.defaultTaxRate ?? 20) });
  const [addr, setAddr] = useState(addressFrom(o.address));
  const [disciplines, setDisciplines] = useState<Discipline[]>(o.disciplines ?? []);
  const [accreditations, setAccreditations] = useState((o.accreditations ?? []).map((a) => ({ body: a.body, scheme: a.scheme ?? "", number: a.number ?? "" })));
  const { run, footer } = useSaver();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Card title="Company profile">
      <form onSubmit={run(() => update({
        orgId, name: f.name, legalName: opt(f.legalName), registrationNumber: opt(f.registrationNumber), vatNumber: opt(f.vatNumber), email: opt(f.email), phone: opt(f.phone),
        defaultTaxRate: Number(f.defaultTaxRate), address: addressArg(addr), disciplines,
        accreditations: accreditations.filter((a) => a.body.trim()).map((a) => ({ body: a.body.trim(), scheme: opt(a.scheme), number: opt(a.number) })),
      }))}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Trading name"><Input required value={f.name} onChange={set("name")} /></Field>
          <Field label="Legal name"><Input value={f.legalName} onChange={set("legalName")} /></Field>
          <Field label="Company number"><Input value={f.registrationNumber} onChange={set("registrationNumber")} /></Field>
          <Field label="VAT number"><Input value={f.vatNumber} onChange={set("vatNumber")} /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={set("email")} /></Field>
          <Field label="Phone"><Input value={f.phone} onChange={set("phone")} /></Field>
          <Field label="Default VAT rate %"><Input inputMode="decimal" value={f.defaultTaxRate} onChange={set("defaultTaxRate")} /></Field>
        </div>
        <div className="mt-4"><AddressFields value={addr} onChange={setAddr} /></div>
        <Field label="Disciplines" className="mt-4">
          <div className="grid grid-cols-1 gap-1 sm:grid-cols-2">{DISCIPLINES.map((d) => (
            <label key={d} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4" checked={disciplines.includes(d)} onChange={(e) => setDisciplines(e.target.checked ? [...disciplines, d] : disciplines.filter((x) => x !== d))} />{DISCIPLINE_LABEL[d]}</label>
          ))}</div>
        </Field>
        <Field label="Accreditations (shown on certificates)" className="mt-4">
          <div className="space-y-2">
            {accreditations.map((a, i) => (
              <div key={i} className="grid grid-cols-7 gap-2">
                <Input className="col-span-2" placeholder="Body (e.g. BAFE)" value={a.body} onChange={(e) => setAccreditations(accreditations.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))} />
                <Input className="col-span-2" placeholder="Scheme (e.g. SP203-1)" value={a.scheme} onChange={(e) => setAccreditations(accreditations.map((x, j) => (j === i ? { ...x, scheme: e.target.value } : x)))} />
                <Input className="col-span-2" placeholder="Number" value={a.number} onChange={(e) => setAccreditations(accreditations.map((x, j) => (j === i ? { ...x, number: e.target.value } : x)))} />
                <button type="button" className="text-fg-muted hover:text-danger" onClick={() => setAccreditations(accreditations.filter((_, j) => j !== i))}>✕</button>
              </div>
            ))}
            <button type="button" className="text-sm font-medium text-link hover:underline" onClick={() => setAccreditations([...accreditations, { body: "", scheme: "", number: "" }])}>+ Add accreditation</button>
          </div>
        </Field>
        {footer("Save profile")}
      </form>
    </Card>
  );
}

function LogoCard({ orgId, logoUrl }: { orgId: Id<"organizations">; logoUrl: string | null }) {
  const gen = useMutation(api.organizations.generateLogoUploadUrl);
  const setLogo = useMutation(api.organizations.setLogo);
  const removeLogo = useMutation(api.organizations.removeLogo);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null); setBusy(true);
    try { const id = await uploadBlob(await gen({ orgId }), file); await setLogo({ orgId, storageId: id as Id<"_storage"> }); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }
  return (
    <Card title="Logo">
      <div className="flex items-center gap-4">
        {logoUrl ? <img src={logoUrl} alt="Company logo" className="h-16 w-auto rounded border border-line bg-surface p-1" /> : <div className="flex h-16 w-28 items-center justify-center rounded border border-dashed border-line-strong text-xs text-fg-muted">No logo</div>}
        <label className="cursor-pointer rounded-md border border-line-strong bg-surface px-3 py-2 text-sm hover:bg-hover">{busy ? "Uploading…" : "Upload PNG/JPEG"}<input type="file" accept="image/png,image/jpeg" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} /></label>
        {logoUrl && <button type="button" className="text-sm text-link hover:underline" onClick={() => void removeLogo({ orgId }).catch((e) => setError(errorMessage(e)))}>Remove</button>}
      </div>
      <div className="mt-2"><ErrorBox message={error} /></div>
    </Card>
  );
}

function BillingCard({ org }: { org: Org }) {
  const { orgId } = useOrg();
  const update = useMutation(api.organizations.updateBillingSettings);
  const o = org as Org & { bankDetails?: { bankName?: string; accountName?: string; sortCode?: string; accountNumber?: string; iban?: string; bic?: string; paymentInstructions?: string }; quoteTerms?: string; invoiceFooter?: string };
  const b = o.bankDetails ?? {};
  const [bank, setBank] = useState({ bankName: b.bankName ?? "", accountName: b.accountName ?? "", sortCode: b.sortCode ?? "", accountNumber: b.accountNumber ?? "", iban: b.iban ?? "", bic: b.bic ?? "", paymentInstructions: b.paymentInstructions ?? "" });
  const [quoteTerms, setQuoteTerms] = useState(o.quoteTerms ?? "");
  const [invoiceFooter, setInvoiceFooter] = useState(o.invoiceFooter ?? "");
  const { run, footer } = useSaver();
  const set = (k: keyof typeof bank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setBank({ ...bank, [k]: e.target.value });
  const anyBank = Object.values(bank).some((v) => v.trim());
  return (
    <Card title="Billing: bank details, quote terms & invoice footer">
      <form onSubmit={run(() => update({
        orgId, quoteTerms, invoiceFooter,
        bankDetails: anyBank ? { bankName: opt(bank.bankName), accountName: opt(bank.accountName), sortCode: opt(bank.sortCode), accountNumber: opt(bank.accountNumber), iban: opt(bank.iban), bic: opt(bank.bic), paymentInstructions: opt(bank.paymentInstructions) } : null,
      }))}>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Bank name"><Input value={bank.bankName} onChange={set("bankName")} /></Field>
          <Field label="Account name"><Input value={bank.accountName} onChange={set("accountName")} /></Field>
          <Field label="Sort code"><Input value={bank.sortCode} onChange={set("sortCode")} placeholder="12-34-56" /></Field>
          <Field label="Account number"><Input value={bank.accountNumber} onChange={set("accountNumber")} /></Field>
          <Field label="IBAN"><Input value={bank.iban} onChange={set("iban")} /></Field>
          <Field label="BIC"><Input value={bank.bic} onChange={set("bic")} /></Field>
          <Field label="Payment instructions" className="sm:col-span-3"><Textarea value={bank.paymentInstructions} onChange={set("paymentInstructions")} /></Field>
          <Field label="Default quote terms" className="sm:col-span-3"><Textarea rows={5} value={quoteTerms} onChange={(e) => setQuoteTerms(e.target.value)} /></Field>
          <Field label="Invoice footer" className="sm:col-span-3"><Textarea value={invoiceFooter} onChange={(e) => setInvoiceFooter(e.target.value)} /></Field>
        </div>
        {footer("Save billing settings")}
      </form>
    </Card>
  );
}

function ReminderCard() {
  const { orgId } = useOrg();
  const data = useQuery(api.organizations.getReminderSettings, { orgId });
  const update = useMutation(api.organizations.updateReminderSettings);
  const [f, setF] = useState<null | { enabled: boolean; serviceLeadDays: string; certificateLeadDays: string; invoiceOverdueDays: string; invoiceRemindClient: boolean; officeEmails: string; weeklyDigest: boolean }>(null);
  const { run, footer } = useSaver();
  useEffect(() => {
    if (data && !f) {
      const s = data.settings;
      setF({ enabled: s.enabled, serviceLeadDays: s.serviceLeadDays.join(", "), certificateLeadDays: s.certificateLeadDays.join(", "), invoiceOverdueDays: s.invoiceOverdueDays.join(", "), invoiceRemindClient: s.invoiceRemindClient, officeEmails: s.officeEmails.join(", "), weeklyDigest: s.weeklyDigest });
    }
  }, [data, f]);
  if (!f) return <Card title="Reminders"><Loading /></Card>;
  return (
    <Card title="Reminders">
      <form onSubmit={run(() => update({
        orgId, enabled: f.enabled, serviceLeadDays: days(f.serviceLeadDays), certificateLeadDays: days(f.certificateLeadDays), invoiceOverdueDays: days(f.invoiceOverdueDays),
        invoiceRemindClient: f.invoiceRemindClient, officeEmails: f.officeEmails.split(/[,;\s]+/).filter(Boolean), weeklyDigest: f.weeklyDigest,
      }))}>
        <div className="space-y-4">
          <Checkbox label="Send automatic reminders" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Service due: days before" hint={`Default ${data!.defaults.serviceLeadDays.join(", ")}`}><Input value={f.serviceLeadDays} onChange={(e) => setF({ ...f, serviceLeadDays: e.target.value })} /></Field>
            <Field label="Certificate expiry: days before" hint={`Default ${data!.defaults.certificateLeadDays.join(", ")}`}><Input value={f.certificateLeadDays} onChange={(e) => setF({ ...f, certificateLeadDays: e.target.value })} /></Field>
            <Field label="Overdue invoices: days after due" hint={`Default ${data!.defaults.invoiceOverdueDays.join(", ")}. Leave empty to turn off.`}><Input value={f.invoiceOverdueDays} onChange={(e) => setF({ ...f, invoiceOverdueDays: e.target.value })} /></Field>
            <Field label="Office emails" hint="Comma-separated. Office copies and digests go here."><Input value={f.officeEmails} onChange={(e) => setF({ ...f, officeEmails: e.target.value })} /></Field>
          </div>
          <Checkbox label="Send overdue-invoice reminders to the client as well as the office" checked={f.invoiceRemindClient} onChange={(v) => setF({ ...f, invoiceRemindClient: v })} />
          <Checkbox label="Weekly digest email" checked={f.weeklyDigest} onChange={(v) => setF({ ...f, weeklyDigest: v })} />
        </div>
        {footer("Save reminder settings")}
      </form>
    </Card>
  );
}

function AutomationCard() {
  const { orgId } = useOrg();
  const data = useQuery(api.organizations.getJobAutomationSettings, { orgId });
  const update = useMutation(api.organizations.updateJobAutomationSettings);
  const [f, setF] = useState<null | { enabled: boolean; leadDays: string; notifyOffice: boolean }>(null);
  const { run, footer } = useSaver();
  useEffect(() => { if (data && !f) setF({ enabled: data.settings.enabled, leadDays: String(data.settings.leadDays), notifyOffice: data.settings.notifyOffice }); }, [data, f]);
  if (!f) return <Card title="Job automation"><Loading /></Card>;
  return (
    <Card title="Job automation">
      <form onSubmit={run(() => update({ orgId, enabled: f.enabled, leadDays: Number(f.leadDays), notifyOffice: f.notifyOffice }))}>
        <div className="space-y-4">
          <Checkbox label="Automatically create Unscheduled jobs from service schedules" checked={f.enabled} onChange={(v) => setF({ ...f, enabled: v })} />
          <Field label="Lead time (days before due)" hint={`Default ${data!.defaults.leadDays}. Schedules can override this.`}><Input className="max-w-[8rem]" inputMode="numeric" value={f.leadDays} onChange={(e) => setF({ ...f, leadDays: e.target.value })} /></Field>
          <Checkbox label="Email the office a summary when jobs are created" checked={f.notifyOffice} onChange={(v) => setF({ ...f, notifyOffice: v })} />
        </div>
        {footer("Save job automation")}
      </form>
    </Card>
  );
}
