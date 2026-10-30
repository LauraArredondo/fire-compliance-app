"use client";

import { useQuery } from "convex/react";
import { ROLE_LABELS } from "@fire/shared";
import { api } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { usePermissions } from "@/lib/permissions";
import { disciplineLabel } from "@/lib/labels";
import { date } from "@/lib/format";
import { Card, DL, PageHeader, StatusBadge, Table } from "@/components/ui";

/** The signed-in user's own profile: who they are, their role, and (for engineers) their qualifications. */
export default function ProfilePage() {
  const { orgId, me, membership, role } = useOrg();
  const perms = usePermissions();
  const quals = useQuery(api.qualifications.list, { orgId, userId: me._id });
  const now = Date.now();
  return (
    <>
      <PageHeader title="My profile" subtitle={membership.orgName ?? undefined} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Account">
          <DL items={[
            ["Name", me.name],
            ["Email", me.email],
            ["Company", membership.orgName],
            ["Role", ROLE_LABELS[role]],
          ]} />
        </Card>
        <Card title="My qualifications" className="lg:col-span-2">
          <Table rows={quals} empty="No qualifications recorded. Ask the office to add them." columns={[
            { header: "Qualification", cell: (q) => q.title },
            { header: "Discipline", cell: (q) => disciplineLabel(q.discipline) },
            { header: "Issuer", cell: (q) => q.issuer ?? "—" },
            { header: "Expires", cell: (q) => q.expiresAt ? <span className={q.expiresAt < now ? "font-medium text-red-700" : ""}>{date(q.expiresAt)}{q.expiresAt < now && " (expired)"}</span> : "—" },
            { header: "", cell: (q) => <StatusBadge status={q.expiresAt && q.expiresAt < now ? "overdue" : "active"} label={q.expiresAt && q.expiresAt < now ? "Expired" : "Valid"} /> },
          ]} />
        </Card>
      </div>
      {perms.assignedOnly && (
        <Card title="What you can do" className="mt-6">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            <li>See the jobs assigned to you, start and finish visits, and complete your jobs.</li>
            <li>See the sites and assets for your jobs, and update assets and site locations.</li>
            <li>Raise defects and mark them resolved at your sites.</li>
            <li>Fill in, sign and issue certificates for your sites (if you hold the right qualification).</li>
          </ul>
          <p className="mt-3 text-xs text-slate-500">Access is set by your company&apos;s admins.</p>
        </Card>
      )}
    </>
  );
}
