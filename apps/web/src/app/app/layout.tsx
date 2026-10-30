"use client";

import { Shell, type NavItem } from "@/components/Shell";
import { MANAGERS, OFFICE } from "@/lib/labels";

const NAV: NavItem[] = [
  { href: "/app", label: "Dashboard" },
  { href: "/app/jobs", label: "Jobs" },
  { href: "/app/clients", label: "Clients" },
  { href: "/app/sites", label: "Sites" },
  { href: "/app/defects", label: "Defects" },
  { href: "/app/certificates", label: "Certificates" },
  { href: "/app/schedules", label: "Service schedules" },
  { href: "/app/quotes", label: "Quotes", roles: OFFICE },
  { href: "/app/invoices", label: "Invoices", roles: OFFICE },
  { href: "/app/team", label: "Team", roles: OFFICE },
  { href: "/app/settings", label: "Settings", roles: [...MANAGERS, "office"] },
];

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <Shell area="staff" nav={NAV}>{children}</Shell>;
}
