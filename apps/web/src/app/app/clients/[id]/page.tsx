"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api, type Id } from "@/lib/api";
import { useOrg } from "@/lib/session";
import { OFFICE, humanize } from "@/lib/labels";
import { address, date, money } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import { ActionButton, Badge, Button, Card, DL, ErrorBox, Field, Input, LinkButton, Loading, LoadMore, Notice, PageHeader, StatusBadge, Table } from "@/components/ui";
import { CopyLink } from "@/components/CopyLink";

export default function ClientDetailPage() {
  const { id } = useParams<{ id: Id<"clients"> }>();
  const { orgId, role } = useOrg();
  const office = OFFICE.includes(role);
  const client = useQuery(api.clients.get, { clientId: id });
  const sites = usePaginatedQuery(api.sites.list, { orgId, clientId: id }, { initialNumItems: 25 });
  const quotes = useQuery(api.quotes.list, office ? { orgId, clientId: id, paginationOpts: { numItems: 20, cursor: null } } : "skip");
  const invoices = useQuery(api.invoices.list, office ? { orgId, clientId: id, paginationOpts: { numItems: 20, cursor: null } } : "skip");
  const setArchived = useMutation(api.clients.setArchived);

  if (!client) return <Loading />;
  const archived = client.status === "archived";
  return (
    <>
      <PageHeader
        back={{ href: "/app/clients", label: "Clients" }}
        title={<span className="flex items-center gap-3">{client.name} {archived && <Badge tone="amber">Archived</Badge>}</span>}
        subtitle={humanize(client.type)}
        actions={office && (
          <>
            {!archived && <LinkButton href={`/app/sites/new?clientId=${id}`}>Add site</LinkButton>}
            <LinkButton variant="secondary" href={`/app/clients/${id}/edit`}>Edit</LinkButton>
            <ActionButton variant={archived ? "secondary" : "danger"} confirm={archived ? undefined : "Archive this client? Their active service schedules will be paused."} action={() => setArchived({ clientId: id, archived: !archived })}>
              {archived ? "Restore" : "Archive"}
            </ActionButton>
          </>
        )}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card title="Details" className="lg:col-span-2">
          <DL items={[
            ["Account number", client.accountNumber],
            ["Billing address", address(client.billingAddress)],
            ["Primary contact", client.primaryContact ? [client.primaryContact.name, client.primaryContact.role, client.primaryContact.email, client.primaryContact.phone].filter(Boolean).join(" · ") : null],
            ["Reminder emails", client.reminderEmails?.join(", ")],
            ["Notes", "notes" in client ? (client.notes as string | undefined) : null],
            ["Client since", date(client.createdAt)],
          ]} />
        </Card>
        {office && <PortalAccessCard clientId={id} sites={sites.results.map((s) => ({ _id: s._id, name: s.name }))} archived={archived} />}
      </div>
      <Card title="Sites" className="mt-6">
        <Table rows={sites.status === "LoadingFirstPage" ? undefined : sites.results} href={(s) => `/app/sites/${s._id}`} empty="No sites yet." columns={[
          { header: "Site", cell: (s) => s.name },
          { header: "Reference", cell: (s) => s.reference ?? "—" },
          { header: "Address", cell: (s) => address(s.address) },
          { header: "Status", cell: (s) => <StatusBadge status={s.status} /> },
        ]} />
        <LoadMore status={sites.status} loadMore={sites.loadMore} />
      </Card>
      {office && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card title="Quotes" actions={<LinkButton variant="secondary" href={`/app/quotes/new?clientId=${id}`}>New quote</LinkButton>}>
            <Table rows={quotes?.page} href={(q) => `/app/quotes/${q._id}`} empty="No quotes." columns={[
              { header: "Quote", cell: (q) => `${q.quoteNumber}${q.revision ? ` rev ${q.revision}` : ""}` },
              { header: "Title", cell: (q) => q.title },
              { header: "Total", cell: (q) => money(q.total, q.currency) },
              { header: "Status", cell: (q) => <StatusBadge status={q.status} /> },
            ]} />
          </Card>
          <Card title="Invoices" actions={<LinkButton variant="secondary" href={`/app/invoices/new?clientId=${id}`}>New invoice</LinkButton>}>
            <Table rows={invoices?.page} href={(i) => `/app/invoices/${i._id}`} empty="No invoices." columns={[
              { header: "Invoice", cell: (i) => i.invoiceNumber },
              { header: "Total", cell: (i) => money(i.total, i.currency) },
              { header: "Due", cell: (i) => date(i.dueAt) },
              { header: "Status", cell: (i) => <StatusBadge status={i.status} /> },
            ]} />
          </Card>
        </div>
      )}
    </>
  );
}

function PortalAccessCard({ clientId, sites, archived }: { clientId: Id<"clients">; sites: { _id: Id<"sites">; name: string }[]; archived: boolean }) {
  const { orgId } = useOrg();
  const access = useQuery(api.portal.listAccess, { clientId });
  const invites = useQuery(api.portal.listInvitations, { orgId, clientId, paginationOpts: { numItems: 20, cursor: null } });
  const invite = useMutation(api.portal.createInvitation);
  const revokeAccess = useMutation(api.portal.revokeAccess);
  const revokeInvite = useMutation(api.portal.revokeInvitation);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [siteIds, setSiteIds] = useState<Id<"sites">[]>([]);
  const [link, setLink] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await invite({ clientId, email, name: name.trim() || undefined, siteIds: siteIds.length ? siteIds : undefined });
      setLink(`${window.location.origin}/invite/portal/${r.token}`);
      setEmail(""); setName(""); setSiteIds([]);
    } catch (err) { setError(errorMessage(err)); }
  }

  return (
    <Card title="Client portal">
      <p className="mb-3 text-xs text-slate-500">Read-only access for the client to their certificates, sites and defects.</p>
      <ul className="mb-3 space-y-2 text-sm">
        {access?.map((a) => (
          <li key={a._id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate">{a.name ?? a.email} <StatusBadge status={a.status} /></span>
            {a.status === "active" && <ActionButton variant="ghost" confirm="Remove this person's portal access?" action={() => revokeAccess({ accessId: a._id })}>Remove</ActionButton>}
          </li>
        ))}
        {invites?.page.filter((i) => i.status === "pending").map((i) => (
          <li key={i._id} className="flex items-center justify-between gap-2 text-slate-600">
            <span className="min-w-0 truncate">{i.email} <Badge tone={i.expired ? "red" : "amber"}>{i.expired ? "Invite expired" : "Invited"}</Badge></span>
            <ActionButton variant="ghost" action={() => revokeInvite({ invitationId: i._id })}>Revoke</ActionButton>
          </li>
        ))}
        {access?.length === 0 && invites?.page.length === 0 && <li className="text-slate-500">No portal users yet.</li>}
      </ul>
      {!archived && (
        <form onSubmit={send} className="space-y-2 border-t border-slate-100 pt-3">
          <Field label="Invite by email"><Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field label="Name (optional)"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          {sites.length > 0 && (
            <Field label="Limit to sites (optional)">
              <select multiple className="block w-full rounded-md border border-slate-300 px-2 py-1 text-sm" value={siteIds} onChange={(e) => setSiteIds([...e.target.selectedOptions].map((o) => o.value as Id<"sites">))}>
                {sites.map((s) => <option key={s._id} value={s._id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <ErrorBox message={error} />
          <Button type="submit" variant="secondary">Send invite</Button>
        </form>
      )}
      {link && <div className="mt-3 space-y-2"><Notice tone="blue">Invite created. Email sending is in dry-run mode, so share this link with the client:</Notice><CopyLink url={link} /></div>}
    </Card>
  );
}
