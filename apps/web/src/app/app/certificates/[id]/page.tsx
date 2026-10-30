"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OVERALL_RESULTS, disciplineLabel } from "@/lib/labels";
import { NotAvailable } from "@/components/NotAvailable";
import { useSafeQuery } from "@/lib/useSafeQuery";
import { usePermissions } from "@/lib/permissions";
import { date, dateTime, fromDateInput, opt, toDateInput } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Badge, Button, Card, DL, ErrorBox, Field, Input, Loading, Notice, PageHeader, Select, StatusBadge, Textarea } from "@/components/ui";
import { SignaturePad, uploadBlob } from "@/components/SignaturePad";
import { PdfButton } from "@/components/PdfButton";
import { CopyLink } from "@/components/CopyLink";

type Overall = (typeof OVERALL_RESULTS)[number];

export default function CertificatePage() {
  const { id } = useParams<{ id: Id<"certificates"> }>();
  const router = useRouter();
  const perms = usePermissions();
  const { data: cert, denied } = useSafeQuery(api.certificates.get, { certificateId: id });
  const issued = cert?.status === "issued";
  const pdf = useQuery(api.certificates.getPdf, cert && !cert.editable ? { certificateId: id } : "skip");
  const qual = useQuery(api.certificates.qualificationCheck, cert?.editable ? { certificateId: id } : "skip");
  const issue = useMutation(api.certificates.issue);
  const reissue = useMutation(api.certificates.reissue);
  const revoke = useMutation(api.certificates.revoke);
  const regen = useMutation(api.certificates.regeneratePdf);
  const removeDraft = useMutation(api.certificates.removeDraft);
  const [error, setError] = useState<string | null>(null);
  const [issueReason, setIssueReason] = useState("");

  // Engineers only see certificates for the sites of their own jobs (enforced by the backend).
  if (denied) return <NotAvailable what="certificate" />;
  if (!cert) return <Loading />;
  const engineerSigned = !!cert.engineerSignature;
  const needsOverride = !!qual && !qual.qualified && !qual.coveredByPriorOverride;

  return (
    <>
      <PageHeader
        back={{ href: "/app/certificates", label: "Certificates" }}
        title={<span className="flex flex-wrap items-center gap-3">{cert.certificateNumber}{cert.revision ? ` rev ${cert.revision}` : ""} <StatusBadge status={cert.status} />{cert.qualificationOverridden && <Badge tone="amber">Qualification override</Badge>}</span>}
        subtitle={<>{cert.typeName} · {disciplineLabel(cert.discipline)} · <a className="hover:underline" href={`/app/sites/${cert.siteId}`}>{cert.siteName}</a></>}
        actions={
          <>
            {!cert.editable && <PdfButton pdf={pdf} onRegenerate={perms.can("certificates.revoke") ? () => void regen({ certificateId: id }).catch((e) => setError(errorMessage(e))) : undefined} />}
            {issued && perms.can("certificates.reissue") && <ActionButton onError={setError} action={async () => { const reason = window.prompt("Reason for reissue (optional)") ?? undefined; const r = await reissue({ certificateId: id, reason: reason || undefined }); router.push(`/app/certificates/${r.certificateId}`); }}>Reissue (new revision)</ActionButton>}
            {issued && perms.can("certificates.revoke") && <ActionButton variant="danger" onError={setError} action={async () => { const reason = window.prompt("Reason for revoking this certificate?"); if (reason) await revoke({ certificateId: id, reason }); }}>Revoke</ActionButton>}
            {cert.editable && perms.can("certificates.deleteDraft") && <ActionButton variant="danger" confirm="Delete this draft certificate?" onError={setError} action={async () => { await removeDraft({ certificateId: id }); router.push("/app/certificates"); }}>Delete draft</ActionButton>}
          </>
        }
      />
      <ErrorBox message={error} />
      {cert.status === "revoked" && <div className="mb-4"><Notice>Revoked{cert.revokedAt ? ` on ${date(cert.revokedAt)}` : ""}{cert.revokedReason ? `: ${cert.revokedReason}` : ""}.</Notice></div>}
      {cert.status === "superseded" && cert.supersededById && <div className="mb-4"><Notice>Superseded by a newer revision. <a className="underline" href={`/app/certificates/${cert.supersededById}`}>Open the current certificate</a>.</Notice></div>}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Certificate" className="lg:col-span-2">
          {cert.editable ? <EditDraft cert={cert} /> : (
            <DL items={[
              ["Overall result", <StatusBadge key="r" status={cert.overallResult} />],
              ["Inspection date", date(cert.inspectionDate)],
              ["Issued", cert.issuedAt ? dateTime(cert.issuedAt) : null],
              ["Expires", cert.expiresAt ? date(cert.expiresAt) : null],
              ["Next inspection due", cert.nextInspectionDueAt ? date(cert.nextInspectionDueAt) : null],
              ["Summary", cert.summary],
              ["Assets covered", String(cert.assetIds.length)],
              ["Defects recorded", String(cert.defectIds.length)],
              ["Job", cert.jobId ? <a key="j" className="text-red-700 hover:underline" href={`/app/jobs/${cert.jobId}`}>View job</a> : null],
            ]} />
          )}
          {!cert.editable && cert.verifyUrl && <div className="mt-4"><CopyLink label="Verify" url={cert.verifyUrl} /></div>}
        </Card>
        <Card title="Signatures">
          <SignatureLine label="Engineer" sig={cert.engineerSignature} />
          <SignatureLine label="Client" sig={cert.clientSignature} />
          {cert.qualificationChecks && cert.qualificationChecks.length > 0 && (
            <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-600">
              <div className="mb-1 font-medium text-slate-700">Qualification checks</div>
              <ul className="space-y-1">{cert.qualificationChecks.map((c, i) => (
                <li key={i}>{c.stage} · {c.engineerName}: {c.qualified ? "qualified" : "not qualified"}{c.override ? ` — overridden by ${c.override.byName}: “${c.override.reason}”` : ""}</li>
              ))}</ul>
            </div>
          )}
        </Card>
      </div>

      {cert.editable && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Sign">
            {qual && (
              <div className="mb-4">
                {qual.qualified ? <Notice tone="green">✓ {qual.detail}</Notice>
                  : qual.coveredByPriorOverride ? <Notice tone="blue">{qual.detail} — covered by the override recorded at signing.</Notice>
                  : <Notice>{qual.detail}{qual.canOverride ? " As an owner/admin you can sign or issue with an override reason." : " Ask an owner or admin to override, or add a qualification on the Team page."}</Notice>}
              </div>
            )}
            <SignForm certificateId={id} as="engineer" disabled={!perms.can("certificates.signAsEngineer")} disabledReason="The engineer signature must be given by an engineer or manager." needsOverride={!engineerSigned && needsOverride} canOverride={!!qual?.canOverride} onError={setError} />
            <div className="my-4 border-t border-slate-100" />
            <SignForm certificateId={id} as="client" onError={setError} />
          </Card>
          <Card title="Issue">
            <p className="mb-3 text-sm text-slate-600">Issuing locks the certificate, generates the PDF and a public verification link. {cert.status === "pending_signature" && "This certificate type needs the client signature first."}</p>
            {engineerSigned && needsOverride && qual?.canOverride && (
              <Field label="Qualification override reason" hint="Required: the signing engineer isn't qualified (min 5 characters)."><Input value={issueReason} onChange={(e) => setIssueReason(e.target.value)} /></Field>
            )}
            <div className="mt-3">
              <ActionButton variant="primary" disabled={!engineerSigned || (needsOverride && engineerSigned && (!qual?.canOverride || issueReason.trim().length < 5))} onError={setError}
                action={() => issue({ certificateId: id, qualificationOverrideReason: issueReason.trim() || undefined })}>
                Issue certificate
              </ActionButton>
            </div>
            {!engineerSigned && <p className="mt-2 text-xs text-slate-500">The engineer must sign before issuing.</p>}
          </Card>
        </div>
      )}
    </>
  );
}

function SignatureLine({ label, sig }: { label: string; sig?: { signedByName: string; signedByRole?: string; signedAt: number } }) {
  return (
    <div className="mb-3 text-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {sig ? <div>{sig.signedByName}{sig.signedByRole ? `, ${sig.signedByRole}` : ""} <span className="text-xs text-slate-500">· {dateTime(sig.signedAt)}</span></div> : <div className="text-slate-400">Not signed</div>}
    </div>
  );
}

function SignForm({ certificateId, as, disabled, disabledReason, needsOverride, canOverride, onError }: {
  certificateId: Id<"certificates">; as: "engineer" | "client"; disabled?: boolean; disabledReason?: string; needsOverride?: boolean; canOverride?: boolean; onError: (m: string) => void;
}) {
  const { orgId, me } = useOrg();
  const sign = useMutation(api.certificates.sign);
  const uploadUrl = useMutation(api.visits.generateUploadUrl);
  const [name, setName] = useState(as === "engineer" ? me?.name ?? "" : "");
  const [roleTitle, setRoleTitle] = useState("");
  const [png, setPng] = useState<Blob | null>(null);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<string | null>(null);
  if (disabled) return <p className="text-sm text-slate-500"><strong className="text-slate-700">Engineer signature:</strong> {disabledReason}</p>;
  const blocked = needsOverride && (!canOverride || reason.trim().length < 5);
  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{as === "engineer" ? "Engineer signature" : "Client signature"}</div>
      <div className="grid grid-cols-2 gap-2">
        <Input placeholder="Full name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input placeholder={as === "engineer" ? "Role (optional)" : "Position (optional)"} value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} />
      </div>
      <SignaturePad onChange={setPng} />
      {needsOverride && canOverride && <Field label="Qualification override reason" hint="Min 5 characters. Recorded on the certificate."><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>}
      <ActionButton disabled={!name.trim() || blocked} onError={onError} action={async () => {
        let signatureImageId: Id<"_storage"> | undefined;
        if (png) signatureImageId = (await uploadBlob(await uploadUrl({ orgId }), png)) as Id<"_storage">;
        const r = await sign({ certificateId, as, signature: { signedByName: name.trim(), signedByRole: opt(roleTitle), signatureImageId, deviceInfo: navigator.userAgent.slice(0, 250) }, qualificationOverrideReason: reason.trim() || undefined });
        setResult(r.readyToIssue ? "Signed — ready to issue." : "Signed.");
      }}>Sign as {as}</ActionButton>
      {result && <p className="text-xs text-green-700">{result}</p>}
    </div>
  );
}

function EditDraft({ cert }: { cert: { _id: Id<"certificates">; overallResult: Overall; summary?: string; inspectionDate: number; expiresAt?: number; nextInspectionDueAt?: number; assetIds: string[]; defectIds: string[] } }) {
  const update = useMutation(api.certificates.updateDraft);
  const [overall, setOverall] = useState<Overall>(cert.overallResult);
  const [summary, setSummary] = useState(cert.summary ?? "");
  const [inspectionDate, setInspectionDate] = useState(toDateInput(cert.inspectionDate));
  const [next, setNext] = useState(toDateInput(cert.nextInspectionDueAt));
  const [expires, setExpires] = useState(toDateInput(cert.expiresAt));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setError(null); setSaved(false);
    try { await update({ certificateId: cert._id, overallResult: overall, summary: opt(summary), inspectionDate: fromDateInput(inspectionDate), nextInspectionDueAt: fromDateInput(next), expiresAt: fromDateInput(expires) }); setSaved(true); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <form onSubmit={save} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Field label="Overall result"><Select options={OVERALL_RESULTS} value={overall} onChange={(e) => setOverall(e.target.value as Overall)} /></Field>
      <Field label="Inspection date"><Input type="date" value={inspectionDate} onChange={(e) => setInspectionDate(e.target.value)} /></Field>
      <Field label="Next inspection due" hint="Blank = from the certificate type's validity."><Input type="date" value={next} onChange={(e) => setNext(e.target.value)} /></Field>
      <Field label="Expires"><Input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
      <Field label="Summary / observations" className="sm:col-span-2"><Textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} /></Field>
      <div className="text-xs text-slate-500 sm:col-span-2">{cert.assetIds.length} assets and {cert.defectIds.length} defects attached (from the job&apos;s inspections). Detailed inspection results are captured in the mobile app.</div>
      <div className="sm:col-span-2"><ErrorBox message={error} /></div>
      <div className="flex items-center gap-3"><Button type="submit" variant="secondary">Save draft</Button>{saved && <span className="text-xs text-green-700">Saved</span>}</div>
    </form>
  );
}
