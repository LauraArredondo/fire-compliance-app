"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { MANAGERS, ROLE_LABEL, type Role } from "@/lib/labels";
import { date } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Badge, Button, Card, ErrorBox, Field, Input, Notice, PageHeader, Select, StatusBadge, Table } from "@/components/ui";
import { CopyLink } from "@/components/CopyLink";

const STAFF_ROLES = ["owner", "admin", "office", "engineer"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

export default function TeamPage() {
  const { orgId, role, me } = useOrg();
  const manager = MANAGERS.includes(role);
  const members = useQuery(api.team.list, { orgId, includeDisabled: true });
  const invites = useQuery(api.team.listInvitations, { orgId, paginationOpts: { numItems: 50, cursor: null } });
  const updateRole = useMutation(api.team.updateRole);
  const setActive = useMutation(api.team.setActive);
  const revoke = useMutation(api.team.revokeInvitation);
  const [error, setError] = useState<string | null>(null);
  const roleOptions = STAFF_ROLES.filter((r) => r !== "owner" || role === "owner").map((r) => ({ value: r, label: ROLE_LABEL[r as Role] }));

  return (
    <>
      <PageHeader title="Team" subtitle="Staff accounts, roles and engineer qualifications." />
      <ErrorBox message={error} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Members" className="lg:col-span-2">
          <Table rows={members?.map((m) => ({ ...m, _id: m.membershipId }))} href={(m) => `/app/team/${m.userId}`} empty="No members." columns={[
            { header: "Name", cell: (m) => <span>{m.name ?? m.email}{m.userId === me?._id && <span className="ml-1 text-xs text-slate-500">(you)</span>}</span> },
            { header: "Email", cell: (m) => m.email ?? "—" },
            { header: "Role", cell: (m) => manager && m.userId !== me?._id && (m.role !== "owner" || role === "owner")
              ? <span onClick={(e) => e.stopPropagation()}><Select className="py-1" value={m.role} options={roleOptions} onChange={(e) => void updateRole({ membershipId: m.membershipId, role: e.target.value as StaffRole }).catch((err) => setError(errorMessage(err)))} /></span>
              : ROLE_LABEL[m.role as Role] },
            { header: "Status", cell: (m) => <StatusBadge status={m.status} /> },
            { header: "", cell: (m) => manager && m.userId !== me?._id ? (
              <span onClick={(e) => e.stopPropagation()}><ActionButton variant="ghost" onError={setError} confirm={m.status === "active" ? `Disable ${m.name ?? m.email}? They will lose access.` : undefined} action={() => setActive({ membershipId: m.membershipId, active: m.status !== "active" })}>{m.status === "active" ? "Disable" : "Enable"}</ActionButton></span>
            ) : null },
          ]} />
        </Card>
        <InviteCard roleOptions={roleOptions} />
      </div>
      <Card title="Pending invitations" className="mt-6">
        <Table rows={invites?.page.filter((i) => i.status === "pending")} empty="No pending invitations." columns={[
          { header: "Email", cell: (i) => i.email },
          { header: "Role", cell: (i) => ROLE_LABEL[i.role as Role] },
          { header: "Expires", cell: (i) => <span>{date(i.expiresAt)} {i.expiresAt < Date.now() && <Badge tone="red">Expired</Badge>}</span> },
          { header: "", cell: (i) => <ActionButton variant="ghost" onError={setError} action={() => revoke({ invitationId: i._id as Id<"teamInvitations"> })}>Revoke</ActionButton> },
        ]} />
      </Card>
    </>
  );
}

function InviteCard({ roleOptions }: { roleOptions: { value: string; label: string }[] }) {
  const { orgId } = useOrg();
  const invite = useMutation(api.team.invite);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [r, setR] = useState<StaffRole>("engineer");
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    try { const res = await invite({ orgId, email, name: name.trim() || undefined, role: r }); setLink(`${window.location.origin}/invite/team/${res.token}`); setEmail(""); setName(""); }
    catch (err) { setError(errorMessage(err)); }
  }
  return (
    <Card title="Invite a team member">
      <form onSubmit={submit} className="space-y-2">
        <Field label="Email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Role"><Select options={roleOptions} value={r} onChange={(e) => setR(e.target.value as StaffRole)} /></Field>
        <ErrorBox message={error} />
        <Button type="submit">Send invite</Button>
      </form>
      {link && <div className="mt-3 space-y-2"><Notice tone="blue">Invite created. Email is in dry-run mode, so share this link:</Notice><CopyLink url={link} /></div>}
    </Card>
  );
}
