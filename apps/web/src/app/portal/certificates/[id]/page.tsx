"use client";

import { useParams } from "next/navigation";
import { useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { date, dateTime } from "@/lib/format";
import { disciplineLabel } from "@/lib/labels";
import { Card, DL, Loading, Notice, PageHeader, StatusBadge } from "@/components/ui";
import { PdfButton } from "@/components/PdfButton";
import { CopyLink } from "@/components/CopyLink";

export default function PortalCertificate() {
  const { id } = useParams<{ id: Id<"certificates"> }>();
  const cert = useQuery(api.certificates.get, { certificateId: id });
  const pdf = useQuery(api.certificates.getPdf, { certificateId: id });
  if (!cert) return <Loading />;
  return (
    <>
      <PageHeader back={{ href: "/portal/certificates", label: "Certificates" }}
        title={<span className="flex items-center gap-3">{cert.certificateNumber} <StatusBadge status={cert.status} /></span>}
        subtitle={`${cert.typeName} · ${disciplineLabel(cert.discipline)} · ${cert.siteName}`}
        actions={<PdfButton pdf={pdf} />} />
      {cert.status !== "issued" && <div className="mb-4"><Notice>This certificate is {cert.status} and is no longer current.</Notice></div>}
      <Card>
        <DL items={[
          ["Overall result", <StatusBadge key="r" status={cert.overallResult} />],
          ["Inspection date", date(cert.inspectionDate)],
          ["Issued", cert.issuedAt ? dateTime(cert.issuedAt) : null],
          ["Next inspection due", cert.nextInspectionDueAt ? date(cert.nextInspectionDueAt) : null],
          ["Expires", cert.expiresAt ? date(cert.expiresAt) : null],
          ["Summary", cert.summary],
          ["Engineer", cert.engineerSignature?.signedByName],
        ]} />
        {cert.verifyUrl && <div className="mt-4"><CopyLink label="Verify" url={cert.verifyUrl} /></div>}
      </Card>
    </>
  );
}
