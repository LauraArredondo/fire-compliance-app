"use client";

import { Shell, type NavItem } from "@/components/Shell";
import { MANAGERS, OFFICE } from "@/lib/labels";

const NAV: NavItem[] = [
  { href: "/app", label: "Dashboard", group: "Workspace", icon: "dashboard" },
  { href: "/app/jobs", label: "Jobs", group: "Workspace", icon: "jobs" },
  { href: "/app/schedules", label: "Schedules", group: "Workspace", icon: "schedules" },
  { href: "/app/defects", label: "Defects", group: "Workspace", icon: "defects" },
  { href: "/app/certificates", label: "Certificates", group: "Workspace", icon: "certificates" },
  { href: "/app/clients", label: "Clients", group: "Records", icon: "clients" },
  { href: "/app/sites", label: "Sites", group: "Records", icon: "sites" },
  { href: "/app/quotes", label: "Quotes", group: "Commercial", icon: "quotes", roles: OFFICE },
  { href: "/app/invoices", label: "Invoices", group: "Commercial", icon: "invoices", roles: OFFICE },
  { href: "/app/team", label: "Team", group: "Organisation", icon: "team", roles: OFFICE },
  { href: "/app/settings", label: "Settings", group: "Organisation", icon: "settings", roles: [...MANAGERS, "office"] },
];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <Shell area="staff" nav={NAV}>{children}</Shell>;
}
