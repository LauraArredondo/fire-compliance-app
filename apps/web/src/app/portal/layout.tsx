"use client";

import { Shell, type NavItem } from "@/components/Shell";

const NAV: NavItem[] = [
  { href: "/portal", label: "Overview", group: "Portal", icon: "dashboard" },
  { href: "/portal/certificates", label: "Certificates", group: "Records", icon: "certificates" },
  { href: "/portal/defects", label: "Defects", group: "Records", icon: "defects" },
  { href: "/portal/quotes", label: "Quotes", group: "Commercial", icon: "quotes" },
  { href: "/portal/invoices", label: "Invoices", group: "Commercial", icon: "invoices" },
];

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return <Shell area="portal" nav={NAV}>{children}</Shell>;
}
